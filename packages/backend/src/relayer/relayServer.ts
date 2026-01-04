import pino from "pino";
import { BridgeQueue, BridgeMessage } from "./queue";
import { RelayerConfig, loadConfig } from "./config";
import { ethers } from "ethers";
import { EthWatcher, CsprWatcher } from "./watchers";
import { CasperClient, Keys, DeployUtil, CLValueBuilder, RuntimeArgs } from "casper-js-sdk";
import fs from "fs";
import { RedisStateStore } from "./storage/redisStateStore";

// Minimal ABIs
const VAULT_ABI = [
  "function release(address payable recipient, uint256 amount, bytes32 burnTx) external",
];
const WCSPR_ABI = [
  "function mint(address to, uint256 amount) external", 
];

/**
 * Relayer 主体：监听两条链、生成 BridgeMessage，执行对端动作
 */
export class Relayer {
  private readonly log = pino({ name: "relayer", level: "info" });
  private readonly ethProvider: ethers.JsonRpcProvider;
  private readonly ethWallet: ethers.Wallet;
  private readonly csprClient: CasperClient;
  private readonly csprKeyPair: Keys.AsymmetricKey;
  private readonly cfg: RelayerConfig;
  private readonly queue: BridgeQueue;
  private readonly seen = new Set<string>(); // 简易去重
  private readonly ethWatcher: EthWatcher;
  private readonly csprWatcher: CsprWatcher;

  private readonly stateStore: RedisStateStore;

  constructor(cfg: RelayerConfig) {
    this.cfg = cfg;
    this.ethProvider = new ethers.JsonRpcProvider(cfg.ETH_RPC);
    this.ethWallet = new ethers.Wallet(cfg.ETH_PRIVATE_KEY, this.ethProvider);
    this.csprClient = new CasperClient(cfg.CSPR_NODE);
    
    // Load CSPR Key
    const pem = fs.readFileSync(cfg.CSPR_PRIVATE_KEY_PATH, 'utf8');
    if (pem.includes("ED25519")) {
        this.csprKeyPair = Keys.Ed25519.loadKeyPairFromPrivateFile(cfg.CSPR_PRIVATE_KEY_PATH);
    } else {
        this.csprKeyPair = Keys.Secp256K1.loadKeyPairFromPrivateFile(cfg.CSPR_PRIVATE_KEY_PATH);
    }

    const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    this.stateStore = new RedisStateStore(redisUrl);

    this.queue = new BridgeQueue(
      {
        redisUrl,
        queueName: "bridge-messages",
        attempts: 3,
        backoffMs: 1000,
        concurrency: 4,
      },
      (msg) => this.handleMessage(msg)
    );
    
    this.ethWatcher = new EthWatcher(this.ethProvider, this.cfg, (msg) =>
      this.enqueue(msg)
    );
    this.csprWatcher = new CsprWatcher(this.csprClient, this.cfg, this.queue);
  }

  async start() {
    this.log.info("Relayer starting...");
    await this.ethWatcher.start();
    await this.csprWatcher.start();
    this.log.info("Relayer started");
  }

  /**
   * 处理消息的统一入口
   */
  async handleMessage(msg: BridgeMessage) {
    if (this.seen.has(msg.id)) {
      this.log.debug({ id: msg.id }, "Skip duplicated message");
      return;
    }
    this.seen.add(msg.id);

    this.log.info({ msg }, "Processing bridge message");

    try {
      if (msg.direction === "ETH_TO_CSPR") {
        await this.handleEthToCspr(msg);
      } else if (msg.direction === "CSPR_TO_ETH") {
        await this.handleCsprToEth(msg);
      } else {
        this.log.warn({ msg }, "Unknown message direction");
      }
    } catch (e) {
      this.log.error({ msg, err: e }, "Failed to process message");
      throw e; 
    }
  }

  private async handleEthToCspr(msg: BridgeMessage) {
    this.log.info(`[ETH->CSPR] Handling ${msg.id}`);
    
    // Determine which function to call on Casper Bridge
    const entryPoint = msg.asset === "ETH" ? "create_ceeth_mint_request" : "create_unlock_request";
    
    // We assume the bridge contract hash is known or in config (TODO: add to config)
    // For now using a placeholder or assuming it's available via some registry
    const bridgeContractHash = "contract-hash-placeholder"; 
    
    this.log.info(`Calling Casper contract ${bridgeContractHash} entrypoint ${entryPoint}`);
    
    // 构造 Casper 交易 (Deploy)
    // 这里需要根据 entryPoint 构造 RuntimeArgs
    const args = RuntimeArgs.fromMap({
        "amount": CLValueBuilder.u256(msg.amount),
        "recipient": CLValueBuilder.key(msg.recipient), // msg.recipient needs parsing
        "tx_id": CLValueBuilder.string(msg.srcTxHash),
        "dst_chain": CLValueBuilder.string("Sepolia"),
        // ... other args
    });

    // const deploy = DeployUtil.makeDeploy(
    //     new DeployUtil.DeployParams(this.csprKeyPair.publicKey, this.cfg.CSPR_CHAIN_ID),
    //     DeployUtil.ExecutableDeployItem.newStoredContractByHash(
    //         Buffer.from(bridgeContractHash, 'hex'),
    //         entryPoint,
    //         args
    //     ),
    //     DeployUtil.standardPayment(10000000000) // 10 CSPR
    // );
    
    // const signedDeploy = DeployUtil.signDeploy(deploy, this.csprKeyPair);
    // const deployHash = await this.csprClient.putDeploy(signedDeploy);
    // this.log.info(`Sent Casper deploy: ${deployHash}`);
  }

  private async handleCsprToEth(msg: BridgeMessage) {
    this.log.info(`[CSPR->ETH] Handling ${msg.id}`);
    
    if (msg.asset === "CSPR") {
        // Native CSPR Locked -> Mint WrappedCSPR on ETH
        if (!this.cfg.ETH_WCSRP_ADDRESS) throw new Error("ETH_WCSRP_ADDRESS not configured");
        const wcspr = new ethers.Contract(this.cfg.ETH_WCSRP_ADDRESS, WCSPR_ABI, this.ethWallet);
        
        this.log.info(`Minting WCSPR to ${msg.recipient} amount ${msg.amount}`);
        const tx = await wcspr.mint(msg.recipient, BigInt(msg.amount));
        await tx.wait();
        this.log.info(`Minted WCSPR: ${tx.hash}`);
    } else if (msg.asset === "ceETH") {
        // ceETH Burned -> Release ETH
        if (!this.cfg.ETH_VAULT_ADDRESS) throw new Error("ETH_VAULT_ADDRESS not configured");
        const vault = new ethers.Contract(this.cfg.ETH_VAULT_ADDRESS, VAULT_ABI, this.ethWallet);
        
        const burnTxHash = "0x" + msg.srcTxHash; // Ensure format
        
        this.log.info(`Releasing ETH to ${msg.recipient} amount ${msg.amount}`);
        const tx = await vault.release(msg.recipient, BigInt(msg.amount), burnTxHash);
        await tx.wait();
        this.log.info(`Released ETH: ${tx.hash}`);
    }
  }

  /**
   * 对外暴露：推送消息进入队列
   */
  enqueue(msg: BridgeMessage) {
    void this.queue.enqueue(msg.direction, msg);
  }
}

// 便于独立启动
export function createRelayerFromEnv() {
  const cfg = loadConfig();
  return new Relayer(cfg);
}

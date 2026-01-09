import pino from "pino";
import { BridgeQueue, BridgeMessage } from "./queue";
import { RelayerConfig, loadConfig } from "./config";
import { ethers } from "ethers";
import { EthWatcher, CsprWatcher } from "./watcher";
import { CasperClient, Keys } from "casper-js-sdk";
import fs from "fs";
import { RedisStateStore } from "./storage/redisStateStore";
import { BridgeEventHandler, RelayerContext } from "./handlers/BridgeEventHandler";
import { EthLockedHandler, WcsprBurnedHandler, CsprLockedHandler, CeEthBurnedHandler } from "./handlers";

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
  private readonly handlers: BridgeEventHandler[] = [];

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

    // Register Handlers
    this.handlers = [
        new EthLockedHandler(),
        new WcsprBurnedHandler(),
        new CsprLockedHandler(),
        new CeEthBurnedHandler()
    ];

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
      this.log.debug({ id: msg.id }, "Skip duplicated message (memory check)");
      // Don't return here if we want to support retries or state check, but for now simple dup check
    }
    this.seen.add(msg.id);

    // Check persistent state
    const state = await this.stateStore.get(msg.id);
    if (state && state.status === "COMPLETED") {
        this.log.info({ id: msg.id }, "Message already completed, skipping");
        return;
    }

    this.log.info({ msg }, "Processing bridge message");
    await this.stateStore.save({ id: msg.id, status: "PROCESSING", updatedAt: Date.now() });

    const context: RelayerContext = {
        cfg: this.cfg,
        ethProvider: this.ethProvider,
        ethWallet: this.ethWallet,
        csprClient: this.csprClient,
        csprKeyPair: this.csprKeyPair,
        stateStore: this.stateStore
    };

    try {
      const handler = this.handlers.find(h => h.canHandle(msg));
      if (!handler) {
          throw new Error(`No handler found for message: ${JSON.stringify(msg)}`);
      }

      await handler.handle(msg, context);

      await this.stateStore.save({ 
          id: msg.id, 
          status: "COMPLETED", 
          updatedAt: Date.now() 
          // txHash usually saved by handler if needed, or handler returns it
      });

    } catch (e: any) {
      this.log.error({ msg, err: e }, "Failed to process message");
      await this.stateStore.save({ 
          id: msg.id, 
          status: "FAILED", 
          error: e.message, 
          updatedAt: Date.now() 
      });
      throw e; 
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

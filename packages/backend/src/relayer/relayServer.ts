import pino from "pino";
import { BridgeQueue, BridgeMessage } from "./queue";
import { RelayerConfig, loadConfig } from "./config";
import { ethers } from "ethers";
import { EthWatcher, CsprWatcher } from "./watcher";
import { CasperClient, Keys } from "casper-js-sdk";
import fs from "fs";
import { RedisStateStore } from "./storage/redisStateStore";
import { BridgeEventHandler, RelayerContext } from "./handlers/BridgeEventHandler";
import { 
  EthLockedHandler, 
  WcsprBurnedHandler, 
  CsprLockedHandler, 
  CeEthBurnedHandler,
  UnlockRequestedHandler,
  UnlockFinalizedHandler,
  CeEthMintedHandler,
  CeEthMintRequestedHandler
} from "./handlers";

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
    // 注意：注册顺序可能重要，如果 msg 匹配多个 handler（虽然目前逻辑是唯一的）
    this.handlers = [
        new EthLockedHandler(),
        new WcsprBurnedHandler(),
        new CsprLockedHandler(),
        new CeEthBurnedHandler(),
        new UnlockRequestedHandler(),
        new UnlockFinalizedHandler(),
        new CeEthMintedHandler(),
        new CeEthMintRequestedHandler() // 新增
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
    
    // Watchers 初始化
    // EthWatcher 和 CsprWatcher 都会自动将解析出的事件加入到 this.queue 中
    // EthWatcher 使用回调 enqueue
    this.ethWatcher = new EthWatcher(this.ethProvider, this.cfg, (msg) =>
      this.enqueue(msg)
    );
    // CsprWatcher 内部持有 queue 引用
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
      // 继续执行，因为可能是重启后重新处理，或者不同事件ID
    }
    this.seen.add(msg.id);

    // Check persistent state
    const state = await this.stateStore.get(msg.id);
    if (state && state.status === "COMPLETED") {
        this.log.info({ id: msg.id }, "Message already completed, skipping");
        return;
    }

    this.log.info({ msg }, "Processing bridge message");
    
    // 如果状态是 FAILED，我们可能是在重试，所以更新为 PROCESSING
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
          // 如果没有 handler，可能是无关事件，或者不需要处理
          this.log.warn(`No handler found for message: ${msg.direction} - ${msg.asset}`);
          return;
      }

      await handler.handle(msg, context);

      // 注意：部分 Handler（如 UnlockRequested）可能不会立即标记为 COMPLETED，
      // 而是等待后续事件（UnlockFinalized）。
      // 所以我们这里再次检查状态，或者让 Handler 自己负责 update state。
      // 为简单起见，如果 Handler 没有抛出错误，且不是那种“中间状态”的 Handler，我们可以在这里标记完成。
      // 但更稳妥的是让 Handler 显式管理状态。
      
      // 当前所有 Handler 实现中：
      // - EthLocked: 成功后 COMPLETED
      // - WcsprBurned: 成功后 COMPLETED (deploy sent) -> 其实应该是 PENDING/PROCESSING 直到 Cspr 端的 UnlockRequested?
      //   不对，WcsprBurned 只是触发 create_unlock，这个动作完成了就是 COMPLETED。后续流程由 UnlockRequested 触发。
      // - UnlockRequested: 成功后 PROCESSING (approved, waiting for finalization)
      // - UnlockFinalized: 成功后 COMPLETED
      // - CeEthMintRequested: 成功后 PROCESSING
      // - CeEthMinted: 成功后 COMPLETED
      
      // 因此，我们**不应该**在这里强制覆盖为 COMPLETED，除非我们确定 Handler 没做。
      // 实际上，为了保险，最好让 Handler 自己决定。
      // 或者我们可以读取当前状态，如果仍是 PROCESSING 且 Handler 没报错，可能意味着它是异步流程的一部分。
      
      // 重新读取状态检查是否被 Handler 更新了
      const newState = await this.stateStore.get(msg.id);
      if (!newState || newState.status === "PROCESSING") {
          // 只有当 Handler 没更新或者仍在处理中（且没报错），我们才可能考虑默认行为。
          // 鉴于不同 Handler 逻辑不同，这里只记录日志。
          this.log.debug({ id: msg.id }, "Handler finished without error");
      }

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

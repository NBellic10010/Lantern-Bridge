import pino from "pino";
import { BridgeQueue, BridgeMessage } from "./queue";
import { RelayerConfig, loadConfig } from "./config";
import { ethers } from "ethers";
import { EthWatcher, CsprWatcher } from "./watchers";
import { CasperClient } from "casper-js-sdk";

/**
 * Relayer 主体：监听两条链、生成 BridgeMessage，执行对端动作
 * 目前只搭建脚手架，具体处理逻辑在后续补充。
 */
export class Relayer {
  private readonly log = pino({ name: "relayer", level: "info" });
  private readonly ethProvider: ethers.JsonRpcProvider;
  private readonly csprClient: CasperClient;
  private readonly cfg: RelayerConfig;
  private readonly queue: BridgeQueue;
  private readonly seen = new Set<string>(); // 简易去重
  private readonly ethWatcher: EthWatcher;
  private readonly csprWatcher: CsprWatcher;

  constructor(cfg: RelayerConfig) {
    this.cfg = cfg;
    this.ethProvider = new ethers.JsonRpcProvider(cfg.ETH_RPC);
    this.csprClient = new CasperClient(cfg.CSPR_NODE);
    this.queue = new BridgeQueue(
      {
        redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
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
    this.csprWatcher = new CsprWatcher(this.csprClient, this.cfg, (msg) =>
      this.enqueue(msg)
    );
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

    this.log.info({ msg }, "Handle bridge message (stub)");
    // TODO:
    // 1) 确认数校验（ETH/CSPR）
    // 2) 生成对端交易（mint/release 或 create_request/approve）
    // 3) 持久化状态（建议后续替换为 SQLite/DB）
  }

  /**
   * 对外暴露：推送消息进入队列
   */
  enqueue(msg: BridgeMessage) {
    void this.queue.enqueue(msg);
  }
}

// 便于独立启动
export function createRelayerFromEnv() {
  const cfg = loadConfig();
  return new Relayer(cfg);
}



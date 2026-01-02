import { Queue, Worker, QueueEvents, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";

/**
 * 标准化跨链消息
 */
export interface BridgeMessage {
  id: string; // messageId，建议 hash(srcChainId+txHash+logIndex)
  direction: "CSPR_TO_ETH" | "ETH_TO_CSPR";
  srcChainId: string;
  dstChainId: string;
  srcTxHash: string;
  logIndex?: number;
  sender: string;
  recipient: string;
  asset: string;
  amount: string;
  raw: unknown;
}

export interface QueueConfig {
  redisUrl: string;
  queueName?: string;
  concurrency?: number;
  attempts?: number;
  backoffMs?: number;
}

export class BridgeQueue {
  private readonly log = pino({ name: "bridge-queue", level: "info" });
  private readonly connection: IORedis;
  private readonly queue: Queue<BridgeMessage>;
  private readonly worker: Worker<BridgeMessage> | null;
  private readonly events: QueueEvents;

  constructor(cfg: QueueConfig, handler: (msg: BridgeMessage) => Promise<void>) {
    const name = cfg.queueName ?? "bridge-messages";
    this.connection = new IORedis(cfg.redisUrl);
    this.queue = new Queue<BridgeMessage>(name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: cfg.attempts ?? 3,
        backoff: { type: "exponential", delay: cfg.backoffMs ?? 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      } satisfies JobsOptions,
    });

    //publish events
    this.events = new QueueEvents(name, { connection: this.connection });
    this.events.on("failed", ({ jobId, failedReason }) => {
      this.log.error({ jobId, failedReason }, "job failed");
    });
    this.events.on("completed", ({ jobId }) => {
      this.log.debug({ jobId }, "job completed");
    });

    this.worker = new Worker<BridgeMessage>(
      name,
      async (job) => {
        await handler(job.data);
      },
      {
        connection: this.connection,
        concurrency: cfg.concurrency ?? 4,
      }
    );
    this.worker.on("error", (err) => {
      this.log.error({ err }, "worker error");
    });
  }

  async enqueue(type: string, msg: BridgeMessage) {
    await this.queue.add(type, msg);
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
    await this.events.close();
    await this.connection.quit();
  }
}


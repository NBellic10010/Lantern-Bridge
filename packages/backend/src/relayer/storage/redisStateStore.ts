import IORedis from "ioredis";

export interface MessageStatus {
  id: string; // bridge message ID
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  txHash?: string; // 目标链上的交易 Hash
  updatedAt: number;
  error?: string;
}

export class RedisStateStore {
  private redis: IORedis;
  private ttl = 60 * 60 * 24 * 7; // 7 days

  constructor(redisUrl: string) {
    this.redis = new IORedis(redisUrl);
  }

  // 保存状态
  async save(status: MessageStatus) {
    const key = `bridge:status:${status.id}`;
    await this.redis.set(key, JSON.stringify(status), "EX", this.ttl);
  }

  // 读取状态
  async get(id: string): Promise<MessageStatus | null> {
    const key = `bridge:status:${id}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }
}

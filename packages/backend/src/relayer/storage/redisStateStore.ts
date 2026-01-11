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
  private readonly INDEX_KEY = "bridge:transactions:zset"; // ZSET for ordered indexing
  
    constructor(redisUrl: string) {
      this.redis = new IORedis(redisUrl);
    }
  
    // 保存状态
    async save(status: MessageStatus) {
      const key = `bridge:status:${status.id}`;
    
    // 使用 Pipeline 保证原子性
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(status), "EX", this.ttl);
    // 使用 ZADD 将 ID 存入有序集合，Score 为时间戳，实现按时间排序
    pipeline.zadd(this.INDEX_KEY, status.updatedAt, status.id); 
    await pipeline.exec();
    }
  
    // 读取状态
    async get(id: string): Promise<MessageStatus | null> {
      const key = `bridge:status:${id}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    }

  // 获取最近的交易 (分页)
  async getRecent(limit: number = 20, offset: number = 0): Promise<MessageStatus[]> {
    // 1. 获取 ID 列表 (ZREVRANGE 倒序: 最新 -> 最旧)
    const targetIds = await this.redis.zrevrange(this.INDEX_KEY, offset, offset + limit - 1);
    
    if (targetIds.length === 0) return [];

    // 2. 批量获取详情
    const keys = targetIds.map(id => `bridge:status:${id}`);
    const values = await this.redis.mget(keys);

    return values
      .filter(v => v !== null)
      .map(v => JSON.parse(v as string));
  }
}

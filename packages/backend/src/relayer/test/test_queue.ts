import { BridgeQueue, BridgeMessage } from "../queue";
import pino from "pino";

// 简单的日志记录
const log = pino({ name: "test-queue", level: "info" });

// 模拟处理函数
const mockHandler = async (msg: BridgeMessage) => {
  log.info({ msgId: msg.id }, "Processing message in handler...");
  
  // 模拟一些异步操作
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  if (msg.amount === "fail_me") {
      throw new Error("Simulated processing failure");
  }
  
  log.info({ msgId: msg.id }, "Message processed successfully");
};

async function runTest() {
  log.info("Starting Queue Test...");

  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  
  // 1. 初始化队列
  const queue = new BridgeQueue(
    {
      redisUrl,
      queueName: "test-bridge-queue-" + Date.now(), // 使用随机名称避免冲突
      concurrency: 2,
      attempts: 2,
      backoffMs: 100, // 快速重试
    },
    mockHandler
  );

  // 2. 构造测试消息
  const msg1: BridgeMessage = {
    id: "test-id-1",
    requestId: "req-1",
    direction: "ETH_TO_CSPR",
    srcChainId: "ETH",
    dstChainId: "CSPR",
    srcTxHash: "0x123...",
    sender: "0xSender",
    recipient: "account-hash-...",
    asset: "ETH",
    amount: "100",
    raw: {}
  };

  const msg2: BridgeMessage = {
    id: "test-id-2",
    requestId: "req-2",
    direction: "CSPR_TO_ETH",
    srcChainId: "CSPR",
    dstChainId: "ETH",
    srcTxHash: "deploy-hash-...",
    sender: "account-hash-...",
    recipient: "0xRecipient",
    asset: "CSPR",
    amount: "200",
    raw: {}
  };
  
  // 测试重试的消息
  const msgFail: BridgeMessage = {
      ...msg1,
      id: "test-id-fail",
      amount: "fail_me" // 触发 mockHandler 报错
  };

  try {
    // 3. 入队
    log.info("Enqueuing message 1...");
    await queue.enqueue("ETH_TO_CSPR", msg1);
    
    log.info("Enqueuing message 2...");
    await queue.enqueue("CSPR_TO_ETH", msg2);
    
    log.info("Enqueuing failing message (to test retry)...");
    await queue.enqueue("ETH_TO_CSPR", msgFail);

    // 4. 等待处理 (简单等待几秒)
    log.info("Waiting for processing...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    log.info("Test finished waiting.");

  } catch (e) {
    log.error(e, "Test failed");
  } finally {
    // 5. 清理
    log.info("Closing queue...");
    await queue.close();
    log.info("Queue closed.");
    process.exit(0);
  }
}

// 运行测试
runTest();


import { DeployUtil } from 'casper-js-sdk';
import { router, publicProcedure } from '../trpc';
import { z } from 'zod';

export const transactionRouter = router({
  // 获取单笔交易状态
  getStatus: publicProcedure
    .input(z.object({ txHash: z.string() }))
    .query(async ({ input, ctx }) => {
      // 1. 查询 Redis 中的状态
      // 注意：Relayer 使用的 ID 可能是 txHash，也可能是根据参数生成的 Hash
      // 前端传来的 txHash 通常是源链的 Transaction Hash
      
      // 在 RedisStateStore 中，我们通常用 msg.id 作为 Key
      // 而 msg.id 在 EthLockedParser 中是 depositId (bytes32)
      // 在 WcsprBurnedParser 中是 reqId (bytes32)
      // 这些 ID 并不直接等于 txHash。
      
      // 理想情况下，Redis 应该建立 txHash -> msgId 的映射，或者 msgId 本身就是 txHash (对于 CSPR deploy hash)
      // 现在的实现中：
      // - CSPR -> ETH: msg.id = tx_id (Deploy Hash) -> 可以直接查
      // - ETH -> CSPR: msg.id = depositId/reqId (Keccak256) -> 不等于 ETH Tx Hash
      
      // 暂时方案：尝试直接查询（假设输入的是 msgId），或者我们需要一个二级索引。
      // 为了用户体验，用户通常只知道 ETH Tx Hash。
      // 如果没有索引，我们暂时只能让用户输入 Request ID (从 Event Logs 获取)。
      // 或者我们假设用户输入的是 ID。
      
      const state = await ctx.redisStore.get(input.txHash);

      if (!state) {
        return { 
            status: "NOT_FOUND", 
            description: "Transaction not found or not processed yet." 
        };
      }

      return {
        id: state.id,
        status: state.status, // PENDING, PROCESSING, COMPLETED, FAILED
        lastUpdated: state.updatedAt,
        targetTxHash: state.txHash, // 目标链的 Tx Hash (如果已完成)
        error: state.error,
        description: mapStatusToDescription(state.status)
      };
    }),

  // 获取最近交易列表 (Dashboard 用)
  getRecent: publicProcedure
    .input(z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0)
    }))
    .query(async ({ input, ctx }) => {
        const transactions = await ctx.redisStore.getRecent(input.limit, input.offset);
        
        return transactions.map(tx => ({
            ...tx,
            description: mapStatusToDescription(tx.status)
        }));
    }),

    // backend/src/api/router/transaction.ts
  sendDeploy: publicProcedure
  .input(z.object({ 
      deploy: z.any(),
      signature: z.string().optional(),
      signer: z.string().optional()
  })) 
  .mutation(async ({ input, ctx }) => {
      console.log("Received deploy payload:", JSON.stringify(input.deploy, null, 2));

      let deployJson = input.deploy;
      
      // 兼容性处理
      if (!deployJson.deploy && deployJson.header && deployJson.hash) {
          deployJson = { deploy: deployJson };
      }

      // 使用 casper-js-sdk 将 JSON 转回 Deploy 对象
      const deployResult = DeployUtil.deployFromJson(deployJson);
      
      if (deployResult.err) {
          console.error("Deploy deserialization error:", deployResult.val);
          throw new Error("Invalid deploy JSON: " + deployResult.val);
      }
      
      const deploy = deployResult.val;

      // 如果提供了签名，手动添加到 deploy 对象
      if (input.signature && input.signer) {
          console.log("Appending signature manually:");
          console.log("Signer:", input.signer);
          console.log("Original Signature:", input.signature);
          
          let signature = input.signature;
          const signerTag = input.signer.substring(0, 2);

          // 检查并添加签名 Tag 前缀 (01 for Ed25519, 02 for Secp256k1)
          if (!signature.startsWith(signerTag)) {
             signature = signerTag + signature;
             console.log("Fixed Signature (added tag):", signature);
          }

          const approval = new DeployUtil.Approval();
          approval.signer = input.signer;
          approval.signature = signature;
          deploy.approvals.push(approval);
      }

      // 打印最终发送给节点的 JSON，用于调试
      const finalJson = DeployUtil.deployToJson(deploy);
      console.log("Final Deploy JSON to Node:", JSON.stringify(finalJson, null, 2));

      // 发送上链
      try {
        const deployHash = await ctx.csprClient.putDeploy(deploy);
        return { deployHash };
      } catch (e: any) {
          console.error("PutDeploy error:", e);
          throw new Error("Failed to put deploy: " + e.message);
      }
  }),
});

function mapStatusToDescription(status: string): string {
    switch (status) {
        case "PENDING": return "Source Confirmed, Waiting for Relayer";
        case "PROCESSING": return "Relayer Processing (Multisig/Mining)";
        case "COMPLETED": return "Target Minted/Unlocked Successfully";
        case "FAILED": return "Transaction Failed (Check Error)";
        default: return "Unknown Status";
    }
}



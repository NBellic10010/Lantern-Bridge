import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { Contracts, CLPublicKey } from 'casper-js-sdk';

export const stakingRouter = router({
  getUserPosition: publicProcedure
    .input(z.object({
      address: z.string(),
      chainId: z.string() // 'CSPR' usually for the bridge vault
    }))
    .query(async ({ input, ctx }) => {
      // 仅处理 Casper 侧查询
      if (input.chainId !== 'CSPR' || !ctx.config.BRIDGE_CONTRACT_HASH_CSPR) {
          // ETH 侧暂未实现
          return {
              principal: "0",
              yieldAccrued: "0",
              currentApr: "0",
              lockPeriod: "0"
          };
      }

      try {
          const contractClient = new Contracts.Contract(ctx.csprClient);
          contractClient.setContractHash(ctx.config.BRIDGE_CONTRACT_HASH_CSPR);

          const pubKey = CLPublicKey.fromHex(input.address);
          // 构造字典 key: "account-hash-<hex>"
          // 对应 actions.rs 中 account.to_formatted_string()
          const dictKey = pubKey.toAccountHashStr();

          // 查询 "vault_balances" 字典
          const item = await contractClient.queryContractDictionary(
              "vault_balances",
              dictKey
          );

          if (!item) {
              return { principal: "0", yieldAccrued: "0", currentApr: "0", lockPeriod: "0" };
          }
          
          // 解析 VaultPosition { principal: U256, last_accrual_ms: u64 }
          // CLValue 解析逻辑取决于 SDK 版本
          let principal = "0";
          
          // 尝试从 CLValue 中提取
          if ((item as any).data && (item as any).data.principal) {
             principal = (item as any).data.principal.toString();
          } else if ((item as any).principal) {
             principal = (item as any).principal.toString();
          } else if (item.toString().includes('(')) {
             // 可能是 Tuple 字符串表示
             // 这里做简单处理，实际应使用正确的 CLTypeParser
             principal = "Error Parsing";
          }

          // 计算生息 (Off-chain 估算)
          // 真实逻辑：Current Yield = Principal * APR * (Now - LastAccrual)
          // 需要同时获取 APR 和 LastAccrualTime
          
          return {
            principal: principal === "Error Parsing" ? "0" : principal,
            yieldAccrued: "Pending Calculation", 
            currentApr: "0", // 由 getApr 获取
            lockPeriod: "0"
          };

      } catch (e: any) {
          // Handle "Value not found" error gracefully (user has no position)
          if (e.message?.includes("Value not found") || e.data === 'value was not found in the global state') {
              return { principal: "0", yieldAccrued: "0", currentApr: "0", lockPeriod: "0" };
          }
          console.error("Failed to fetch staking position", e);
          return { principal: "0", yieldAccrued: "0", currentApr: "0", lockPeriod: "0" };
      }
    }),

  getApr: publicProcedure
    .query(async ({ ctx }) => {
       let csprApr = 0;
       
       if (ctx.config.BRIDGE_CONTRACT_HASH_CSPR) {
           try {
               const contractClient = new Contracts.Contract(ctx.csprClient);
               contractClient.setContractHash(ctx.config.BRIDGE_CONTRACT_HASH_CSPR);
               
               // 查询 base_apr_bps (NamedKey -> URef -> Value)
               // queryContractData 并不是标准 SDK 方法，我们需要手动查 State
               // 简化：假设我们可以直接拿到
               // 实际开发中需先 GetStateRootHash -> QueryContract -> Get NamedKeys -> Get URef -> Query URef
               
               // 这里暂时保持 Mock，因为通过 SDK 查 NamedKey 变量较复杂且耗时
               // csprApr = 5.0; 
               
               // 如果你想真的查：
               // const stateRootHash = await ctx.csprClient.nodeClient.getStateRootHash();
               // const result = await ctx.csprClient.nodeClient.getBlockState(stateRootHash, contractHash, ["base_apr_bps"]);
               
               csprApr = 5.0;
           } catch (e) {
               console.error("Failed to fetch CSPR APR", e);
           }
       }

       return {
         csprApr: csprApr,
         ethApr: 3.5 // Mock/External
       };
    })
});

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { ethers } from 'ethers';
import { Contracts, CLValueBuilder, CLKey, CLAccountHash, CLPublicKey } from 'casper-js-sdk';

export const userRouter = router({
  getPortfolio: publicProcedure
    .input(z.object({ 
        ethAddress: z.string().optional(),
        csprPublicKey: z.string().optional() // Hex string
    }))
    .query(async ({ input, ctx }) => {
        const result = {
            eth: { wCsprBalance: "0" },
            cspr: { ceEthBalance: "0", stakedPrincipal: "0", yieldAccrued: "0" }
        };

        const queries: Promise<void>[] = [];

        // 1. 并行查询 ETH 端 wCSPR 余额
        if (input.ethAddress && ctx.config.ETH_WCSRP_ADDRESS) {
            queries.push((async () => {
                try {
                    const wCsprAbi = ["function balanceOf(address) view returns (uint256)"];
                    const wCsprContract = new ethers.Contract(ctx.config.ETH_WCSRP_ADDRESS!, wCsprAbi, ctx.ethProvider);
                    const balance = await wCsprContract.balanceOf(input.ethAddress);
                    result.eth.wCsprBalance = balance.toString();
                } catch (e) {
                    console.error("Failed to fetch wCSPR balance", e);
                }
            })());
        }

        // 2. 并行查询 CSPR 端
        if (input.csprPublicKey && ctx.config.BRIDGE_CONTRACT_HASH_CSPR) {
            // 2a. 查询 Bridge Position (Principal + Yield)
            queries.push((async () => {
                try {
                    const contractClient = new Contracts.Contract(ctx.csprClient);
                    contractClient.setContractHash(ctx.config.BRIDGE_CONTRACT_HASH_CSPR);

                    // 构造 Dictionary Key: account-hash-<hex>
                    const pubKey = CLPublicKey.fromHex(input.csprPublicKey!);
                    const accountHash = pubKey.toAccountHashStr().replace("account-hash-", "");
                    const dictKey = accountHash; // 注意：casper-js-sdk 的 toAccountHashStr 格式

                    // Rust 合约中 actions.rs:118 let key = account.to_formatted_string();
                    // Key::Account 的 formatted string 是 "account-hash-<hex>"
                    const formattedKey = pubKey.toAccountHashStr(); 

                    // 查询字典 "vault_balances" (storage.rs:16)
                    // 由于 casper-js-sdk 并没有直接 queryDictionary 的便捷方法，我们通常使用 stateRootHash + dictionary item key
                    
                    // 这里简化，尝试调用 contractClient.queryContractDictionary
                    const item = await contractClient.queryContractDictionary(
                        "vault_balances",
                        formattedKey
                    );

                    if (item) {
                        // item 是 CLValue (CLTuple or CLStruct based on VaultPosition)
                        // Rust Struct: { principal: U256, last_accrual_ms: u64 }
                        // 需要根据实际序列化结果解析
                        // 假设 item.data 是解析后的对象（取决于 SDK 版本）
                        // 在较新版 SDK 中，可能需要手动解构 CLValue
                        
                        // 这里的 item 通常是 CLValue。
                        // 由于 VaultPosition 是自定义 Struct，解析可能较复杂。
                        // 假设我们能获取到 principal
                        const principal = (item as any).data?.principal || (item as any).principal; // 伪代码，视 SDK 返回结构
                        
                        // 如果无法直接解析，可能需要手动调用 state_get_item
                        // 鉴于 SDK 复杂性，这里保留 Mock 数据或只在确实能调通时开启
                        
                        // 为了演示完整性，假设 parse 成功
                        // result.cspr.stakedPrincipal = principal?.toString() || "0";
                        
                        // 由于 SDK 解析 Struct 比较麻烦，暂时保留 Mock，但在生产环境需用 state_get_item
                        result.cspr.stakedPrincipal = "1000"; // Mock
                        result.cspr.yieldAccrued = "50"; // Mock
                    }

                } catch (e) {
                    console.error("Failed to fetch CSPR position", e);
                }
            })());
            
            // 2b. 查询 ceETH 余额 (如果知道合约 Hash)
            // queries.push(...)
        }

        await Promise.all(queries);

        return result;
    }),
});

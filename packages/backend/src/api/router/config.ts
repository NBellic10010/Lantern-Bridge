import { router, publicProcedure } from '../trpc';
import { ethers } from 'ethers';

export const configRouter = router({
  get: publicProcedure
    .query(async ({ ctx }) => {
        // Mock Fee
        // 实际应从合约读取 feeBps
        const mockEthFeeBps = 30; // 0.3%
        const mockCsprFeeBps = 30; // 0.3%

        return {
            supportedPairs: [
                {
                    id: "eth-cspr",
                    sourceAsset: "ETH",
                    targetAsset: "ceETH",
                    sourceChain: "ETH",
                    targetChain: "CSPR",
                    feeBps: mockEthFeeBps
                },
                {
                    id: "cspr-eth",
                    sourceAsset: "CSPR",
                    targetAsset: "wCSPR",
                    sourceChain: "CSPR",
                    targetChain: "ETH",
                    feeBps: mockCsprFeeBps
                }
            ],
            contracts: {
                ethBridge: ctx.config.BRIDGE_CONTRACT_HASH_EVM,
                csprBridge: ctx.config.BRIDGE_CONTRACT_HASH_CSPR
            }
        };
    }),
});

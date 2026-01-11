import { router, publicProcedure } from '../trpc';
import { ethers } from 'ethers';

export const statsRouter = router({
  getTVL: publicProcedure
    .query(async ({ ctx }) => {
        // Mock Data for TVL
        // 实际开发中需查询合约余额并乘以价格
        const ethTvl = "120.5"; 
        const csprTvl = "5000000";
        
        return {
            totalValueUsd: "450,230.00", // Mock USD Value
            details: {
                ethSide: { amount: ethTvl, symbol: "ETH" },
                csprSide: { amount: csprTvl, symbol: "CSPR" }
            }
        };
    }),
  
  getHistory: publicProcedure
    .query(async () => {
        return {
            totalVolume: "1,234,567",
            txCount: 156
        };
    }),
});

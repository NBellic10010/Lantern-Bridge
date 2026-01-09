import { router, publicProcedure } from '../trpc';
import { z } from 'zod';

export const stakingRouter = router({
  getUserPosition: publicProcedure
    .input(z.object({
      address: z.string(),
      chainId: z.string() // 'CSPR' usually for the bridge vault
    }))
    .query(async ({ input }) => {
      // TODO: Query the Casper contract for get_position
      // This would require a read-only call to the bridge contract
      
      // Mock return
      return {
        principal: "1000",
        yieldAccrued: "50",
        currentApr: "500", // 5% in basis points
        lockPeriod: "0"
      };
    }),

  getApr: publicProcedure
    .query(async () => {
       // TODO: Fetch current global APR from contract or config
       return {
         csprApr: 5.0, // %
         ethApr: 3.5
       };
    })
});


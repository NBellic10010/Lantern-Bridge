import { router, publicProcedure } from '../trpc';
import { z } from 'zod';

export const walletRouter = router({
  saveState: publicProcedure
    .input(z.object({
      address: z.string(),
      chainId: z.string(),
      balance: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // TODO: Implement persistent storage (e.g., Redis or Postgres)
      // For now, we'll just log or return success
      console.log(`Saving wallet state for ${input.address} on ${input.chainId}`);
      return { success: true, ...input };
    }),

  getState: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ input }) => {
      // TODO: Fetch from storage
      return { address: input.address, status: "connected" };
    }),
});


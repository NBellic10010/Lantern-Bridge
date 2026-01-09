import { router, publicProcedure } from '../trpc';
import { z } from 'zod';

// Mock data store for supported pairs
const supportedPairs = [
  {
    id: "eth-cspr",
    sourceChain: "ETH",
    targetChain: "CSPR",
    sourceAsset: "ETH",
    targetAsset: "CSPR",
    status: "active"
  },
  {
    id: "cspr-eth",
    sourceChain: "CSPR",
    targetChain: "ETH",
    sourceAsset: "CSPR",
    targetAsset: "ETH",
    status: "active"
  }
];

export const bridgeRouter = router({
  getPairs: publicProcedure
    .query(async () => {
      return supportedPairs;
    }),

  addPair: publicProcedure
    .input(z.object({
      sourceChain: z.string(),
      targetChain: z.string(),
      sourceAsset: z.string(),
      targetAsset: z.string()
    }))
    .mutation(async ({ input }) => {
      const newPair = {
        id: `${input.sourceAsset.toLowerCase()}-${input.targetAsset.toLowerCase()}`,
        ...input,
        status: "active"
      };
      supportedPairs.push(newPair);
      return newPair;
    }),

  // Note: Actual signing happens on the client side (frontend).
  // The backend API prepares the transaction data or relays the signed transaction.
  createBridgeTx: publicProcedure
    .input(z.object({
      fromChain: z.string(),
      toChain: z.string(),
      asset: z.string(),
      amount: z.string(),
      recipient: z.string(),
      sender: z.string()
    }))
    .mutation(async ({ input }) => {
      // TODO: Construct the transaction data for the user to sign
      // Or if this is for relaying a signed tx, verify and push to queue
      
      return {
        txData: "mock_tx_payload_for_signing", 
        estimatedGas: "100000",
        bridgeFee: "50"
      };
    }),
});


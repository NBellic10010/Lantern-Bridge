import { inferAsyncReturnType } from "@trpc/server";
import { CreateExpressContextOptions } from "@trpc/server/adapters/express";

export const createContext = ({ req, res }: CreateExpressContextOptions) => {
  return {
    req,
    res,
    // Add DB or other context here if needed
  };
};

export type Context = inferAsyncReturnType<typeof createContext>;

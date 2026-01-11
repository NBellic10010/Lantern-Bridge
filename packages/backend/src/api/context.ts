import { inferAsyncReturnType } from "@trpc/server";
import { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { ethers } from "ethers";
import { CasperClient } from "casper-js-sdk";
import { RedisStateStore } from "../relayer/storage/redisStateStore";
import { RelayerConfig, loadConfig } from "../relayer/config";

// 单例模式初始化服务，避免每次请求都新建连接
const config = loadConfig();
const ethProvider = new ethers.JsonRpcProvider(config.ETH_RPC);
// 用于只读查询的 Provider/Wallet (部分合约调用可能需要 Provider)
// const ethWallet = new ethers.Wallet(config.ETH_PRIVATE_KEY, ethProvider); 
const csprClient = new CasperClient(config.CSPR_NODE);
const redisStore = new RedisStateStore(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

export const createContext = ({ req, res }: CreateExpressContextOptions) => {
  return {
    req,
    res,
    config,
    ethProvider,
    csprClient,
    redisStore,
  };
};

export type Context = inferAsyncReturnType<typeof createContext>;

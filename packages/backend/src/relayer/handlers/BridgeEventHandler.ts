import { BridgeMessage } from "../queue";
import { RelayerConfig } from "../config";
import { ethers } from "ethers";
import { CasperClient, Keys } from "casper-js-sdk";
import { RedisStateStore } from "../storage/redisStateStore";

/**
 * 传递给 Handler 的上下文，包含所有必要的服务实例
 */
export interface RelayerContext {
  cfg: RelayerConfig;
  ethProvider: ethers.JsonRpcProvider;
  ethWallet: ethers.Wallet;
  csprClient: CasperClient;
  csprKeyPair: Keys.AsymmetricKey;
  stateStore: RedisStateStore;
}

/**
 * 跨链事件处理器接口
 */
export interface BridgeEventHandler {
  /**
   * 判断该 Handler 是否能处理此消息
   */
  canHandle(msg: BridgeMessage): boolean;

  /**
   * 执行处理逻辑
   */
  handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void>;
}


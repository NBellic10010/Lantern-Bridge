import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import pino from "pino";

const log = pino({ name: "handler:eth-released" });

export class EthReleasedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "CSPR_TO_ETH" && msg.sender === "bridge" && msg.dstChainId === "ETH";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`[EthReleased] Transaction ${msg.id} released successfully`);
    
    // 这是一个终态事件，标记整个流程完成
    await ctx.stateStore.save({
        id: msg.id,
        status: "COMPLETED",
        txHash: msg.srcTxHash,
        updatedAt: Date.now()
    });
  }
}


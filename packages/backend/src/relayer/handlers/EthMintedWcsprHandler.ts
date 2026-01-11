import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import pino from "pino";

const log = pino({ name: "handler:eth-minted-wcspr" });

export class EthMintedWcsprHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "CSPR_TO_ETH" && msg.sender === "bridge" && msg.asset === "wCSPR";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`[EthMintedWcspr] wCSPR Minted ${msg.id} successfully`);
    
    await ctx.stateStore.save({
        id: msg.id,
        status: "COMPLETED",
        txHash: msg.srcTxHash,
        updatedAt: Date.now()
    });
  }
}


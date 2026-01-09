import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import pino from "pino";

const log = pino({ name: "handler:ceeth-minted" });

export class CeEthMintedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "ETH_TO_CSPR" && msg.asset === "ceETH" && msg.sender === "bridge";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`[CeEthMinted] Minting ${msg.id} completed successfully`);
    
    await ctx.stateStore.save({
        id: msg.id,
        status: "COMPLETED",
        txHash: msg.srcTxHash,
        updatedAt: Date.now()
    });
  }
}


import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import pino from "pino";

const log = pino({ name: "handler:unlock-finalized" });

export class UnlockFinalizedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    // Helper to distinguish from Request by checking raw event type or inferred context
    // Ideally, msg should carry eventType info or distinct direction/asset combo
    // Here we rely on the parser setting specific fields. 
    // Since Parser 2 sets srcTxHash to deployHash, and we know it comes from Casper
    return msg.direction === "ETH_TO_CSPR" && msg.sender === "bridge" && msg.asset === "CSPR";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`[UnlockFinalized] Request ${msg.id} completed successfully`);
    
    await ctx.stateStore.save({
        id: msg.id,
        status: "COMPLETED",
        txHash: msg.srcTxHash,
        updatedAt: Date.now()
    });
  }
}


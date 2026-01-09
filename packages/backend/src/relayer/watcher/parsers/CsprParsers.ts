import { BridgeMessage } from "../../queue";
import { EventParser } from "../interfaces";

export interface CsprEventContext {
  deployHash: string;
  eventType: number;
  data: any; 
}

export class CsprLockedForTargetParser implements EventParser<CsprEventContext> {
  readonly eventType = 7;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    const { tx_id, amount, recipient, sender } = ctx.data;

    return {
      id: tx_id,
      requestId: tx_id,
      direction: "CSPR_TO_ETH",
      srcChainId: "CSPR",
      dstChainId: "ETH",
      srcTxHash: ctx.deployHash,
      sender: sender || "unknown",
      recipient: recipient, 
      asset: "CSPR",
      amount: amount, 
      raw: ctx.data
    };
  }
}

export class UnlockRequestedParser implements EventParser<CsprEventContext> {
  readonly eventType = 1;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    const { tx_id, amount, recipient, sender } = ctx.data;

    return {
      id: tx_id,
      requestId: tx_id,
      direction: "CSPR_TO_CSPR",
      srcChainId: "CSPR",
      dstChainId: "ETH",
      srcTxHash: ctx.deployHash,
      sender: sender || "unknown",
      recipient: recipient, 
      asset: "CSPR",
      amount: amount, 
      raw: ctx.data
    }
  }
}

export class UnlockFinalizedParser implements EventParser<CsprEventContext> {
  readonly eventType = 2;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    const { tx_id, amount, recipient, sender } = ctx.data;

    return {
      id: tx_id,
      requestId: tx_id,
      direction: "CSPR_TO_CSPR",
      srcChainId: "CSPR",
      dstChainId: "ETH",
      srcTxHash: ctx.deployHash,
      sender: sender || "unknown",
      recipient: recipient, 
      asset: "CSPR",
      amount: amount, 
      raw: ctx.data
    }
  }
}

export class CeEthBurnedParser implements EventParser<CsprEventContext> {
  readonly eventType = 10;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    const { tx_id, amount, eth_owner } = ctx.data;

    return {
      id: tx_id,
      requestId: tx_id,
      direction: "CSPR_TO_ETH",
      srcChainId: "CSPR",
      dstChainId: "ETH",
      srcTxHash: ctx.deployHash,
      sender: "unknown",
      recipient: eth_owner,
      asset: "ceETH",
      amount: amount,
      raw: ctx.data
    };
  }
}

import { BridgeMessage } from "../../queue";
import { EventParser } from "../interfaces";

// Matches Rust struct fields serialized to JSON
export interface CsprEventContext {
  deployHash: string;
  eventType: number;
  data: any; 
}

// Event Type 7: CsprLockedForTarget
export class CsprLockedForTargetParser implements EventParser<CsprEventContext> {
  readonly eventType = 7;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    // Rust struct: { sender, amount, dst_chain, tx_id, recipient, event_type }
    const { tx_id, amount, recipient, sender, dst_chain } = ctx.data;

    return {
      id: tx_id,
      requestId: tx_id,
      direction: "CSPR_TO_ETH",
      srcChainId: "CSPR",
      dstChainId: dst_chain || "ETH",
      srcTxHash: ctx.deployHash,
      sender: sender || "unknown",
      recipient: recipient, 
      asset: "CSPR",
      amount: amount.toString(), 
      raw: ctx.data
    };
  }
}

// Event Type 1: UnlockRequested
export class UnlockRequestedParser implements EventParser<CsprEventContext> {
  readonly eventType = 1;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    // Rust struct: { request_id, recipient, amount, src_chain, dst_chain, event_type }
    const { request_id, amount, recipient, src_chain, dst_chain } = ctx.data;

    return {
      id: request_id,
      requestId: request_id,
      direction: "ETH_TO_CSPR", // Inbound tracking
      srcChainId: src_chain || "ETH",
      dstChainId: dst_chain || "CSPR",
      srcTxHash: ctx.deployHash,
      sender: "relayer", // Triggered by relayer usually
      recipient: recipient,
      asset: "CSPR",
      amount: amount.toString(),
      raw: ctx.data
    };
  }
}

// Event Type 2: UnlockFinalized
export class UnlockFinalizedParser implements EventParser<CsprEventContext> {
  readonly eventType = 2;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    // Rust struct: { request_id, recipient, amount, event_type }
    const { request_id, amount, recipient } = ctx.data;

    return {
      id: request_id,
      requestId: request_id,
      direction: "ETH_TO_CSPR",
      srcChainId: "ETH",
      dstChainId: "CSPR",
      srcTxHash: ctx.deployHash,
      sender: "bridge",
      recipient: recipient,
      asset: "CSPR",
      amount: amount.toString(),
      raw: ctx.data
    };
  }
}

// Event Type 11: CeETHMintRequested (新增)
export class CeEthMintRequestedParser implements EventParser<CsprEventContext> {
  readonly eventType = 11;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    // Rust struct: { request_id, recipient, amount, src_chain, dst_chain, event_type }
    const { request_id, amount, recipient, src_chain, dst_chain } = ctx.data;

    return {
      id: request_id,
      requestId: request_id,
      direction: "ETH_TO_CSPR",
      srcChainId: src_chain || "ETH",
      dstChainId: dst_chain || "CSPR",
      srcTxHash: ctx.deployHash,
      sender: "relayer",
      recipient: recipient,
      asset: "ceETH", // 标识为 ceETH 请求
      amount: amount.toString(),
      raw: ctx.data
    };
  }
}

// Event Type 9: CeETHMinted
export class CeEthMintedParser implements EventParser<CsprEventContext> {
  readonly eventType = 9;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    // Rust struct: { recipient, amount, tx_id, event_type }
    const { tx_id, amount, recipient } = ctx.data;

    return {
      id: tx_id,
      requestId: tx_id,
      direction: "ETH_TO_CSPR",
      srcChainId: "ETH",
      dstChainId: "CSPR",
      srcTxHash: ctx.deployHash,
      sender: "bridge",
      recipient: recipient,
      asset: "ceETH",
      amount: amount.toString(),
      raw: ctx.data
    };
  }
}

// Event Type 10: CeETHBurned
export class CeEthBurnedParser implements EventParser<CsprEventContext> {
  readonly eventType = 10;

  parse(ctx: CsprEventContext): BridgeMessage | null {
    // Rust struct: { eth_owner, amount, tx_id, event_type }
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
      amount: amount.toString(),
      raw: ctx.data
    };
  }
}

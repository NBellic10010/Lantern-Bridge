import { ethers } from "ethers";
import { BridgeMessage } from "../../queue";
import { EventParser } from "../interfaces";

// 定义一个通用的上下文，包含事件名、参数和 Log 对象
export interface EthEventContext {
  contractAddress: string;
  eventName: string;
  args: any[];
  log: ethers.Log;
}

export class EthLockedParser implements EventParser<EthEventContext> {
  constructor(private readonly bridgeAddress: string) {}

  parse(ctx: EthEventContext): BridgeMessage | null {
    if (
      ctx.contractAddress.toLowerCase() !== this.bridgeAddress.toLowerCase() ||
      ctx.eventName !== "Locked"
    ) {
      return null;
    }

    // args: [depositId, user, token, amount, dstChain, dstAccount, strategy]
    const [depositId, user, token, amount, dstChain, dstAccount, strategy] = ctx.args;

    // 只处理跨链到 Casper 的请求
    // if (dstChain !== "CSPR") return null; // 可以加这个校验

    return {
      id: depositId,
      requestId: depositId,
      direction: "ETH_TO_CSPR",
      srcChainId: "ETH",
      dstChainId: dstChain,
      srcTxHash: ctx.log.transactionHash,
      sender: user,
      recipient: dstAccount,
      asset: token === ethers.ZeroAddress ? "ETH" : token, // 假设 0x0 代表 ETH
      amount: amount.toString(),
      raw: { depositId, dstChain, strategy },
    };
  }
}

export class WcsprBurnedParser implements EventParser<EthEventContext> {
  constructor(private readonly bridgeAddress: string) {}

  parse(ctx: EthEventContext): BridgeMessage | null {
    if (
      ctx.contractAddress.toLowerCase() !== this.bridgeAddress.toLowerCase() ||
      ctx.eventName !== "BurnedwCSPR"
    ) {
      return null;
    }

    // args: [reqId, from, amount, dstAccount]
    const [reqId, from, amount, dstAccount] = ctx.args;

    return {
      id: reqId,
      requestId: reqId,
      direction: "ETH_TO_CSPR",
      srcChainId: "ETH",
      dstChainId: "CSPR",
      srcTxHash: ctx.log.transactionHash,
      sender: from,
      recipient: dstAccount,
      asset: "CSPR", // wCSPR burned -> native CSPR unlock
      amount: amount.toString(),
      raw: { reqId },
    };
  }
}

export class EthReleasedParser implements EventParser<EthEventContext> {
  constructor(private readonly bridgeAddress: string) {}

  parse(ctx: EthEventContext): BridgeMessage | null {
    if (
      ctx.contractAddress.toLowerCase() !== this.bridgeAddress.toLowerCase() ||
      ctx.eventName !== "Released"
    ) {
      return null;
    }

    // args: [depositId, user, amount]
    const [depositId, user, amount] = ctx.args;

    return {
      id: depositId,
      requestId: depositId,
      direction: "CSPR_TO_ETH", // Inbound completion
      srcChainId: "ETH", // Event on ETH
      dstChainId: "ETH", // Completed on ETH
      srcTxHash: ctx.log.transactionHash,
      sender: "bridge",
      recipient: user,
      asset: "ETH/ERC20", 
      amount: amount.toString(),
      raw: { depositId },
    };
  }
}

export class MintedWcsprParser implements EventParser<EthEventContext> {
  constructor(private readonly bridgeAddress: string) {}

  parse(ctx: EthEventContext): BridgeMessage | null {
    if (
      ctx.contractAddress.toLowerCase() !== this.bridgeAddress.toLowerCase() ||
      ctx.eventName !== "MintedwCSPR"
    ) {
      return null;
    }

    // args: [reqId, to, amount]
    const [reqId, to, amount] = ctx.args;

    return {
      id: reqId, // 此处的 reqId 对应 Casper 端的 tx_id
      requestId: reqId,
      direction: "CSPR_TO_ETH", // Inbound completion
      srcChainId: "ETH", 
      dstChainId: "ETH",
      srcTxHash: ctx.log.transactionHash,
      sender: "bridge",
      recipient: to,
      asset: "wCSPR",
      amount: amount.toString(),
      raw: { reqId },
    };
  }
}

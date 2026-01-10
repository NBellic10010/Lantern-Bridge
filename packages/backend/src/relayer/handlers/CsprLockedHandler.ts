import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import { ethers } from "ethers";
import pino from "pino";

const log = pino({ name: "handler:cspr-locked" });

const WCSPR_ABI = [
  "function mint(address to, uint256 amount) external", 
];

//CSPR被锁定，铸造wCSPR
//目前eth端不关心多签，只需要记录这个行为到数据库，等待用户在eth端销毁wCSPR后，relayer在CSPR链上监听并调用eth合约，调用eth bridge合约的release_wcsrp_entry entry point
export class CsprLockedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "CSPR_TO_ETH" && msg.asset === "CSPR";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`Handling CSPR Lock event: ${msg.id}`);

    if (!ctx.cfg.ETH_WCSRP_ADDRESS) {
        throw new Error("ETH_WCSRP_ADDRESS not configured");
    }

    const wcspr = new ethers.Contract(ctx.cfg.ETH_WCSRP_ADDRESS, WCSPR_ABI, ctx.ethWallet);
    
    log.info(`Minting WCSPR to ${msg.recipient} amount ${msg.amount}`);
    
    const tx = await wcspr.mint(msg.recipient, BigInt(msg.amount));
    await tx.wait();
    
    log.info(`Minted WCSPR: ${tx.hash}`);

    await ctx.stateStore.save({
        id: msg.id,
        status: "COMPLETED",
        txHash: tx.hash,
        updatedAt: Date.now()
    });
  }
}


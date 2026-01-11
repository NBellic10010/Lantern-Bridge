import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import { ethers } from "ethers";
import pino from "pino";

const log = pino({ name: "handler:ceeth-burned" });

//ceETH被销毁，通知ETH解锁
const VAULT_ABI = [
  "function release(address payable recipient, uint256 amount, bytes32 burnTx) external",
];

export class CeEthBurnedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "CSPR_TO_ETH" && msg.asset === "ceETH";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`Handling ceETH Burn event: ${msg.id}`);

    if (!ctx.cfg.BRIDGE_CONTRACT_HASH_EVM) {
        throw new Error("BRIDGE_CONTRACT_HASH_EVM not configured");
    }

    const vault = new ethers.Contract(ctx.cfg.BRIDGE_CONTRACT_HASH_EVM, VAULT_ABI, ctx.ethWallet);
    const burnTxHash = "0x" + msg.srcTxHash; // Ensure format match if needed

    log.info(`Releasing ETH to ${msg.recipient} amount ${msg.amount}`);
    
    const tx = await vault.release(msg.recipient, BigInt(msg.amount), burnTxHash);
    await tx.wait();
    
    log.info(`Released ETH: ${tx.hash}`);

    await ctx.stateStore.save({
        id: msg.id,
        status: "COMPLETED",
        txHash: tx.hash,
        updatedAt: Date.now()
    });
  }
}


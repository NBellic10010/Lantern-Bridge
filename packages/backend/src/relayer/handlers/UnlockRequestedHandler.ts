import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import pino from "pino";
import { Contracts, RuntimeArgs, CLValueBuilder } from "casper-js-sdk";

const log = pino({ name: "handler:unlock-requested" });

//用户在CSPR链上发起解锁请求
//relayer 在CSPR链上监听并创建deploy，调用approve_unlock_entry entry point
export class UnlockRequestedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "ETH_TO_CSPR" && msg.asset === "CSPR" && msg.sender === "relayer";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`[UnlockRequested] Tracking request ${msg.id}`);

    // 1. 更新状态为 PROCESSING
    await ctx.stateStore.save({
        id: msg.id,
        status: "PROCESSING", 
        txHash: msg.srcTxHash,
        updatedAt: Date.now()
    });

    // 2. 作为 Guardian 进行 Approve
    try {
        log.info(`[UnlockRequested] Approving unlock request ${msg.requestId} on Casper...`);

        const contractClient = new Contracts.Contract(ctx.csprClient);
        // Config key from config.ts is BRIDGE_CONTRACT_HASH_CSPR
        const contractHash = ctx.cfg.BRIDGE_CONTRACT_HASH_CSPR;
        contractClient.setContractHash(contractHash);

        // 准备参数：根据 entrypoints.rs，approve_unlock_entry 只需要 request_id
        const args = RuntimeArgs.fromMap({
            "request_id": CLValueBuilder.string(msg.requestId)
        });

        // 构造 Deploy 调用 approve_unlock_entry
        // 使用 Relayer 的密钥对 (ctx.csprKeyPair) 进行签名，它必须是 Guardian
        const deploy = contractClient.callEntrypoint(
            "approve_unlock_entry", // entry point name
            args,
            ctx.csprKeyPair.publicKey,
            ctx.cfg.CSPR_CHAIN_ID,
            String(ctx.cfg.GAS_CSPR), // Payment amount
            [ctx.csprKeyPair] // Signing keys
        );

        // 发送交易
        const deployHash = await ctx.csprClient.putDeploy(deploy);
        log.info(`[UnlockRequested] Approval sent: ${deployHash}`);

        // 我们不在这里标记为 COMPLETED，而是等待 UnlockFinalized 事件
        // 这样可以确保链上逻辑确实执行成功了
        
    } catch (e: any) {
        log.error(e, `[UnlockRequested] Failed to approve unlock request ${msg.id}`);
        // 记录失败状态
        await ctx.stateStore.save({
            id: msg.id,
            status: "FAILED",
            error: e.message,
            updatedAt: Date.now()
        });
        throw e;
    }
  }
}

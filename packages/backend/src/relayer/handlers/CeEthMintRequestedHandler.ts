import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import pino from "pino";
import { Contracts, RuntimeArgs, CLValueBuilder } from "casper-js-sdk";

const log = pino({ name: "handler:ceeth-mint-requested" });

//用户在ETH链上锁定ETH，发起铸造ceETH请求
//relayer 在CSPR链上监听并创建deploy，调用approve_ceeth_mint_entry entry point
export class CeEthMintRequestedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "ETH_TO_CSPR" && msg.asset === "ceETH" && msg.sender === "relayer";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`[CeEthMintRequested] Tracking mint request ${msg.id}`);

    // 1. 更新状态为 PROCESSING
    await ctx.stateStore.save({
        id: msg.id,
        status: "PROCESSING", 
        txHash: msg.srcTxHash,
        updatedAt: Date.now()
    });

    // 2. 作为 Guardian 进行 Approve
    try {
        log.info(`[CeEthMintRequested] Approving mint request ${msg.requestId} on Casper...`);

        const contractClient = new Contracts.Contract(ctx.csprClient);
        const contractHash = ctx.cfg.BRIDGE_CONTRACT_HASH_CSPR;
        contractClient.setContractHash(contractHash);

        const args = RuntimeArgs.fromMap({
            "request_id": CLValueBuilder.string(msg.requestId)
        });

        const deploy = contractClient.callEntrypoint(
            "approve_ceeth_mint_entry", // entry point name
            args,
            ctx.csprKeyPair.publicKey,
            ctx.cfg.CSPR_CHAIN_ID,
            String(ctx.cfg.GAS_CSPR),
            [ctx.csprKeyPair]
        );

        const deployHash = await ctx.csprClient.putDeploy(deploy);
        log.info(`[CeEthMintRequested] Approval sent: ${deployHash}`);

    } catch (e: any) {
        log.error(e, `[CeEthMintRequested] Failed to approve mint request ${msg.id}`);
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


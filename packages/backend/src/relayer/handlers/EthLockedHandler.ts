import { BridgeMessage } from "../queue";
import { BridgeEventHandler, RelayerContext } from "./BridgeEventHandler";
import { DeployUtil, RuntimeArgs, CLValueBuilder, CLURef } from "casper-js-sdk";
import pino from "pino";

const log = pino({ name: "handler:eth-locked" });

export class EthLockedHandler implements BridgeEventHandler {
  canHandle(msg: BridgeMessage): boolean {
    return msg.direction === "ETH_TO_CSPR" && msg.asset === "ETH";
  }

  async handle(msg: BridgeMessage, ctx: RelayerContext): Promise<void> {
    log.info(`Handling ETH Lock event: ${msg.id}`);

    // ETH Locked on Ethereum -> Create ceETH Mint Request on Casper
    const entryPoint = "create_ceeth_mint_request";
    const bridgeContractHash = ctx.cfg.BRIDGE_CONTRACT_HASH_CSPR;

    log.info(`Calling Casper contract ${bridgeContractHash} entrypoint ${entryPoint}`);

    const bridgeContractHashHex = Buffer.from(bridgeContractHash, "hex");
    const bridgeContractHashBytes = Uint8Array.from(bridgeContractHashHex);

    const args = RuntimeArgs.fromMap({
        "amount": CLValueBuilder.u256(msg.amount),
        "recipient": CLValueBuilder.key(CLURef.fromFormattedStr(msg.recipient)), // Assuming msg.recipient is a valid Casper Key hex
        "tx_id": CLValueBuilder.string(msg.srcTxHash),
        "src_chain": CLValueBuilder.string("ETH"),
        "dst_chain": CLValueBuilder.string("CSPR"),
        "request_id": CLValueBuilder.string(msg.requestId)
    });

    const DeployParams = new DeployUtil.DeployParams(ctx.csprKeyPair.publicKey, ctx.cfg.CSPR_CHAIN_ID);
    const session = DeployUtil.ExecutableDeployItem.newStoredContractByHash(
      bridgeContractHashBytes,
      entryPoint,
      args
    );

    const payment = DeployUtil.standardPayment(ctx.cfg.GAS_CSPR);

    const deploy = DeployUtil.makeDeploy(DeployParams, session, payment);

    const signedDeploy = DeployUtil.signDeploy(deploy, ctx.csprKeyPair);

    const deployHash = await ctx.csprClient.putDeploy(signedDeploy);
    
    log.info(`Deploy sent: ${deployHash}`);
    
    await ctx.stateStore.save({
        id: msg.id,
        status: "COMPLETED",
        txHash: deployHash,
        updatedAt: Date.now()
    });
  }
}


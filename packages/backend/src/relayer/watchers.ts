import { ethers } from "ethers";
import { CasperClient } from "casper-js-sdk";
import { RelayerConfig } from "./config";
import { BridgeMessage, BridgeQueue } from "./queue";
import EventSource from "eventsource";
import pino from "pino";

type EnqueueFn = (msg: BridgeMessage) => void;
const CASPER_EVENTS_PORT = 9927;

export class EthWatcher {
  constructor(
    private readonly provider: ethers.JsonRpcProvider,
    private readonly cfg: RelayerConfig,
    private readonly enqueue: EnqueueFn
  ) {}

  async start() {
    // TODO: 监听 EthBridgeVault / WrappedCSPR 事件：
    //  - EthLocked(depositId...) => ETH->CSPR
    //  - Burned(dstTx...)       => CSPR->ETH 解锁
    //  - Minted(srcTx...)       => CSPR->ETH 铸造确认
    //  需要 ABI: vaultAbi / wcAbi
    //  需要确认数: cfg.ETH_CONFIRMATIONS
    //  生成 BridgeMessage 后调用 this.enqueue(msg)
    const { ETH_VAULT_ADDRESS, ETH_WCSRP_ADDRESS, ETH_RPC, ETH_CONFIRMATIONS } =
      this.cfg;
    
    // eslint-disable-next-line no-console
    console.info("[EthWatcher] Starting...", {
      ETH_VAULT_ADDRESS,
      ETH_WCSRP_ADDRESS,
      ETH_RPC,
    });

    if (ETH_VAULT_ADDRESS) {
      const vault = new ethers.Contract(
        ETH_VAULT_ADDRESS,
        [
          "event EthLocked(address indexed sender, uint256 amount, bytes32 indexed depositId, string dstChain, string dstAccount)",
        ],
        this.provider
      );

      vault.on(
        "EthLocked",
        (sender, amount, depositId, dstChain, dstAccount, event) => {
          // Confirmations check implies waiting for blocks, but .on() fires immediately.
          // In production, we might fetch logs with confirmations or check block depth.
          // For simplicity here, we assume the provider handles basic reorgs or we trust it.
          // Ideally: wait x blocks before enqueueing.
          
          this.enqueue({
            id: depositId, // unique ID from event
            direction: "ETH_TO_CSPR",
            srcChainId: "Sepolia", // or from config
            dstChainId: dstChain,
            srcTxHash: event.log.transactionHash,
            sender,
            recipient: dstAccount,
            asset: "ETH",
            amount: amount.toString(),
            raw: { depositId, dstChain },
          });
        }
      );
      console.info("[EthWatcher] Listening on Vault at", ETH_VAULT_ADDRESS);
    }

    if (ETH_WCSRP_ADDRESS) {
      const wcspr = new ethers.Contract(
        ETH_WCSRP_ADDRESS,
        [
          "event Burned(address indexed from, uint256 amount, bytes32 indexed dstTx)",
        ],
        this.provider
      );

      wcspr.on("Burned", (from, amount, dstTx, event) => {
        this.enqueue({
          id: dstTx,
          direction: "ETH_TO_CSPR",
          srcChainId: "ETH",
          dstChainId: "CSPR", // Implicit
          srcTxHash: event.log.transactionHash,
          sender: from,
          recipient: "", // Burn event in WrappedCSPR usually implies sender is recipient or embedded in dstTx? 
                         // Looking at WrappedCSPR.sol, 'dstTx' is bytes32. It's an ID, not an address.
                         // Where is the recipient? 
                         // Usually 'dstTx' is the 'request_id' for Casper. The recipient is the user who burned.
                         // But if user burns for SOMEONE ELSE, we need a recipient param.
                         // Current WrappedCSPR.burn(amount, dstTx) doesn't have recipient param.
                         // Assumption: sender on ETH == recipient on CSPR? Or dstTx contains info?
                         // Let's assume sender for now, or maybe the Bridge logic uses dstTx as a lookup?
                         // Actually, 'create_unlock_request' on Casper needs a 'recipient'.
                         // If WrappedCSPR doesn't record it, we might be stuck.
                         // Standard practice: burn(amount, recipient_str)
          recipient: from, // Fallback: send back to same account (if key format compatible?) or derived?
          asset: "CSPR",   // Burned wCSPR means unlocking native CSPR
          amount: amount.toString(),
          raw: { dstTx },
        });
      });
      console.info("[EthWatcher] Listening on wCSPR at", ETH_WCSRP_ADDRESS);
    }
  }
}

export class CsprWatcher {
    private lastEventId: number = 0; // 用于断点续传的关键
    private eventSrouceUrl: string = "";
    private eventSource: EventSource | null = null;
    private readonly bridgeContractHash: string = "";

  constructor(
    private readonly client: CasperClient,
    private readonly cfg: RelayerConfig,
    private mQueue: BridgeQueue // 传入
    // private readonly enqueue: EnqueueFn
  ) {}

  

  private async handleDeploy(deployData: any) {
    const deployHash = deployData.hash
    const executionResult = deployData.execution_result;

    // check if the deploy is successful (Success == true)
    if (!executionResult.Success) return;

    // B. 检查是否调用了我们的 Bridge 合约
    // 这需要深入解析 execution_effect，这部分逻辑比较繁琐
    // 通常我们检查 events 里有没有我们要的 Topic
    const transforms = executionResult.Success.effect.transforms;
    
    // ... 这里省略具体的解析逻辑，你需要遍历 transforms 找到 WriteCLValue
    // 并判断是不是你的合约发出的 AEGIS_LOCK 事件 ...
    
    const foundMyEvent = this.parseTransformsForLockEvent(transforms);

    if (foundMyEvent) {
      console.log(` Detected Lock Event: ${deployHash}`);
      // 扔进 BullMQ，让 Worker 去干活
    //   await this.MQ.enqueue({
    //     type: "CASPER_TO_ETH",
    //     data: foundMyEvent
    //   });
      await this.mQueue?.enqueue("CASPER_TO_ETH", foundMyEvent);
    }
  }

  async start() {
    let log = pino({ name: "cspr-watcher", level: "info" });
    log.info("CSPR watcher starting...");
    // TODO: 轮询 Casper 区块/Deploy：
    //  - CsprLockedForEth / CeETHBurned => CSPR->ETH
    //  - CeETHMinted / UnlockFinalized  => ETH->CSPR 确认
    //  按 CSPR_FINALITY_DEPTH 做确认，解析 emit_event，生成 BridgeMessage 后 enqueue
    
    const { CSPR_NODE, CSPR_POLL_MS, CSPR_FINALITY_DEPTH } = this.cfg;
    log.info({
      CSPR_NODE,
      CSPR_POLL_MS,
      CSPR_FINALITY_DEPTH,
    }, "CSPR watcher starting...");
    // eslint-disable-next-line no-console

    // initialize cspr event source
    this.eventSrouceUrl = `http://${CSPR_NODE}:${CASPER_EVENTS_PORT}/events/main`;
    const eventActualUrl = this.lastEventId > 0 
      ? `${this.eventSrouceUrl}?start_from=${this.lastEventId}` 
      : this.eventSrouceUrl;
    this.eventSource = new EventSource(eventActualUrl);

    this.eventSource.addEventListener(
        "DeployProcessed", (event) => {
            if (event.lastEventId) {
                this.lastEventId = parseInt(event.lastEventId);
            }

            const deployData = JSON.parse(event.data);
            this.handleDeploy(deployData);
        }
    )

    // handle events
    this.eventSource.onmessage = (event) => {
      log.info({ event }, "CSPR event received");
    };
    this.eventSource.onerror = (event) => {
      log.error({ event }, "CSPR event error");
    };
    this.eventSource.onopen = () => {
      log.info("CSPR event source connected");
    };

  }
}
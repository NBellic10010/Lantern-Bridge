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
    // 占位日志，便于后续实现时观察配置
    // eslint-disable-next-line no-console
    console.info("[ETH watcher stub]", {
      ETH_VAULT_ADDRESS,
      ETH_WCSRP_ADDRESS,
      ETH_RPC,
      ETH_CONFIRMATIONS,
    });
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
import { ethers } from "ethers";
import { RelayerConfig } from "../config";
import { BridgeMessage } from "../queue";
import { IWatcher, EventParser } from "./interfaces";
import { EthEventContext, EthLockedParser, WcsprBurnedParser } from "./parsers/EthParsers";
import pino from "pino";

export class EthWatcher implements IWatcher {
  private readonly log = pino({ name: "watcher:eth" });
  private parsers: EventParser<EthEventContext>[] = [];
  private contracts: ethers.Contract[] = [];

  constructor(
    private provider: ethers.JsonRpcProvider,
    private cfg: RelayerConfig,
    private enqueue: (msg: BridgeMessage) => void
  ) {
    // 假设 Bridge 合约同时负责 Lock 和 Burn (Router 模式)
    if (cfg.ETH_VAULT_ADDRESS) {
      this.parsers.push(new EthLockedParser(cfg.ETH_VAULT_ADDRESS));
      this.parsers.push(new WcsprBurnedParser(cfg.ETH_VAULT_ADDRESS));
    }
  }

  async start() {
    this.log.info("Starting ETH Watcher...");
    
    if (!this.cfg.ETH_VAULT_ADDRESS) {
        this.log.warn("ETH_VAULT_ADDRESS not configured, skipping ETH watching");
        return;
    }

    const bridge = new ethers.Contract(
        this.cfg.ETH_VAULT_ADDRESS,
        [
            "event Locked(bytes32 indexed depositId, address indexed user, address token, uint256 amount, string dstChain, string dstAccount, uint8 strategy)",
            "event BurnedwCSPR(bytes32 indexed reqId, address indexed from, uint256 amount, string dstAccount)"
        ],
        this.provider
    );

    // 监听 Locked
    bridge.on("Locked", (...args) => {
        const event = args[args.length - 1]; // 最后一个是 EventLog
        const params = args.slice(0, args.length - 1); // 前面是参数
        this.processEvent({
            contractAddress: this.cfg.ETH_VAULT_ADDRESS!,
            eventName: "Locked",
            args: params,
            log: event
        });
    });

    // 监听 BurnedwCSPR
    bridge.on("BurnedwCSPR", (...args) => {
        const event = args[args.length - 1];
        const params = args.slice(0, args.length - 1);
        this.processEvent({
            contractAddress: this.cfg.ETH_VAULT_ADDRESS!,
            eventName: "BurnedwCSPR",
            args: params,
            log: event
        });
    });

    this.contracts.push(bridge);
    this.log.info(`Listening on Bridge at ${this.cfg.ETH_VAULT_ADDRESS}`);
  }

  private processEvent(ctx: EthEventContext) {
      for (const parser of this.parsers) {
          try {
              const msg = parser.parse(ctx);
              if (msg) {
                  this.log.info({ id: msg.id, type: msg.asset }, "Event parsed");
                  this.enqueue(msg);
                  return; 
              }
          } catch (e) {
              this.log.error({ err: e }, "Error parsing ETH event");
          }
      }
  }
}


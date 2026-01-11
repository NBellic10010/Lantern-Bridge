import { ethers } from "ethers";
import { RelayerConfig } from "../config";
import { BridgeMessage } from "../queue";
import { IWatcher, EventParser } from "./interfaces";
import { EthEventContext, EthLockedParser, WcsprBurnedParser, EthReleasedParser, MintedWcsprParser } from "./parsers/EthParsers";
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
    if (cfg.BRIDGE_CONTRACT_HASH_EVM) {
      this.parsers.push(new EthLockedParser(cfg.BRIDGE_CONTRACT_HASH_EVM));
      this.parsers.push(new WcsprBurnedParser(cfg.BRIDGE_CONTRACT_HASH_EVM));
      this.parsers.push(new EthReleasedParser(cfg.BRIDGE_CONTRACT_HASH_EVM));
      this.parsers.push(new MintedWcsprParser(cfg.BRIDGE_CONTRACT_HASH_EVM)); // 新增
    }
  }

  async start() {
    this.log.info("Starting ETH Watcher...");
    
    if (!this.cfg.BRIDGE_CONTRACT_HASH_EVM) {
        this.log.warn("BRIDGE_CONTRACT_HASH_EVM not configured, skipping ETH watching");
        return;
    }

    const bridge = new ethers.Contract(
        this.cfg.BRIDGE_CONTRACT_HASH_EVM,
        [
            "event Locked(bytes32 indexed depositId, address indexed user, address token, uint256 amount, string dstChain, string dstAccount, uint8 strategy)",
            "event BurnedwCSPR(bytes32 indexed reqId, address indexed from, uint256 amount, string dstAccount)",
            "event Released(bytes32 indexed depositId, address indexed user, uint256 amount)",
            "event MintedwCSPR(bytes32 indexed reqId, address indexed to, uint256 amount)" // 新增事件 ABI
        ],
        this.provider
    );

    // 监听 Locked
    bridge.on("Locked", (...args) => {
        const event = args[args.length - 1];
        const params = args.slice(0, args.length - 1);
        this.processEvent({
            contractAddress: this.cfg.BRIDGE_CONTRACT_HASH_EVM!,
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
            contractAddress: this.cfg.BRIDGE_CONTRACT_HASH_EVM!,
            eventName: "BurnedwCSPR",
            args: params,
            log: event
        });
    });

    // 监听 Released
    bridge.on("Released", (...args) => {
        const event = args[args.length - 1];
        const params = args.slice(0, args.length - 1);
        this.processEvent({
            contractAddress: this.cfg.BRIDGE_CONTRACT_HASH_EVM!,
            eventName: "Released",
            args: params,
            log: event
        });
    });

    // 新增：监听 MintedwCSPR
    bridge.on("MintedwCSPR", (...args) => {
        const event = args[args.length - 1];
        const params = args.slice(0, args.length - 1);
        this.processEvent({
            contractAddress: this.cfg.BRIDGE_CONTRACT_HASH_EVM!,
            eventName: "MintedwCSPR",
            args: params,
            log: event
        });
    });

    this.contracts.push(bridge);
    this.log.info(`Listening on Bridge at ${this.cfg.BRIDGE_CONTRACT_HASH_EVM}`);
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

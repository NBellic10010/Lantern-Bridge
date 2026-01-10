import { RelayerConfig } from "../config";
import { BridgeMessage, BridgeQueue } from "../queue";
import { IWatcher, EventParser } from "./interfaces";
import { 
    CsprEventContext, 
    CsprLockedForTargetParser, 
    CeEthBurnedParser,
    UnlockRequestedParser,
    UnlockFinalizedParser,
    CeEthMintedParser,
    CeEthMintRequestedParser
} from "./parsers/CsprParsers";
import { CasperClient } from "casper-js-sdk";
import EventSource from "eventsource";
import pino from "pino";

const CASPER_EVENTS_PORT = 9927;

export class CsprWatcher implements IWatcher {
  private readonly log = pino({ name: "watcher:cspr" });
  private parserMap = new Map<number, EventParser<CsprEventContext>>();
  
  constructor(
    private client: CasperClient,
    private cfg: RelayerConfig,
    private queue: BridgeQueue 
  ) {
    // Register all parsers
    this.register(new CsprLockedForTargetParser());
    this.register(new CeEthBurnedParser());
    this.register(new UnlockRequestedParser());
    this.register(new UnlockFinalizedParser());
    this.register(new CeEthMintedParser());
    this.register(new CeEthMintRequestedParser()); // 新增
  }

  private register(parser: EventParser<CsprEventContext>) {
      if (typeof parser.eventType === 'number') {
          this.parserMap.set(parser.eventType, parser);
      }
  }

  async start() {
    this.log.info("Starting CSPR Watcher...");
    const url = `http://${this.cfg.CSPR_NODE}:${CASPER_EVENTS_PORT}/events/main`;
    
    const es = new EventSource(url);
    
    es.addEventListener("DeployProcessed", (event: any) => {
        try {
            const deploy = JSON.parse(event.data);
            this.handleDeploy(deploy);
        } catch (e) {
            this.log.error(e, "Failed to parse deploy event");
        }
    });
    
    this.log.info(`Listening on CSPR node ${this.cfg.CSPR_NODE}`);
  }

  private async handleDeploy(deploy: any) {
      if (!deploy.execution_result.Success) return;
      
      const events = this.extractEventsFromDeploy(deploy);
      
      for (const event of events) {
          this.processEvent(event);
      }
  }

  private extractEventsFromDeploy(deploy: any): CsprEventContext[] {
      const events: CsprEventContext[] = [];
      const executionResult = deploy.execution_result?.Success;

      if (!executionResult) return [];

      const messages = executionResult.messages || [];
      
      for (const msg of messages) {
          if (msg.topic_name === "LTEvents") {
              const hexPayload = typeof msg.payload === 'string' ? msg.payload : msg.payload?.String;
              if (hexPayload) {
                  try {
                      let jsonString = hexPayload;
                      if (/^[0-9a-fA-F]+$/.test(hexPayload)) {
                          const decoded = Buffer.from(hexPayload, 'hex').toString('utf8');
                          if (decoded.trim().startsWith('{')) {
                              jsonString = decoded;
                          }
                      }
                      
                      const eventObj = JSON.parse(jsonString);
                      
                      if (typeof eventObj.event_type === 'number') {
                          events.push({
                              deployHash: deploy.deploy_hash || "",
                              eventType: eventObj.event_type,
                              data: eventObj
                          });
                      }
                  } catch (e) {
                      // this.log.warn("Failed to parse message payload as JSON", e);
                  }
              }
          }
      }
      return events;
  }

  private processEvent(ctx: CsprEventContext) {
      const typeId = ctx.eventType;
      const parser = this.parserMap.get(typeId);
      
      if (parser) {
          const msg = parser.parse(ctx);
          if (msg) {
              this.log.info({ id: msg.id, type: typeId }, "CSPR Event Parsed");
              this.queue.enqueue(msg.direction, msg);
          }
      }
  }
}

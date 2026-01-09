import { RelayerConfig } from "../config";
import { BridgeMessage, BridgeQueue } from "../queue";
import { IWatcher, EventParser } from "./interfaces";
import { CsprEventContext, CsprLockedForTargetParser, CeEthBurnedParser } from "./parsers/CsprParsers";
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
    this.register(new CsprLockedForTargetParser());
    this.register(new CeEthBurnedParser());
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

      // 尝试查找 execution_result.messages (适用于 emit_message)
      // 注意：不同版本节点返回结构可能不同，需兼容
      const messages = executionResult.messages || [];

      for (const msg of messages) {
          if (msg.topic_name === "LTEvents") {
              const hexPayload = typeof msg.payload === 'string' ? msg.payload : msg.payload?.String;
              if (hexPayload) {
                  // const event_type = this.getEventType(hexPayload);
                  const jsonHex = hexPayload.slice(8);
                  const jsonString = Buffer.from(jsonHex, "hex").toString("utf-8");
                  console.log("JSON String:", jsonString);

                  const eventObj = JSON.parse(jsonString);

                  events.push({
                      deployHash: deploy.deploy_hash || "",
                      eventType: eventObj.event_type,
                      data: eventObj
                  });

                  const parser = this.parserMap.get(eventObj.event_type);
                  if (parser) {
                      const msg = parser.parse({
                          deployHash: deploy.deploy_hash || "",
                          eventType: eventObj.event_type,
                          data: eventObj
                      });
                      if (msg) {
                          this.log.info({ id: msg.id }, "CSPR Event Parsed");
                          this.queue.enqueue(msg.direction, msg);
                      }
                  }
              }
          }
      }
      return events;
  }

  private processEvent(ctx: CsprEventContext) {
      const typeId = ctx.data?.event_type;
      
      if (typeof typeId === 'number') {
          const parser = this.parserMap.get(typeId);
          if (parser) {
              const msg = parser.parse(ctx);
              if (msg) {
                  this.log.info({ id: msg.id }, "CSPR Event Parsed");
                  this.queue.enqueue(msg.direction, msg);
              }
          }
      }
  }
}



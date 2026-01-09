import { RelayerConfig } from "../config";
import { BridgeMessage, BridgeQueue } from "../queue";
import { IWatcher, EventParser } from "./interfaces";
import { 
    CsprEventContext, 
    CsprLockedForTargetParser, 
    CeEthBurnedParser,
    UnlockRequestedParser,
    UnlockFinalizedParser,
    CeEthMintedParser
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
                  // Assuming payload matches "message" created in emit: MessagePayload::from(json_string)
                  // Casper serializes MessagePayload as bytes. If it was created from String, it might be raw string bytes or hex encoded bytes depending on node version.
                  // Based on events.rs: MessagePayload::from(json_string) -> String variant.
                  // Usually node returns it as is if it's String. But checking hex just in case.
                  
                  try {
                      let jsonString = hexPayload;
                      // Heuristic: if it looks like hex and decodes to valid JSON, use it.
                      // But MessagePayload::from(string) in Rust usually results in a String variant in JSON RPC.
                      // If 'msg.payload' is actually a string, it might be the direct JSON string.
                      
                      // If the user's `events.rs` logic `hex::encode(json_string)` was commented out (as per my previous suggestion to user), 
                      // then `MessagePayload::from(json_string)` creates a CLValue::String internally? 
                      // Actually `MessagePayload` is `Vec<u8>` under the hood in some versions, or `String` in others.
                      // In `casper_types`, `MessagePayload` is often a wrapper around `String` or `Vec<u8>`.
                      
                      // Let's assume the user followed `MessagePayload::from(json_string)`.
                      // If `json_string` is passed, `MessagePayload` (which is `String` type alias or struct) holds it.
                      // If the RPC returns it as hex-encoded string of the UTF8 bytes:
                      if (/^[0-9a-fA-F]+$/.test(hexPayload)) {
                          // Try decoding hex to string
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
                      // It might not be our event or format is different
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

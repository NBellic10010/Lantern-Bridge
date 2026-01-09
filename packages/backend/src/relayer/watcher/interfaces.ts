import { BridgeMessage } from "../queue";

export interface IWatcher {
  start(): Promise<void>;
  stop?(): Promise<void>;
}

/**
 * 通用事件解析器接口
 * TRawEvent: 原始事件类型 (ethers.Log, Casper Deploy info, etc.)
 */
export interface EventParser<TRawEvent> {
  // 声明该 Parser 处理的事件类型 ID（主要用于 Casper 这种需要预判的场景）
  // 对于 ETH 这种基于 topic 订阅的，可以是可选的或者设为 null
  readonly eventType?: number | string; 

  parse(event: TRawEvent): BridgeMessage | null;
}



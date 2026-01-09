import { z } from "zod";

/**
 * 对应 Rust 中的 EventType 枚举 (u8)
 * Source: packages/contracts/bridge_core/src/events.rs
 */
export enum EventType {
  Locked = 0,
  UnlockRequested = 1,
  UnlockFinalized = 2,
  HotSwapProposed = 3,
  HotSwapActivated = 4,
  PauseChanged = 5,
  YieldAccrued = 6,
  CsprLockedForTarget = 7,
  CsprLockedFromTarget = 8,
  CeETHMinted = 9,
  CeETHBurned = 10,
}

// 基础字段类型定义
const KeySchema = z.string().describe("Casper Key formatted string (e.g. account-hash-...)");
const U256Schema = z.string().describe("U256 as numeric string");

// 1. CsprLockedForTarget
// 场景: 用户在 Casper 锁定 CSPR，准备跨链到 ETH
export const CsprLockedForTargetSchema = z.object({
  sender: KeySchema,
  amount: U256Schema,
  dst_chain: z.string(),
  tx_id: z.string(),
  recipient: z.string(), // ETH address string
  event_type: z.literal(EventType.CsprLockedForTarget),
});

// 2. CeETHBurned
// 场景: 用户在 Casper 销毁 ceETH，准备赎回 ETH
export const CeETHBurnedSchema = z.object({
  eth_owner: z.string(), // ETH address string
  amount: U256Schema,
  tx_id: z.string(),
  event_type: z.literal(EventType.CeETHBurned),
});

// 3. UnlockRequested
// 场景: Relayer 收到 ETH 销毁事件，在 Casper 发起解锁请求
export const UnlockRequestedSchema = z.object({
  request_id: z.string(),
  recipient: KeySchema,
  amount: U256Schema,
  src_chain: z.string(),
  dst_chain: z.string(),
  event_type: z.literal(EventType.UnlockRequested),
});

// 4. UnlockFinalized
// 场景: 多签达成，CSPR 资金释放给用户
export const UnlockFinalizedSchema = z.object({
  request_id: z.string(),
  recipient: KeySchema,
  amount: U256Schema,
  event_type: z.literal(EventType.UnlockFinalized),
});

// 5. CeETHMinted
// 场景: 多签达成，ceETH 铸造给用户
export const CeETHMintedSchema = z.object({
  recipient: KeySchema,
  amount: U256Schema,
  tx_id: z.string(),
  event_type: z.literal(EventType.CeETHMinted),
});

// 其他管理事件 (可选，Relayer 暂时可能不关心，但为了完整性定义)
export const HotSwapProposedSchema = z.object({
  patch_hash: z.string(),
  proposer: KeySchema,
  event_type: z.literal(EventType.HotSwapProposed),
});

export const HotSwapActivatedSchema = z.object({
  patch_hash: z.string(),
  event_type: z.literal(EventType.HotSwapActivated),
});

export const PauseChangedSchema = z.object({
  paused: z.boolean(),
  event_type: z.literal(EventType.PauseChanged),
});

// 聚合类型 (Discriminated Union)，方便自动推导
export const CasperEventSchema = z.discriminatedUnion("event_type", [
  CsprLockedForTargetSchema,
  CeETHBurnedSchema,
  UnlockRequestedSchema,
  UnlockFinalizedSchema,
  CeETHMintedSchema,
  HotSwapProposedSchema,
  HotSwapActivatedSchema,
  PauseChangedSchema
]);

export type CasperEvent = z.infer<typeof CasperEventSchema>;
export type CsprLockedForTarget = z.infer<typeof CsprLockedForTargetSchema>;
export type CeETHBurned = z.infer<typeof CeETHBurnedSchema>;


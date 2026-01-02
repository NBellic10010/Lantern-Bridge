//! 数据类型定义
extern crate alloc;

use alloc::{string::String, vec::Vec};
use casper_types::{ApiError, Key, U256};
use casper_types_derive::{CLTyped, FromBytes, ToBytes};

#[repr(u16)]
pub enum BridgeError {
    PermissionDenied = 65,
    InsufficientFunds = 66,
    TxAlreadyProcessed = 67, // 防重放
    TransferFailed = 68,
    InvalidRequest = 69,
    InvalidSignature = 70,
    InvalidTimestamp = 71,
    InvalidAmount = 72,
    InvalidAddress = 73,
    InvalidAsset = 74,
    InvalidChain = 75,
    InvalidNetwork = 76,
    InvalidProtocol = 77,
    InvalidKey = 78,
    MissingKey = 79,
    Paused = 80,
    TokenNotSet = 81,
    AllowanceTooLow = 82,
}

impl From<BridgeError> for ApiError {
    fn from(error: BridgeError) -> Self {
        ApiError::User(error as u16)
    }
}

/// Guardian 节点的权重配置
#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct Guardian {
    pub key: Key,
    pub weight: u8,
}

/// 合约基础配置
#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct BridgeConfig {
    pub admin: Key,
    pub threshold: u32,
    pub base_apr_bps: u32,
    pub paused: bool,
}

/// 用户在生息池中的头寸
#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct VaultPosition {
    pub principal: U256,
    pub last_accrual_ms: u64,
}

/// 待解锁的跨链请求
#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct UnlockRequest {
    pub id: String,            // 跨链消息哈希/唯一ID
    pub recipient: Key,        // 目标链接收人（Casper 侧）
    pub amount: U256,          // 解锁金额
    pub src_chain: String,     // 来源链
    pub dst_chain: String,     // 目标链
    pub timestamp_ms: u64,     // 请求时间
    pub finalized: bool,       // 是否已经完成
    pub approvals_weight: u32, // 已累计的权重
}

/// 热升级/热修复的 Patch
#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct HotSwapPatch {
    pub patch_hash: String,   // 新 wasm/逻辑的哈希标识
    pub proposer: Key,        // 提案人
    pub approved_weight: u32, // 已审批的权重
    pub activated: bool,      // 是否已激活
}

/// 守护节点合集
#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct Guardians {
    pub list: Vec<Guardian>,
}

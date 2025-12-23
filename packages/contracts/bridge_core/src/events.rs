//! 事件定义与便捷触发
extern crate alloc;

use alloc::string::String;
use casper_contract::contract_api::runtime;
use casper_types::{
    bytesrepr::{FromBytes, ToBytes},
    CLTyped, Key, U256,
};

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct Locked {
    pub sender: Key,
    pub amount: U256,
    pub dst_chain: String,
    pub tx_id: String,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct UnlockRequested {
    pub request_id: String,
    pub recipient: Key,
    pub amount: U256,
    pub src_chain: String,
    pub dst_chain: String,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct UnlockFinalized {
    pub request_id: String,
    pub recipient: Key,
    pub amount: U256,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct HotSwapProposed {
    pub patch_hash: String,
    pub proposer: Key,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct HotSwapActivated {
    pub patch_hash: String,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct PauseChanged {
    pub paused: bool,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct YieldAccrued {
    pub account: Key,
    pub principal_after: U256,
}

pub fn emit<T: CLTyped + ToBytes + FromBytes>(event: T) {
    runtime::emit_event(event);
}

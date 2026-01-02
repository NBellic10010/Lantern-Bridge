//! 事件定义与便捷触发
extern crate alloc;

use alloc::{string::String, vec::Vec};
use casper_contract::contract_api::runtime;
use casper_types::{
    bytesrepr::{Error, FromBytes, ToBytes},
    contract_messages::MessagePayload,
    CLTyped, Key, U256,
};
use casper_types_derive::{CLTyped, FromBytes, ToBytes};
use hex;

#[derive(Clone, Debug)]
pub enum EventType {
    Locked(u8),
    UnlockRequested(u8),
    UnlockFinalized(u8),
    HotSwapProposed(u8),
    HotSwapActivated(u8),
    PauseChanged(u8),
    YieldAccrued(u8),
    CsprLockedForTarget(u8),
    CsprLockedFromTarget(u8),
    CeETHMinted(u8),
    CeETHBurned(u8),
}

impl EventType {
    pub const LOCKED: EventType = EventType::Locked(0);
    pub const UNLOCK_REQUESTED: EventType = EventType::UnlockRequested(1);
    pub const UNLOCK_FINALIZED: EventType = EventType::UnlockFinalized(2);
    pub const HOT_SWAP_PROPOSED: EventType = EventType::HotSwapProposed(3);
    pub const HOT_SWAP_ACTIVATED: EventType = EventType::HotSwapActivated(4);
    pub const PAUSE_CHANGED: EventType = EventType::PauseChanged(5);
    pub const YIELD_ACCRUED: EventType = EventType::YieldAccrued(6);
    pub const CSPR_LOCKED_FOR_TARGET: EventType = EventType::CsprLockedForTarget(7);
    pub const CSPR_LOCKED_FROM_TARGET: EventType = EventType::CsprLockedFromTarget(8);
    pub const CEETH_MINTED: EventType = EventType::CeETHMinted(9);
    pub const CEETH_BURNED: EventType = EventType::CeETHBurned(10);

    fn serialized_length(&self) -> usize {
        1
    }
}

impl CLTyped for EventType {
    fn cl_type() -> casper_types::CLType {
        casper_types::CLType::U8
    }
}

impl ToBytes for EventType {
    fn to_bytes(&self) -> Result<Vec<u8>, Error> {
        let value = match self {
            EventType::Locked(v) => *v,
            EventType::UnlockRequested(v) => *v,
            EventType::UnlockFinalized(v) => *v,
            EventType::HotSwapProposed(v) => *v,
            EventType::HotSwapActivated(v) => *v,
            EventType::PauseChanged(v) => *v,
            EventType::YieldAccrued(v) => *v,
            EventType::CsprLockedForTarget(v) => *v,
            EventType::CsprLockedFromTarget(v) => *v,
            EventType::CeETHMinted(v) => *v,
            EventType::CeETHBurned(v) => *v,
        };
        value.to_bytes()
    }

    fn serialized_length(&self) -> usize {
        1
    }
}

impl FromBytes for EventType {
    fn from_bytes(bytes: &[u8]) -> Result<(Self, &[u8]), Error> {
        let (value, rem) = u8::from_bytes(bytes)?;
        let event_type = match value {
            0 => EventType::Locked(0),
            1 => EventType::UnlockRequested(1),
            2 => EventType::UnlockFinalized(2),
            3 => EventType::HotSwapProposed(3),
            4 => EventType::HotSwapActivated(4),
            5 => EventType::PauseChanged(5),
            6 => EventType::YieldAccrued(6),
            7 => EventType::CsprLockedForTarget(7),
            8 => EventType::CsprLockedFromTarget(8),
            9 => EventType::CeETHMinted(9),
            10 => EventType::CeETHBurned(10),
            _ => return Err(Error::Formatting),
        };
        Ok((event_type, rem))
    }
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct Locked {
    pub sender: Key,
    pub amount: U256,
    pub dst_chain: String,
    pub tx_id: String,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct UnlockRequested {
    pub request_id: String,
    pub recipient: Key,
    pub amount: U256,
    pub src_chain: String,
    pub dst_chain: String,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct UnlockFinalized {
    pub request_id: String,
    pub recipient: Key,
    pub amount: U256,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct HotSwapProposed {
    pub patch_hash: String,
    pub proposer: Key,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct HotSwapActivated {
    pub patch_hash: String,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct PauseChanged {
    pub paused: bool,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct YieldAccrued {
    pub account: Key,
    pub principal_after: U256,
    pub event_type: EventType,
}

//for cspr to eth bridge only (for now we only support cspr to eth bridge)
#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct CsprLockedForTarget {
    pub sender: Key,
    pub amount: U256,
    pub dst_chain: String,
    pub tx_id: String,
    pub recipient: String, // stores recipient address on target chain(currently only eth)
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct CsprLockedFromTarget {
    pub recipient: Key,
    pub amount: U256,
    pub src_chain: String, // stores source chain(currently only eth)
    pub tx_id: String,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct CeETHMinted {
    pub recipient: Key,
    pub amount: U256,
    pub tx_id: String,
    pub event_type: EventType,
}

#[derive(Clone, Debug, CLTyped, ToBytes, FromBytes)]
pub struct CeETHBurned {
    pub eth_owner: String,
    pub amount: U256,
    pub tx_id: String,
    pub event_type: EventType,
}

pub fn emit<T: CLTyped + ToBytes + FromBytes>(event: T) {
    let bytes = event.to_bytes().unwrap();
    let hex_string = hex::encode(bytes);
    let message = MessagePayload::from(hex_string);
    runtime::emit_message("LTEvents", &message);
}

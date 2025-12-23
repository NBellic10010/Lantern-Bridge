#![no_std]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    contracts::{EntryPoint, EntryPointAccess, EntryPointType, EntryPoints},
    runtime_args, CLType, CLTyped, Key, Parameter, RuntimeArgs, U256,
};

use crate::{
    actions::{
        approve_hot_swap, approve_unlock, create_unlock_request, init, lock, propose_hot_swap,
        set_pause, transfer_admin, update_apr,
    },
    types::{Guardian, VaultPosition},
};

// ==============
// Entry Points
// ==============

#[no_mangle]
pub extern "C" fn call() {
    let admin: Key = runtime::get_named_arg("admin");
    let guardians: Vec<Guardian> = runtime::get_named_arg("guardians");
    let threshold: u16 = runtime::get_named_arg("threshold");
    let base_apr_bps: u16 = runtime::get_named_arg("base_apr_bps");

    let mut entry_points = EntryPoints::new();

    entry_points.add_entry_point(EntryPoint::new(
        "init",
        vec![
            Parameter::new("admin", Key::cl_type()),
            Parameter::new("guardians", <Vec<Guardian> as CLTyped>::cl_type()),
            Parameter::new("threshold", u16::cl_type()),
            Parameter::new("base_apr_bps", u16::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "lock",
        vec![
            Parameter::new("amount", U256::cl_type()),
            Parameter::new("dst_chain", String::cl_type()),
            Parameter::new("tx_id", String::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "create_unlock_request",
        vec![
            Parameter::new("request_id", String::cl_type()),
            Parameter::new("recipient", Key::cl_type()),
            Parameter::new("amount", U256::cl_type()),
            Parameter::new("src_chain", String::cl_type()),
            Parameter::new("dst_chain", String::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "approve_unlock",
        vec![Parameter::new("request_id", String::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "propose_hot_swap",
        vec![Parameter::new("patch_hash", String::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "approve_hot_swap",
        vec![Parameter::new("patch_hash", String::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "set_pause",
        vec![Parameter::new("paused", bool::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "update_apr",
        vec![Parameter::new("new_apr_bps", u16::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "transfer_admin",
        vec![Parameter::new("new_admin", Key::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "get_position",
        vec![Parameter::new("account", Key::cl_type())],
        <VaultPosition as CLTyped>::cl_type(),
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let (package_hash, access_token) = storage::create_contract_package_at_hash();
    runtime::put_key("bridge_core_package_hash", package_hash.into());
    runtime::put_key("bridge_core_package_access", access_token.into());

    let (contract_hash, _version) =
        storage::add_contract_version(package_hash, entry_points, Default::default());

    runtime::put_key("bridge_core_contract_hash", contract_hash.into());

    // 初始化
    runtime::call_contract::<()>(
        contract_hash,
        "init",
        runtime_args! {
            "admin" => admin,
            "guardians" => guardians,
            "threshold" => threshold,
            "base_apr_bps" => base_apr_bps,
        },
    );
}

#[no_mangle]
pub extern "C" fn init() {
    let admin: Key = runtime::get_named_arg("admin");
    let guardians: Vec<Guardian> = runtime::get_named_arg("guardians");
    let threshold: u16 = runtime::get_named_arg("threshold");
    let base_apr_bps: u16 = runtime::get_named_arg("base_apr_bps");
    action::init(admin, guardians, threshold, base_apr_bps);
}

#[no_mangle]
pub extern "C" fn lock_entry() {
    let amount: U256 = runtime::get_named_arg("amount");
    let dst_chain: String = runtime::get_named_arg("dst_chain");
    let tx_id: String = runtime::get_named_arg("tx_id");
    lock(amount, dst_chain, tx_id);
}

#[no_mangle]
pub extern "C" fn create_unlock_request_entry() {
    let request_id: String = runtime::get_named_arg("request_id");
    let recipient: Key = runtime::get_named_arg("recipient");
    let amount: U256 = runtime::get_named_arg("amount");
    let src_chain: String = runtime::get_named_arg("src_chain");
    let dst_chain: String = runtime::get_named_arg("dst_chain");
    create_unlock_request(request_id, recipient, amount, src_chain, dst_chain);
}

#[no_mangle]
pub extern "C" fn approve_unlock_entry() {
    let request_id: String = runtime::get_named_arg("request_id");
    approve_unlock(request_id);
}

#[no_mangle]
pub extern "C" fn propose_hot_swap_entry() {
    let patch_hash: String = runtime::get_named_arg("patch_hash");
    propose_hot_swap(patch_hash);
}

#[no_mangle]
pub extern "C" fn approve_hot_swap_entry() {
    let patch_hash: String = runtime::get_named_arg("patch_hash");
    approve_hot_swap(patch_hash);
}

#[no_mangle]
pub extern "C" fn set_pause_entry() {
    let paused: bool = runtime::get_named_arg("paused");
    set_pause(paused);
}

#[no_mangle]
pub extern "C" fn update_apr_entry() {
    let new_apr_bps: u16 = runtime::get_named_arg("new_apr_bps");
    update_apr(new_apr_bps);
}

#[no_mangle]
pub extern "C" fn transfer_admin_entry() {
    let new_admin: Key = runtime::get_named_arg("new_admin");
    transfer_admin(new_admin);
}

#[no_mangle]
pub extern "C" fn get_position_entry() {
    let account: Key = runtime::get_named_arg("account");
    let pos = crate::actions::get_position(account);
    runtime::ret(pos);
}

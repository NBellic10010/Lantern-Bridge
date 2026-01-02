extern crate alloc;

use alloc::{string::String, vec::Vec};
use casper_contract::contract_api::{runtime, storage};
use casper_types::{
    contracts::{EntryPoint, EntryPoints},
    runtime_args, CLType, CLTyped, CLValue, EntryPointAccess, EntryPointType, Key, Parameter, U256,
};

use crate::{
    actions::{
        approve_ceeth_mint, approve_hot_swap, approve_unlock, burn_ceeth_for_eth,
        create_ceeth_mint_request, create_unlock_request, lock_cspr_for_eth, propose_hot_swap,
        set_ceeth_token_entry, set_pause, transfer_admin, update_apr,
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
    let threshold: u32 = runtime::get_named_arg("threshold");
    let base_apr_bps: u32 = runtime::get_named_arg("base_apr_bps");

    let mut entry_points = EntryPoints::new();

    entry_points.add_entry_point(EntryPoint::new(
        "init",
        alloc::vec![
            Parameter::new("admin", Key::cl_type()),
            Parameter::new("guardians", <Vec<Guardian> as CLTyped>::cl_type()),
            Parameter::new("threshold", u32::cl_type()),
            Parameter::new("base_apr_bps", u32::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "lock",
        alloc::vec![
            Parameter::new("amount", U256::cl_type()),
            Parameter::new("dst_chain", String::cl_type()),
            Parameter::new("tx_id", String::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "create_unlock_request",
        alloc::vec![
            Parameter::new("request_id", String::cl_type()),
            Parameter::new("recipient", Key::cl_type()),
            Parameter::new("amount", U256::cl_type()),
            Parameter::new("src_chain", String::cl_type()),
            Parameter::new("dst_chain", String::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "approve_unlock",
        alloc::vec![Parameter::new("request_id", String::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "propose_hot_swap",
        alloc::vec![Parameter::new("patch_hash", String::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "approve_hot_swap",
        alloc::vec![Parameter::new("patch_hash", String::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "set_pause",
        alloc::vec![Parameter::new("paused", bool::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "update_apr",
        alloc::vec![Parameter::new("new_apr_bps", u32::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "transfer_admin",
        alloc::vec![Parameter::new("new_admin", Key::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "get_position",
        alloc::vec![Parameter::new("account", Key::cl_type())],
        <VaultPosition as CLTyped>::cl_type(),
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "set_ceeth_token",
        alloc::vec![Parameter::new("token", Key::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "lock_cspr_for_eth",
        alloc::vec![
            Parameter::new("amount", U256::cl_type()),
            Parameter::new("tx_id", String::cl_type()),
            Parameter::new("dst_chain", String::cl_type()),
            Parameter::new("recipient", String::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "create_ceeth_mint_request",
        alloc::vec![
            Parameter::new("request_id", String::cl_type()),
            Parameter::new("recipient", Key::cl_type()),
            Parameter::new("amount", U256::cl_type()),
            Parameter::new("src_chain", String::cl_type()),
            Parameter::new("dst_chain", String::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "approve_ceeth_mint",
        alloc::vec![Parameter::new("request_id", String::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "burn_ceeth_for_eth",
        alloc::vec![
            Parameter::new("amount", U256::cl_type()),
            Parameter::new("tx_id", String::cl_type()),
            Parameter::new("eth_owner", String::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    let (package_hash, access_token) = storage::create_contract_package_at_hash();
    runtime::put_key("bridge_core_package_hash", package_hash.into());
    runtime::put_key("bridge_core_package_access", access_token.into());

    let (contract_hash, _version) = storage::add_contract_version(
        package_hash,
        entry_points.into(),
        Default::default(),
        Default::default(),
    );

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
    let threshold: u32 = runtime::get_named_arg("threshold");
    let base_apr_bps: u32 = runtime::get_named_arg("base_apr_bps");
    crate::actions::init(admin, guardians, threshold, base_apr_bps);
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
    let new_apr_bps: u32 = runtime::get_named_arg("new_apr_bps");
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
    runtime::ret(CLValue::from_t(pos).unwrap());
}

#[no_mangle]
pub extern "C" fn set_ceeth_token_entrypoint() {
    let token: Key = runtime::get_named_arg("token");
    set_ceeth_token_entry(token);
}

#[no_mangle]
pub extern "C" fn lock_cspr_for_eth_entry() {
    let amount: U256 = runtime::get_named_arg("amount");
    let tx_id: String = runtime::get_named_arg("tx_id");
    let dst_chain: String = runtime::get_named_arg("dst_chain");
    let recipient: String = runtime::get_named_arg("recipient");
    lock_cspr_for_eth(amount, tx_id, dst_chain, recipient);
}

#[no_mangle]
pub extern "C" fn create_ceeth_mint_request_entry() {
    let request_id: String = runtime::get_named_arg("request_id");
    let recipient: Key = runtime::get_named_arg("recipient");
    let amount: U256 = runtime::get_named_arg("amount");
    let src_chain: String = runtime::get_named_arg("src_chain");
    let dst_chain: String = runtime::get_named_arg("dst_chain");
    create_ceeth_mint_request(request_id, recipient, amount, src_chain, dst_chain);
}

#[no_mangle]
pub extern "C" fn approve_ceeth_mint_entry() {
    let request_id: String = runtime::get_named_arg("request_id");
    approve_ceeth_mint(request_id);
}

#[no_mangle]
pub extern "C" fn burn_ceeth_for_eth_entry() {
    let amount: U256 = runtime::get_named_arg("amount");
    let tx_id: String = runtime::get_named_arg("tx_id");
    let eth_owner: String = runtime::get_named_arg("eth_owner");
    burn_ceeth_for_eth(amount, tx_id, eth_owner);
}

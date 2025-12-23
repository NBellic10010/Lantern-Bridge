use crate::types::{BridgeError, Guardian};
use alloc::{string::String, vec::Vec};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    bytesrepr::{FromBytes, ToBytes},
    CLTyped, Key, URef,
};

// ==========================================
// 1. 常量定义 (数据库表名)
// ==========================================
pub const DICT_PROCESSED_TXS: &str = "processed_txs"; // 记录已处理交易 (防重放)
pub const DICT_BALANCES: &str = "vault_balances"; // 用户生息金库
pub const DICT_UNLOCK_REQS: &str = "unlock_requests"; // 解锁请求
pub const DICT_GUARDIANS: &str = "guardian_weights"; // 守护节点权重 用于投票 （守护节点是多个节点组成的，每个节点有不同的权重）
pub const DICT_HOTSWAP: &str = "hotswap_patches";
pub const DICT_HOTSWAP_VOTES: &str = "hotswap_votes";
pub const DICT_UNLOCK_VOTES: &str = "unlock_votes";
pub const KEY_ADMIN: &str = "admin"; // 管理员 Key
pub const KEY_THRESHOLD: &str = "threshold";
pub const KEY_BASE_APR_BPS: &str = "base_apr_bps";
pub const KEY_PAUSED: &str = "paused";
pub const KEY_ACTIVE_PATCH: &str = "active_patch";

// ==========================================
// 2. 核心工具函数 (Generic Helpers)
// ==========================================

/// 获取当前上下文中的 URef (从 NamedKeys 里找)
fn get_uref(name: &str) -> URef {
    let key = runtime::get_key(name)
        .ok_or(BridgeError::MissingKey)
        .unwrap_or_revert();
    key.into_uref()
        .ok_or(BridgeError::InvalidKey)
        .unwrap_or_revert()
}

/// 从字典中读取数据 (Generic Read)
pub fn read_dictionary_value<T: CLTyped + FromBytes>(
    dictionary_name: &str,
    key: &str,
) -> Option<T> {
    // 1. 获取字典的种子 URef
    let dictionary_seed_uref = get_uref(dictionary_name);

    // 2. 从字典读取
    storage::dictionary_get(dictionary_seed_uref, key).unwrap_or_revert()
}

/// 向字典写入数据 (Generic Write)
pub fn write_dictionary_value<T: CLTyped + ToBytes>(dictionary_name: &str, key: &str, value: T) {
    // 1. 获取字典的种子 URef
    let dictionary_seed_uref = get_uref(dictionary_name);

    // 2. 写入字典
    storage::dictionary_put(dictionary_seed_uref, key, value);
}

// ==========================================
// 3. 业务封装函数 (Business Specific)
// ==========================================

/// 检查这笔交易 Hash 是否已经处理过？
pub fn is_tx_processed(tx_hash: &str) -> bool {
    // 从 DICT_PROCESSED_TXS 字典里读，如果没有值，默认为 false
    read_dictionary_value::<bool>(DICT_PROCESSED_TXS, tx_hash).unwrap_or(false)
}

/// 标记交易为“已处理”
pub fn mark_tx_processed(tx_hash: &str) {
    write_dictionary_value(DICT_PROCESSED_TXS, tx_hash, true);
}

/// 读取管理员地址 (用于权限检查)
pub fn get_admin() -> Key {
    let admin_uref = get_uref(KEY_ADMIN);
    storage::read(admin_uref)
        .unwrap_or_revert()
        .ok_or(BridgeError::MissingKey)
        .unwrap_or_revert()
}

/// 设置管理员 (仅初始化或移交权限时用)
pub fn set_admin(admin: Key) {
    let admin_uref = get_uref(KEY_ADMIN);
    storage::write(admin_uref, admin);
}

/// 读取 Guardian 权重
pub fn get_guardian_weight(key: &Key) -> Option<u8> {
    let dictionary_seed_uref = get_uref(DICT_GUARDIANS);
    storage::dictionary_get(dictionary_seed_uref, &key.to_formatted_string()).unwrap_or_revert()
}

/// 初始化守护节点配置
pub fn save_guardians(guardians: Vec<Guardian>) {
    let dict = get_uref(DICT_GUARDIANS);
    for g in guardians {
        storage::dictionary_put(dict, &g.key.to_formatted_string(), g.weight);
    }
}

/// 创建必要的 NamedKey（字典或单值）
pub fn ensure_dictionaries() {
    let dicts = [
        DICT_PROCESSED_TXS,
        DICT_BALANCES,
        DICT_UNLOCK_REQS,
        DICT_GUARDIANS,
        DICT_HOTSWAP,
        DICT_HOTSWAP_VOTES,
        DICT_UNLOCK_VOTES,
    ];
    //遍历字典列表，如果字典不存在，则创建字典，并设置为空

    for name in dicts {
        if runtime::get_key(name).is_none() {
            let uref = storage::new_dictionary(name).unwrap_or_revert();
            runtime::put_key(name, uref.into());
        }
    }
}

/// 初始化/写入基础配置
pub fn write_base_config(threshold: u16, apr_bps: u16, paused: bool) {
    let threshold_uref = get_or_create_uref(KEY_THRESHOLD, threshold);
    storage::write(threshold_uref, threshold);

    let apr_uref = get_or_create_uref(KEY_BASE_APR_BPS, apr_bps);
    storage::write(apr_uref, apr_bps);

    let paused_uref = get_or_create_uref(KEY_PAUSED, paused);
    storage::write(paused_uref, paused);

    let active_patch = get_or_create_uref(KEY_ACTIVE_PATCH, String::new());
    storage::write(active_patch, String::new());
}

/// 读取阈值
pub fn read_threshold() -> u16 {
    let uref = get_uref(KEY_THRESHOLD);

    storage::read()

    // storage::read(uref)
    //     .unwrap_or_revert()
    //     .ok_or(BridgeError::MissingKey)
    //     .unwrap_or_revert()
}

/// 读取 APR
pub fn read_apr_bps() -> u16 {
    let uref = get_uref(KEY_BASE_APR_BPS);
    storage::read(uref)
        .unwrap_or_revert()
        .ok_or(BridgeError::MissingKey)
        .unwrap_or_revert()
}

/// 读取暂停状态
pub fn is_paused() -> bool {
    let uref = get_uref(KEY_PAUSED);
    storage::read(uref).unwrap_or_revert().unwrap_or(false)
}

/// 设置暂停状态
pub fn set_paused(paused: bool) {
    let uref = get_uref(KEY_PAUSED);
    storage::write(uref, paused);
}

/// 辅助：获取或创建单值 URef
fn get_or_create_uref<T: CLTyped + ToBytes>(name: &str, default: T) -> URef {
    match runtime::get_key(name) {
        Some(key) => key.into_uref().unwrap_or_revert(),
        None => {
            let uref = storage::new_uref(default);
            runtime::put_key(name, uref.into());
            uref
        }
    }
}

/// 读取当前生效的补丁哈希
pub fn read_active_patch() -> Option<String> {
    runtime::get_key(KEY_ACTIVE_PATCH)
        .and_then(|k| k.into_uref())
        .and_then(|u| storage::read::<String>(u).unwrap_or_revert())
}

/// 写入当前生效的补丁哈希
pub fn write_active_patch(hash: String) {
    let uref = get_or_create_uref(KEY_ACTIVE_PATCH, hash.clone());
    storage::write(uref, hash);
}

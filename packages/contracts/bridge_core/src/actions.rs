//! 合约业务逻辑与入口函数
extern crate alloc;

use alloc::{format, string::String, vec::Vec};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{bytesrepr::FromBytes, CLTyped, Key, U256};

use crate::{
    events::{
        emit, HotSwapActivated, HotSwapProposed, Locked, PauseChanged, UnlockFinalized,
        UnlockRequested, YieldAccrued,
    },
    storage::{
        ensure_dictionaries, get_admin, get_guardian_weight, is_paused, is_tx_processed,
        mark_tx_processed, read_apr_bps, read_dictionary_value, read_threshold, set_admin,
        set_paused, write_active_patch, write_base_config, write_dictionary_value, DICT_BALANCES,
        DICT_HOTSWAP, DICT_UNLOCK_REQS, KEY_ADMIN,
    },
    types::{BridgeError, Guardian, HotSwapPatch, UnlockRequest, VaultPosition},
    utils::compute_yield,
};

/// 确保调用者为管理员
fn ensure_admin() {
    let caller = runtime::get_caller();
    if caller != get_admin() {
        runtime::revert(BridgeError::PermissionDenied);
    }
}

/// 检查是否暂停
fn ensure_not_paused() {
    if is_paused() {
        runtime::revert(BridgeError::Paused);
    }
}

/// 获取当前毫秒时间
fn now_ms() -> u64 {
    runtime::get_blocktime().into()
}

/// 读取并计提用户生息
fn accrue_position(account: &Key) -> VaultPosition {
    let key = account.to_formatted_string();
    let mut position: VaultPosition =
        read_dictionary_value(DICT_BALANCES, &key).unwrap_or(VaultPosition {
            principal: U256::zero(),
            last_accrual_ms: now_ms(),
        });

    let current = now_ms();
    if current > position.last_accrual_ms {
        let delta = current - position.last_accrual_ms;
        let apr = read_apr_bps();
        let interest = compute_yield(position.principal, apr, delta);
        position.principal = position.principal.saturating_add(interest);
        position.last_accrual_ms = current;
        emit(YieldAccrued {
            account: *account,
            principal_after: position.principal,
        });
    }

    position
}

/// 写回用户头寸
fn save_position(account: &Key, pos: VaultPosition) {
    let key = account.to_formatted_string();
    write_dictionary_value(DICT_BALANCES, &key, pos);
}

/// 初始化合约
pub fn init(admin: Key, guardians: Vec<Guardian>, threshold: u16, base_apr_bps: u16) {
    // 创建必要存储
    ensure_dictionaries();

    // 写入管理员、阈值、APR、暂停标志
    let admin_uref = storage::new_uref(admin);
    runtime::put_key(KEY_ADMIN, admin_uref.into());
    write_base_config(threshold, base_apr_bps, false);

    // 保存守护权重
    crate::storage::save_guardians(guardians);
}

/// 充值锁定并进入生息池
pub fn lock(amount: U256, dst_chain: String, tx_id: String) {
    ensure_not_paused();

    if amount.is_zero() {
        runtime::revert(BridgeError::InvalidAmount);
    }

    if is_tx_processed(&tx_id) {
        runtime::revert(BridgeError::TxAlreadyProcessed);
    }

    let caller = runtime::get_caller();
    let mut pos = accrue_position(&caller);
    pos.principal = pos.principal.saturating_add(amount);
    save_position(&caller, pos);

    mark_tx_processed(&tx_id);
    emit(Locked {
        sender: caller,
        amount,
        dst_chain,
        tx_id,
    });
}

/// 创建跨链解锁请求（由后台 Relayer 触发）
pub fn create_unlock_request(
    request_id: String,
    recipient: Key,
    amount: U256,
    src_chain: String,
    dst_chain: String,
) {
    ensure_not_paused();

    if amount.is_zero() {
        runtime::revert(BridgeError::InvalidAmount);
    }

    if is_tx_processed(&request_id) {
        runtime::revert(BridgeError::TxAlreadyProcessed);
    }

    let req = UnlockRequest {
        id: request_id.clone(),
        recipient,
        amount,
        src_chain,
        dst_chain,
        timestamp_ms: now_ms(),
        finalized: false,
        approvals_weight: 0,
    };

    write_dictionary_value(DICT_UNLOCK_REQS, &request_id, req);
    emit(UnlockRequested {
        request_id,
        recipient,
        amount,
        src_chain: req.src_chain.clone(),
        dst_chain: req.dst_chain.clone(),
    });
}

/// 守护节点审批解锁请求（权重累加）
pub fn approve_unlock(request_id: String) {
    ensure_not_paused();

    let caller = runtime::get_caller();
    let weight = if caller == get_admin() {
        // 管理员视为最大权重，直接满足阈值
        read_threshold()
    } else {
        get_guardian_weight(&caller).unwrap_or(0) as u16
    };

    if weight == 0 {
        runtime::revert(BridgeError::PermissionDenied);
    }

    // 防止重复投票
    let vote_key = format!(
        "unlock_vote:{}:{}",
        request_id,
        caller.to_formatted_string()
    );
    if is_tx_processed(&vote_key) {
        return;
    }
    mark_tx_processed(&vote_key);

    let mut req: UnlockRequest = read_dictionary_value(DICT_UNLOCK_REQS, &request_id)
        .unwrap_or_revert_with(BridgeError::InvalidRequest);

    if req.finalized {
        runtime::revert(BridgeError::InvalidRequest);
    }

    req.approvals_weight = req.approvals_weight.saturating_add(weight);

    // 达到阈值则直接完成
    if req.approvals_weight >= read_threshold() {
        req.finalized = true;
        mark_tx_processed(&request_id);
        emit(UnlockFinalized {
            request_id: req.id.clone(),
            recipient: req.recipient,
            amount: req.amount,
        });
    }

    write_dictionary_value(DICT_UNLOCK_REQS, &request_id, req);
}

/// 提案热修复补丁（Hot-Swap）
pub fn propose_hot_swap(patch_hash: String) {
    ensure_admin();
    ensure_not_paused();

    if patch_hash.is_empty() {
        runtime::revert(BridgeError::InvalidRequest);
    }

    let patch = HotSwapPatch {
        patch_hash: patch_hash.clone(),
        proposer: runtime::get_caller(),
        approved_weight: 0,
        activated: false,
    };

    write_dictionary_value(DICT_HOTSWAP, &patch_hash, patch);
    emit(HotSwapProposed {
        patch_hash,
        proposer: runtime::get_caller(),
    });
}

/// 守护节点审批热修复，当权重达阈值立即激活
pub fn approve_hot_swap(patch_hash: String) {
    ensure_not_paused();

    let caller = runtime::get_caller();
    let weight = if caller == get_admin() {
        read_threshold()
    } else {
        get_guardian_weight(&caller).unwrap_or(0) as u16
    };

    if weight == 0 {
        runtime::revert(BridgeError::PermissionDenied);
    }

    // 防重复投票
    let vote_key = format!(
        "hotswap_vote:{}:{}",
        patch_hash,
        caller.to_formatted_string()
    );
    if is_tx_processed(&vote_key) {
        return;
    }
    mark_tx_processed(&vote_key);

    let mut patch: HotSwapPatch = read_dictionary_value(DICT_HOTSWAP, &patch_hash)
        .unwrap_or_revert_with(BridgeError::InvalidRequest);

    if patch.activated {
        return;
    }

    patch.approved_weight = patch.approved_weight.saturating_add(weight);
    if patch.approved_weight >= read_threshold() {
        patch.activated = true;
        write_active_patch(patch.patch_hash.clone());
        emit(HotSwapActivated {
            patch_hash: patch.patch_hash.clone(),
        });
    }

    write_dictionary_value(DICT_HOTSWAP, &patch_hash, patch);
}

/// 暂停/恢复
pub fn set_pause(paused: bool) {
    ensure_admin();
    set_paused(paused);
    emit(PauseChanged { paused });
}

/// 更新基础 APR
pub fn update_apr(new_apr_bps: u16) {
    ensure_admin();
    let threshold = read_threshold();
    write_base_config(threshold, new_apr_bps, is_paused());
}

/// 迁移管理员
pub fn transfer_admin(new_admin: Key) {
    ensure_admin();
    set_admin(new_admin);
}

/// 读取某账户的当前本金（含利息）
pub fn get_position(account: Key) -> VaultPosition {
    accrue_position(&account)
}

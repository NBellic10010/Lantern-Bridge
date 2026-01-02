//! 合约业务逻辑与入口函数
extern crate alloc;

use alloc::{format, string::String, vec::Vec};
use casper_contract::{
    contract_api::{account, runtime, storage, system},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{contracts::ContractHash, runtime_args, CLTyped, Key, U256, U512};

//TODO 需要重写资金/钱包相关逻辑

use crate::{
    events::{
        emit, CeETHBurned, CeETHMinted, CsprLockedForTarget, EventType, HotSwapActivated,
        HotSwapProposed, PauseChanged, UnlockFinalized, UnlockRequested, YieldAccrued,
    },
    storage::{
        ensure_dictionaries, get_admin, get_ceeth_token, get_guardian_weight, is_paused,
        is_tx_processed, mark_tx_processed, read_apr_bps, read_dictionary_value, read_threshold,
        set_admin, set_ceeth_token, set_paused, write_active_patch, write_base_config,
        write_dictionary_value, DICT_BALANCES, DICT_CEETH_MINT_REQS, DICT_HOTSWAP,
        DICT_UNLOCK_REQS, KEY_ADMIN,
    },
    types::{BridgeError, Guardian, HotSwapPatch, UnlockRequest, VaultPosition},
    utils::compute_yield,
};

/// 确保调用者为管理员
fn ensure_admin() {
    let caller = runtime::get_caller();
    let admin = get_admin();
    match admin {
        Key::Account(account_hash) => {
            if account_hash != caller {
                runtime::revert(BridgeError::PermissionDenied);
            }
        }
        _ => runtime::revert(BridgeError::PermissionDenied),
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

/// 将 Key 转换为 ContractHash
fn key_to_contract_hash(key: Key) -> Option<ContractHash> {
    // 1. 模式匹配解包
    if let Key::Hash(hash_addr) = key {
        // 2. HashAddr 本质就是 [u8; 32]，ContractHash 也是 [u8; 32]
        // 所以直接返回即可，或者显式转换
        Some(ContractHash::new(hash_addr))
    } else {
        None // 如果这个 Key 不是 Hash 类型（比如是 Account 或 URef），则无法转换
    }
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
        let apr = read_apr_bps().unwrap_or_revert();
        let interest = compute_yield(position.principal, apr, delta);
        position.principal = position.principal.saturating_add(interest);
        position.last_accrual_ms = current; //若没有这一行，则会导致利息无限累加

        emit(YieldAccrued {
            account: *account,
            principal_after: position.principal,
            event_type: EventType::YIELD_ACCRUED,
        });
    } else {
        runtime::revert(BridgeError::InvalidTimestamp);
    }

    position
}

/// 写回用户头寸
fn save_position(account: &Key, pos: VaultPosition) {
    let key = account.to_formatted_string();
    write_dictionary_value(DICT_BALANCES, &key, pos);
}

/// 初始化合约
pub fn init(admin: Key, guardians: Vec<Guardian>, threshold: u32, base_apr_bps: u32) {
    // 创建必要存储
    ensure_dictionaries();

    // 写入管理员、阈值、APR、暂停标志
    let admin_uref = storage::new_uref(admin);
    runtime::put_key(KEY_ADMIN, admin_uref.into());
    write_base_config(threshold, base_apr_bps, false);

    // 保存守护权重
    crate::storage::save_guardians(guardians);
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

    write_dictionary_value(DICT_UNLOCK_REQS, &request_id, req.clone());
    emit(UnlockRequested {
        request_id,
        recipient,
        amount,
        src_chain: req.src_chain.clone(),
        dst_chain: req.dst_chain.clone(),
        event_type: EventType::UNLOCK_REQUESTED,
    });
}

/// 守护节点审批解锁请求（权重累加）
pub fn approve_unlock(request_id: String) {
    ensure_not_paused();

    let caller = runtime::get_caller();

    let admin = get_admin();
    match admin {
        Key::Account(account_hash) => {
            if account_hash != caller {
                runtime::revert(BridgeError::PermissionDenied);
            }
        }
        _ => runtime::revert(BridgeError::PermissionDenied),
    }

    let weight = get_guardian_weight(&Key::Account(caller.into())).unwrap_or(0) as u32;
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
    if req.approvals_weight >= read_threshold().unwrap_or_revert() as u32 {
        req.finalized = true;
        // 计息并释放到目标账户
        let mut pos = accrue_position(&req.recipient);
        pos.principal = pos.principal.saturating_add(req.amount);
        save_position(&req.recipient, pos);
        mark_tx_processed(&request_id);
        emit(UnlockFinalized {
            request_id: req.id.clone(),
            recipient: req.recipient,
            amount: req.amount,
            event_type: EventType::UNLOCK_FINALIZED,
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
        proposer: Key::Account(runtime::get_caller().into()),
        approved_weight: 0,
        activated: false,
    };

    write_dictionary_value(DICT_HOTSWAP, &patch_hash, patch);
    emit(HotSwapProposed {
        patch_hash,
        proposer: Key::Account(runtime::get_caller().into()),
        event_type: EventType::HOT_SWAP_PROPOSED,
    });
}

/// 守护节点审批热修复，当权重达阈值立即激活
pub fn approve_hot_swap(patch_hash: String) {
    ensure_not_paused();

    let caller = runtime::get_caller();

    let admin = get_admin();
    let weight = match admin {
        Key::Account(account_hash) => {
            if account_hash != caller {
                runtime::revert(BridgeError::PermissionDenied);
            } else {
                read_threshold().unwrap_or_revert() as u32 //管理员自动通过
            }
        }
        _ => get_guardian_weight(&Key::Account(caller.into())).unwrap_or(0) as u32,
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

    if patch.approved_weight >= read_threshold().unwrap_or_revert() as u32 {
        patch.activated = true;
        write_active_patch(patch.patch_hash.clone());

        // 执行真正的升级逻辑：将钥匙交给新合约（patch_hash），让它去升级
        perform_upgrade(patch.patch_hash.clone());

        emit(HotSwapActivated {
            patch_hash: patch.patch_hash.clone(),
            event_type: EventType::HOT_SWAP_ACTIVATED,
        });
    }

    write_dictionary_value(DICT_HOTSWAP, &patch_hash, patch);
}

/// 执行合约升级：通过反向授权，让目标 Upgrader 合约执行 add_contract_version
fn perform_upgrade(upgrader_contract_hash_str: String) {
    // 1. 获取自身的 Package Hash 和 Access Token
    // 注意：这些 Key 是在 entrypoints.rs 中初始化时 put_key 的
    let package_hash_key =
        runtime::get_key("bridge_core_package_hash").unwrap_or_revert_with(BridgeError::MissingKey);
    let access_token_key = runtime::get_key("bridge_core_package_access")
        .unwrap_or_revert_with(BridgeError::MissingKey);

    // 2. 解析目标 Upgrader 合约地址
    // 这里的 patch_hash 应该是一个 ContractHash (Hex 字符串)
    let upgrader_hash = ContractHash::from_formatted_str(&upgrader_contract_hash_str)
        .map_err(|_| BridgeError::InvalidKey)
        .unwrap_or_revert();

    // 3. 调用 Upgrader 合约的 'apply_upgrade' 入口点
    // Upgrader 合约必须接收 package_hash 和 access_token，然后调用 storage::add_contract_version
    runtime::call_contract::<()>(
        upgrader_hash,
        "apply_upgrade",
        runtime_args! {
            "package_hash" => package_hash_key,
            "access_token" => access_token_key,
        },
    );
}

/// 暂停/恢复
pub fn set_pause(paused: bool) {
    ensure_admin();
    set_paused(paused);
    emit(PauseChanged {
        paused,
        event_type: EventType::PAUSE_CHANGED,
    });
}

/// 更新基础 APR
pub fn update_apr(new_apr_bps: u32) {
    ensure_admin();
    let threshold = read_threshold();
    write_base_config(threshold.unwrap_or_revert(), new_apr_bps, is_paused());
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

// =========================
// 新增：跨链 ceETH / wCSPR
// =========================

/// 设置 ceETH 合约哈希（仅管理员）
pub fn set_ceeth_token_entry(token: Key) {
    ensure_admin();
    set_ceeth_token(token);
}

/// CSPR -> ETH：锁仓 CSPR（计息资产记账），等待对端 mint wCSPR
pub fn lock_cspr_for_eth(amount: U256, tx_id: String, dst_chain: String, recipient: String) {
    ensure_not_paused();
    if amount.is_zero() {
        runtime::revert(BridgeError::InvalidAmount);
    }
    if is_tx_processed(&tx_id) {
        runtime::revert(BridgeError::TxAlreadyProcessed);
    }

    let caller_purse = account::get_main_purse();

    // you need purse to transfer CSPR to bridge contract
    let contract_main_purse = account::get_main_purse();

    system::transfer_from_purse_to_purse(
        caller_purse,
        contract_main_purse,
        U512::from(amount.as_u128()),
        None,
    )
    .unwrap_or_revert_with(BridgeError::TransferFailed);

    let caller = runtime::get_caller();
    let mut pos = accrue_position(&Key::Account(caller.into()));
    pos.principal = pos.principal.saturating_add(amount);
    save_position(&Key::Account(caller.into()), pos);

    mark_tx_processed(&tx_id);
    emit(CsprLockedForTarget {
        sender: Key::Account(caller.into()),
        dst_chain: dst_chain.clone(),
        recipient: recipient.clone(),
        amount,
        tx_id,
        event_type: EventType::CSPR_LOCKED_FOR_TARGET,
    });
}

/// ETH -> CSPR：创建 ceETH 铸造请求（由 Relayer 发起）
pub fn create_ceeth_mint_request(
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

    write_dictionary_value(DICT_CEETH_MINT_REQS, &request_id, req);
}

/// 守护/管理员审批 ceETH 铸造；达到阈值后直接 mint
pub fn approve_ceeth_mint(request_id: String) {
    ensure_not_paused();

    let caller = runtime::get_caller();
    let admin = get_admin();
    let weight = match admin {
        Key::Account(account_hash) => {
            if account_hash != caller {
                runtime::revert(BridgeError::PermissionDenied);
            } else {
                read_threshold().unwrap_or_revert() as u32 //管理员自动通过
            }
        }
        _ => get_guardian_weight(&Key::Account(caller.into())).unwrap_or(0) as u32,
    };

    if weight == 0 {
        runtime::revert(BridgeError::PermissionDenied);
    }

    let vote_key = format!(
        "ceeth_mint_vote:{}:{}",
        request_id,
        caller.to_formatted_string()
    );
    if is_tx_processed(&vote_key) {
        return;
    }
    mark_tx_processed(&vote_key);

    let mut req: UnlockRequest = read_dictionary_value(DICT_CEETH_MINT_REQS, &request_id)
        .unwrap_or_revert_with(BridgeError::InvalidRequest);

    if req.finalized {
        runtime::revert(BridgeError::InvalidRequest);
    }

    req.approvals_weight = req.approvals_weight.saturating_add(weight);

    if req.approvals_weight >= read_threshold().unwrap_or_revert() as u32 {
        let token = get_ceeth_token();
        // cep18_mint(token.clone(), req.recipient, req.amount).unwrap_or_revert();

        req.finalized = true;
        mark_tx_processed(&request_id);
        emit(CeETHMinted {
            recipient: req.recipient,
            amount: req.amount,
            tx_id: req.id.clone(),
            event_type: EventType::CEETH_MINTED,
        });
    }

    write_dictionary_value(DICT_CEETH_MINT_REQS, &request_id, req);
}

/// 用户燃烧 ceETH 以赎回 ETH（on-chain 事件由 Relayer 监听并在 ETH 链释放）
pub fn burn_ceeth_for_eth(amount: U256, tx_id: String, eth_owner: String) {
    ensure_not_paused();
    if amount.is_zero() {
        runtime::revert(BridgeError::InvalidAmount);
    }
    if is_tx_processed(&tx_id) {
        runtime::revert(BridgeError::TxAlreadyProcessed);
    }

    let caller = runtime::get_caller();
    let bridge_package_key = runtime::get_key("bridge_core_package_hash").unwrap_or_revert();
    let ceeth_contract_key = get_ceeth_token(); //ceETH contract hash

    let bridge_package_hash = key_to_contract_hash(bridge_package_key).unwrap_or_revert();
    let ceeth_contract_hash = key_to_contract_hash(ceeth_contract_key).unwrap_or_revert();

    /// First: transfer ceETH from caller to bridge contract
    let transfer_args = runtime_args! {
        "owner" => caller,
        "recipient" => bridge_package_hash, // 转给我(Bridge)
        "amount" => amount
    };

    runtime::call_contract::<()>(ceeth_contract_hash, "transfer_from", transfer_args);

    /// Second: burn ceETH from bridge contract
    let burn_args = runtime_args! {
        "amount" => amount,
        "owner" => bridge_package_hash
    };

    runtime::call_contract::<()>(
        ceeth_contract_hash,
        "burn", // 调用者是 Bridge，所以销毁的是 Bridge 的余额
        burn_args,
    );

    mark_tx_processed(&tx_id);
    emit(CeETHBurned {
        eth_owner: eth_owner,
        amount,
        tx_id,
        event_type: EventType::CEETH_BURNED,
    });
}

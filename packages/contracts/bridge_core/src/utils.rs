//! 通用工具函数
extern crate alloc;

use casper_types::U256;

/// 基于毫秒时间增量与年化 APR (bps) 计算利息
pub fn compute_yield(principal: U256, apr_bps: u32, delta_ms: u64) -> U256 {
    if principal.is_zero() || delta_ms == 0 || apr_bps == 0 {
        return U256::zero();
    }

    // APR 基于基点 (bps)，一年按 365 天
    // interest = principal * apr_bps / 10_000 * delta_ms / MS_PER_YEAR
    const MS_PER_YEAR: u128 = 365 * 24 * 60 * 60 * 1000;

    let num = principal.as_u128() * apr_bps as u128 * delta_ms as u128;

    let interest = num / (10_000u128 * MS_PER_YEAR);
    U256::from(interest)
}

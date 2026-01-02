//! Integration tests for interest calculation.

use bridge_core::utils::compute_yield;
use casper_types::U256;

#[test]
fn zero_inputs_yield_zero() {
    assert_eq!(compute_yield(U256::zero(), 500, 1_000), U256::zero());
    assert_eq!(compute_yield(U256::from(1_000u64), 0, 1_000), U256::zero());
    assert_eq!(compute_yield(U256::from(1_000u64), 500, 0), U256::zero());
}

#[test]
fn accrues_proportionally() {
    // 5% APR，半年利息约 25（整除向下取整）
    let principal = U256::from(1_000u64);
    let apr_bps: u16 = 500; // 5%
    let half_year_ms: u64 = 365 / 2 * 24 * 60 * 60 * 1000;
    let interest = compute_yield(principal, apr_bps, half_year_ms);
    assert_eq!(interest, U256::from(25u64));
}

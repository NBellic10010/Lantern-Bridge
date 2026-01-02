// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";

/// @title Wrapped CSPR (wCSPR)
/// @notice 由跨链桥/Relayer 在以太坊侧铸造，用户 burn 触发 Casper 侧解锁。
contract WrappedCSPR is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// 防重放：记录源链 txId（或 burn 事件 id）是否已处理
    mapping(bytes32 => bool) public processed;

    event Minted(address indexed to, uint256 amount, bytes32 indexed srcTx);
    event Burned(address indexed from, uint256 amount, bytes32 indexed dstTx);

    constructor(address admin_) ERC20("Wrapped CSPR", "wCSPR") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE, admin_);
    }

    /// @dev 仅拥有 MINTER_ROLE 的桥/Relayer 可调用，需传入源链 txId 防重放
    function mint(address to, uint256 amount, bytes32 srcTx) external onlyRole(MINTER_ROLE) {
        require(!processed[srcTx], "wCSPR: processed");
        processed[srcTx] = true;
        _mint(to, amount);
        emit Minted(to, amount, srcTx);
    }

    /// @dev 用户自助 burn，dstTx 由前端/Relayer 生成并在桥侧防重放
    function burn(uint256 amount, bytes32 dstTx) external {
        _burn(msg.sender, amount);
        emit Burned(msg.sender, amount, dstTx);
    }

    /// @dev 允许桥合约在有 allowance 时代为 burn
    function burnFrom(address from, uint256 amount, bytes32 dstTx) external {
        uint256 currentAllowance = allowance(from, msg.sender);
        require(currentAllowance >= amount, "wCSPR: allowance");
        _approve(from, msg.sender, currentAllowance - amount);
        _burn(from, amount);
        emit Burned(from, amount, dstTx);
    }
}


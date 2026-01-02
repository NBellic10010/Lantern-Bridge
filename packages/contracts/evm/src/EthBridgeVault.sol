// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title EthBridgeVault
/// @notice 锁定 ETH，供 Casper 链铸造 ceETH；当 Casper 侧 burn ceETH 时由 Relayer 释放 ETH。
contract EthBridgeVault is AccessControl, ReentrancyGuard {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// 防重放：记录 depositId / burnTx 是否已处理
    mapping(bytes32 => bool) public processed;

    event EthLocked(
        address indexed sender, uint256 amount, bytes32 indexed depositId, string dstChain, string dstAccount
    );

    event EthReleased(address indexed recipient, uint256 amount, bytes32 indexed burnTx);

    constructor(address admin_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(RELAYER_ROLE, admin_);
    }

    /// @dev 用户锁定 ETH，depositId 应由前端/桥生成并全局唯一
    function lockEth(string calldata dstChain, string calldata dstAccount, bytes32 depositId)
        external
        payable
        nonReentrant
    {
        require(msg.value > 0, "Vault: zero amount");
        require(!processed[depositId], "Vault: duplicate");
        processed[depositId] = true;
        emit EthLocked(msg.sender, msg.value, depositId, dstChain, dstAccount);
    }

    /// @dev Relayer 根据 Casper 侧 ceETH burn 事件释放 ETH
    function release(address payable recipient, uint256 amount, bytes32 burnTx)
        external
        nonReentrant
        onlyRole(RELAYER_ROLE)
    {
        require(!processed[burnTx], "Vault: duplicate");
        processed[burnTx] = true;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "Vault: send fail");
        emit EthReleased(recipient, amount, burnTx);
    }

    receive() external payable {}
}


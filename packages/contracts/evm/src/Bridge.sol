// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import "openzeppelin-contracts/contracts/access/AccessControl.sol";
import "./WrappedCSPR.sol";
import "./interfaces/IAaveGateway.sol";

// 1. 将资产锁定到跨链桥
// 2. 铸造跨链资产wCSPR
// 3. 释放锁定资产
// 4. relayer多签验证
// 5. AAVE生息集成

contract Bridge is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    WrappedCSPR public immutable wCSPR;
    
    // 策略枚举：目前仅支持 AAVE，后续可扩展
    enum Strategy {
        NONE,   // 不生息
        AAVE    // 存入 AAVE
    }

    // 策略适配器地址映射
    mapping(Strategy => address) public strategyAdapters;

    // 资产锁定记录
    struct LockInfo {
        address user;
        address token;
        uint256 amount;
        uint256 timestamp;
        bool released;
        Strategy strategy; // 记录使用的策略
    }
    
    // 跨链请求去重
    mapping(bytes32 => bool) public processedRequests;
    // 锁定记录映射: depositId => LockInfo
    mapping(bytes32 => LockInfo) public deposits;
    
    // 锁定时间限制
    uint256 public constant MIN_LOCK_DURATION = 30 days;

    // 事件定义
    event Locked(bytes32 indexed depositId, address indexed user, address token, uint256 amount, string dstChain, string dstAccount, uint8 strategy);
    event Released(bytes32 indexed depositId, address indexed user, uint256 amount);
    event MintedwCSPR(bytes32 indexed reqId, address indexed to, uint256 amount);
    event BurnedwCSPR(bytes32 indexed reqId, address indexed from, uint256 amount);
    event StrategyUpdated(Strategy indexed strategy, address adapter);

    constructor(address _wCSPR, address _aaveGateway, address _admin) {
        wCSPR = WrappedCSPR(_wCSPR);
        // 初始化 AAVE 策略地址
        strategyAdapters[Strategy.AAVE] = _aaveGateway;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin); // 管理员默认拥有Relayer权限（最大权重）
    }

    // 设置策略适配器地址（仅管理员）
    function setStrategyAdapter(Strategy strategy, address adapter) external onlyRole(ADMIN_ROLE) {
        require(adapter != address(0), "Invalid adapter");
        strategyAdapters[strategy] = adapter;
        emit StrategyUpdated(strategy, adapter);
    }

    // 1. 锁定ERC-20并根据策略存入生息
    function lock(
        address token,
        uint256 amount,
        string calldata dstChain,
        string calldata dstAccount,
        uint8 strategyId // 用户选择的策略 ID
    ) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(strategyId <= uint8(Strategy.AAVE), "Invalid strategy");
        
        Strategy strategy = Strategy(strategyId);
        
        // 生成唯一depositId
        bytes32 depositId = keccak256(abi.encodePacked(msg.sender, token, amount, block.timestamp, dstChain, dstAccount));
        require(deposits[depositId].timestamp == 0, "Deposit already exists");

        // 转移代币到Bridge
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // 执行生息策略
        if (strategy == Strategy.AAVE) {
            address gateway = strategyAdapters[Strategy.AAVE];
            require(gateway != address(0), "AAVE strategy not configured");
            
            IERC20(token).approve(gateway, amount);
            // 存入 AAVE
            IAaveGateway(gateway).supply(token, amount, address(this), 0);
        }
        // Strategy.NONE 或其他情况：仅保留在合约中，不做操作

        // 记录锁定信息
        deposits[depositId] = LockInfo({
            user: msg.sender,
            token: token,
            amount: amount,
            timestamp: block.timestamp,
            released: false,
            strategy: strategy
        });

        emit Locked(depositId, msg.sender, token, amount, dstChain, dstAccount, strategyId);
    }

    // 2. 铸造wCSPR (需Relayer/Admin调用)
    function mintwCSPR(
        address to, 
        uint256 amount, 
        bytes32 reqId,
        bytes32 txId
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        require(!processedRequests[reqId], "Request processed");
        processedRequests[reqId] = true;

        wCSPR.mint(to, amount, txId);
        emit MintedwCSPR(reqId, to, amount);
    }

    // 3. 销毁wCSPR (用户调用)
    function burnwCSPR(uint256 amount, string calldata dstAccount, bytes32 txId) external nonReentrant {
        bytes32 reqId = keccak256(abi.encodePacked(msg.sender, amount, block.timestamp, dstAccount));
        wCSPR.burnFrom(msg.sender, amount, txId);
        emit BurnedwCSPR(reqId, msg.sender, amount);
    }

    // 4. 释放锁定资产 (需Relayer/Admin调用)
    function release(
        bytes32 depositId,
        bytes32 reqId
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        require(!processedRequests[reqId], "Request processed");
        processedRequests[reqId] = true;

        LockInfo storage info = deposits[depositId];
        require(info.timestamp > 0, "Deposit not found");
        require(!info.released, "Already released");
        require(block.timestamp >= info.timestamp + MIN_LOCK_DURATION, "Lock duration not met");

        info.released = true;

        // 根据当时锁定时选择的策略取回资金
        if (info.strategy == Strategy.AAVE) {
            address gateway = strategyAdapters[Strategy.AAVE];
            // 从 AAVE 取回本金 (利息处理逻辑视业务而定，此处简略)
            uint256 withdrawn = IAaveGateway(gateway).withdraw(info.token, info.amount, address(this));
            require(withdrawn >= info.amount, "AAVE withdraw failed");
        }
        // Strategy.NONE：资金直接在 Bridge 合约余额里，直接转账即可

        IERC20(info.token).safeTransfer(info.user, info.amount);
        
        emit Released(depositId, info.user, info.amount);
    }

    // 管理员紧急提取
    function adminWithdraw(address token, uint256 amount) external onlyRole(ADMIN_ROLE) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}

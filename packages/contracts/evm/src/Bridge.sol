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

    // 手续费率 (万分比)
    uint256 public feeBps;

    // 事件定义
    event Locked(bytes32 indexed depositId, address indexed user, address token, uint256 amount, string dstChain, string dstAccount, uint8 strategy);
    event Released(bytes32 indexed depositId, address indexed user, uint256 amount);
    event MintedwCSPR(bytes32 indexed reqId, address indexed to, uint256 amount);
    event BurnedwCSPR(bytes32 indexed reqId, address indexed from, uint256 amount, string dstAccount);
    event StrategyUpdated(Strategy indexed strategy, address adapter);
    event FeeBpsUpdated(uint256 newFeeBps);

    constructor(address _wCSPR, address _aaveGateway, address _admin) {
        wCSPR = WrappedCSPR(_wCSPR);
        // 初始化 AAVE 策略地址
        strategyAdapters[Strategy.AAVE] = _aaveGateway;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin); // 管理员默认拥有Relayer权限（最大权重）
        
        // 默认手续费率 0
        feeBps = 0;
    }

    // 设置手续费率 (仅管理员)
    function setFeeBps(uint256 _feeBps) external onlyRole(ADMIN_ROLE) {
        require(_feeBps <= 10000, "Invalid fee"); // 最大 100%
        feeBps = _feeBps;
        emit FeeBpsUpdated(_feeBps);
    }

    // 设置策略适配器地址（仅管理员）
    function setStrategyAdapter(Strategy strategy, address adapter) external onlyRole(ADMIN_ROLE) {
        require(adapter != address(0), "Invalid adapter");
        strategyAdapters[strategy] = adapter;
        emit StrategyUpdated(strategy, adapter);
    }

    // 1. 锁定ERC-20/ETH并根据策略存入生息
    // 注意：如果 token 是 address(0)，代表原生 ETH，amount 应等于 msg.value
    function lock(
        address token,
        uint256 amount,
        string calldata dstChain,
        string calldata dstAccount,
        uint8 strategyId // 用户选择的策略 ID
    ) external payable nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(strategyId <= uint8(Strategy.AAVE), "Invalid strategy");
        
        // 计算费用
        uint256 fee = (amount * feeBps) / 10000;
        uint256 actualAmount = amount - fee;

        Strategy strategy = Strategy(strategyId);
        
        // 生成唯一depositId
        bytes32 depositId = keccak256(abi.encodePacked(msg.sender, token, actualAmount, block.timestamp, dstChain, dstAccount));
        require(deposits[depositId].timestamp == 0, "Deposit already exists");

        // 转移代币到Bridge
        if (token == address(0)) {
            // 原生 ETH
            require(msg.value == amount, "Amount mismatch");
            // fee 自动留在合约中
        } else {
            // ERC20
            require(msg.value == 0, "ETH not accepted for ERC20 lock");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            // fee 自动留在合约中
        }

        // 执行生息策略 (仅对 actualAmount 生息，fee 留存)
        if (strategy == Strategy.AAVE) {
            address gateway = strategyAdapters[Strategy.AAVE];
            require(gateway != address(0), "AAVE strategy not configured");
            
            if (token == address(0)) {
                // 原生 ETH 生息 (需要 Gateway 支持 Native ETH 存款，或者转 WETH)
                // 假设 AaveGateway 处理 WETH 转换，或者这里简化逻辑暂不支持 Native ETH 生息
                // 实际 AAVE V3 有 WETH Gateway
                revert("Native ETH strategy not implemented");
            } else {
                IERC20(token).approve(gateway, actualAmount);
                // 存入 AAVE
                IAaveGateway(gateway).supply(token, actualAmount, address(this), 0);
            }
        }
        // Strategy.NONE 或其他情况：仅保留在合约中，不做操作

        // 记录锁定信息 (使用 actualAmount)
        deposits[depositId] = LockInfo({
            user: msg.sender,
            token: token,
            amount: actualAmount,
            timestamp: block.timestamp,
            released: false,
            strategy: strategy 
        });

        // 触发事件通知 Relayer (只铸造 actualAmount)
        emit Locked(depositId, msg.sender, token, actualAmount, dstChain, dstAccount, strategyId);
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
        // 计算扣费
        uint256 fee = (amount * feeBps) / 10000;
        uint256 actualAmount = amount - fee;

        bytes32 reqId = keccak256(abi.encodePacked(msg.sender, amount, block.timestamp, dstAccount)); // ID 仍包含原始 amount 以防混淆? 或者用 actualAmount?
        // 最好使用原始参数生成 ID 保证确定性，或者使用 nonce。
        // 这里使用原始 amount 生成 ID 没问题。

        // 销毁 amount (fee + actualAmount)
        // 注意：burnFrom 会减少用户余额
        // 我们需要把 fee 转给 Admin/Bridge 还是直接销毁？
        // 如果是销毁 wCSPR，意味着用户想拿回 CSPR。
        // Casper 端 Release 时释放 CSPR。
        // 如果这里销毁了 fee，那 Casper 端就释放不出来了。
        // 
        // 逻辑修正：用户想获得 CSPR。
        // 方案 A：销毁 amount，Casper 端只释放 actualAmount。 Fee 对应的 CSPR 留在 Casper 桥合约里。
        // 方案 B：销毁 actualAmount，转 fee 给 Admin (在 ETH 链上)。
        // 
        // 由于 wCSPR 是映射代币，Fee 应该是 CSPR 本身（即方案 A）。
        // 即：用户 Burn 100 wCSPR，我们在 Casper 端给用户转 99.7 CSPR，剩下 0.3 CSPR 留在 Bridge Purse。
        // 所以这里**完全销毁 100 wCSPR** 是正确的，因为这 100 个对应的 CSPR 都在 Casper 桥上。
        // 只有销毁了 wCSPR，才能证明其背后的 CSPR 可以被挪用（一部分给用户，一部分给 Admin）。
        
        wCSPR.burnFrom(msg.sender, amount, txId);
        
        // 事件通知 Casper 只释放 actualAmount
        // 注意：Casper 端合约 create_unlock_request 需要知道 actualAmount
        emit BurnedwCSPR(reqId, msg.sender, actualAmount, dstAccount); 
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

        if (info.token == address(0)) {
            // 原生 ETH 转账
            (bool success, ) = info.user.call{value: info.amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(info.token).safeTransfer(info.user, info.amount);
        }
        
        emit Released(depositId, info.user, info.amount);
    }

    // 管理员紧急提取 (提取 Token 或 ETH)
    function adminWithdraw(address token, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (token == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH withdraw failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
    }
    
    // 允许合约接收 ETH
    receive() external payable {}
}

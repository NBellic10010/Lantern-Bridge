pragma solidity ^0.8.13;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import "openzeppelin-contracts/contracts/access/Ownable.sol";
import "wrapped-cspr/WrappedCSPR.sol";

// 1. 将资产锁定到跨链桥
// 2. 铸造跨链资产wCSPR
// 3. 释放锁定资产
// 4. relayer多签验证

contract Bridge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    address public immutable wrappedCSPR;
    address public immutable wCSPR;

    constructor() {
        

    }
}
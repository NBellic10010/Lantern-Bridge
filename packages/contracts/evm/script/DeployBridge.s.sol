// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {Bridge} from "../src/Bridge.sol";
import {WrappedCSPR} from "../src/WrappedCSPR.sol";

contract DeployBridge is Script {
    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("ETH_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying with address:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy WrappedCSPR
        WrappedCSPR wcspr = new WrappedCSPR(deployer);
        console.log("WrappedCSPR deployed at:", address(wcspr));

        // 2. Deploy Bridge
        // Note: Passing address(0) for AaveGateway for now. 
        // If you need AAVE integration, replace address(0) with the actual Gateway address on Sepolia.
        address aaveGateway = address(0); 
        Bridge bridge = new Bridge(address(wcspr), aaveGateway, deployer);
        console.log("Bridge deployed at:", address(bridge));

        // 3. Grant MINTER_ROLE to Bridge
        bytes32 MINTER_ROLE = wcspr.MINTER_ROLE();
        wcspr.grantRole(MINTER_ROLE, address(bridge));
        console.log("Granted MINTER_ROLE to Bridge");

        // 4. Grant RELAYER_ROLE to deployer (for testing purposes)
        // Note: In production, you might want to separate Admin and Relayer roles.
        bytes32 RELAYER_ROLE = bridge.RELAYER_ROLE();
        bridge.grantRole(RELAYER_ROLE, deployer);
        console.log("Granted RELAYER_ROLE to Deployer");

        vm.stopBroadcast();
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StreamPaySettlement} from "../src/StreamPaySettlement.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract Deploy is Script {
    function run() external {
        address paymentToken = vm.envOr("PAYMENT_TOKEN", address(0));
        address owner = vm.envOr("OWNER", msg.sender);

        vm.startBroadcast();

        if (paymentToken == address(0)) {
            MockUSDC mock = new MockUSDC();
            paymentToken = address(mock);
            // Mint 1000 USDC to default Anvil payer (account 0)
            address anvilPayer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
            mock.mint(anvilPayer, 1_000_000_000); // 1000 USDC
            console.log("MockUSDC deployed at:", paymentToken);
            console.log("Token:", paymentToken);
        }

        StreamPaySettlement settlement = new StreamPaySettlement(paymentToken, owner);

        console.log("StreamPaySettlement deployed at:", address(settlement));
        console.log("Settlement:", address(settlement));
        console.log("Payment token:", address(settlement.paymentToken()));
        console.log("Owner:", settlement.owner());
        console.log("Chain ID:", block.chainid);

        vm.stopBroadcast();
    }
}

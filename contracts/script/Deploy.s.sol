// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StreamPaySettlement} from "../src/StreamPaySettlement.sol";

contract Deploy is Script {
    function run() external {
        address paymentToken = vm.envAddress("PAYMENT_TOKEN");
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast();

        StreamPaySettlement settlement = new StreamPaySettlement(paymentToken, owner);

        console.log("StreamPaySettlement deployed at:", address(settlement));
        console.log("Payment token:", address(settlement.paymentToken()));
        console.log("Owner:", settlement.owner());
        console.log("Chain ID:", block.chainid);

        vm.stopBroadcast();
    }
}

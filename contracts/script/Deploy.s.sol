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

        _writeDeploymentArtifact(address(settlement), paymentToken, block.chainid, block.number);
    }

    function _writeDeploymentArtifact(
        address settlementAddr,
        address tokenAddr,
        uint256 chainId,
        uint256 blockNumber
    ) internal {
        string memory networkName = chainId == 31337 ? "local" : (chainId == 10143 ? "monad-testnet" : "custom");
        string memory json = string.concat(
            "{\n",
            "  \"schemaVersion\": 1,\n",
            "  \"network\": \"", networkName, "\",\n",
            "  \"chainId\": ", vm.toString(chainId), ",\n",
            "  \"rpcHttp\": \"", chainId == 31337 ? "http://127.0.0.1:8545" : "https://testnet-rpc.monad.xyz", "\",\n",
            "  \"rpcWs\": \"", chainId == 31337 ? "ws://127.0.0.1:8545" : "wss://testnet-rpc.monad.xyz", "\",\n",
            "  \"explorers\": [],\n",
            "  \"paymentToken\": {\n",
            "    \"symbol\": \"USDC\",\n",
            "    \"address\": \"", vm.toChecksumAddress(tokenAddr), "\",\n",
            "    \"expectedDecimals\": 6,\n",
            "    \"source\": \"", chainId == 31337 ? "Local mock deployment" : "Configured payment token", "\"\n",
            "  },\n",
            "  \"settlementContract\": \"", vm.toChecksumAddress(settlementAddr), "\",\n",
            "  \"deploymentTxHash\": null,\n",
            "  \"deploymentBlock\": ", vm.toString(blockNumber), ",\n",
            "  \"abiVersion\": \"streampay-v2.5\",\n",
            "  \"eip712Name\": \"StreamPaySettlement\",\n",
            "  \"eip712Version\": \"2.5\"\n",
            "}\n"
        );

        string memory filePath = chainId == 31337 ? "../manifests/local.json" : "../manifests/deployment.json";
        try vm.writeFile(filePath, json) {
            console.log("Deployment artifact written to:", filePath);
        } catch {
            console.log("Notice: vm.writeFile not permitted or failed, artifact logged to console");
        }
    }
}

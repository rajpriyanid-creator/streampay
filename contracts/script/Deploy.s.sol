// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StreamPaySettlement} from "../src/StreamPaySettlement.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

interface IERC20WithDecimals {
    function decimals() external view returns (uint8);
}

contract Deploy is Script {
    address public constant APPROVED_MONAD_TESTNET_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    uint256 public constant LOCAL_CHAIN_ID = 31337;
    uint256 public constant MONAD_TESTNET_CHAIN_ID = 10143;

    error UnsupportedChain(uint256 chainId);
    error MissingPaymentTokenForTestnet();
    error InvalidTestnetToken(address provided, address expected);
    error TokenHasNoBytecode(address token);
    error UnexpectedDecimals(uint8 decimals, uint8 expected);

    function validateAndResolveToken(address inputToken, uint256 chainId) public returns (address resolvedToken) {
        if (chainId == LOCAL_CHAIN_ID) {
            if (inputToken == address(0)) {
                MockUSDC mock = new MockUSDC();
                resolvedToken = address(mock);
                // Mint 1000 USDC to default Anvil payer (account 0)
                address anvilPayer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
                mock.mint(anvilPayer, 1_000_000_000); // 1000 USDC
                console.log("MockUSDC deployed at:", resolvedToken);
                console.log("Token:", resolvedToken);
            } else {
                if (inputToken.code.length == 0) revert TokenHasNoBytecode(inputToken);
                uint8 dec = IERC20WithDecimals(inputToken).decimals();
                if (dec != 6) revert UnexpectedDecimals(dec, 6);
                resolvedToken = inputToken;
            }
        } else if (chainId == MONAD_TESTNET_CHAIN_ID) {
            if (inputToken == address(0)) revert MissingPaymentTokenForTestnet();
            if (inputToken != APPROVED_MONAD_TESTNET_USDC) {
                revert InvalidTestnetToken(inputToken, APPROVED_MONAD_TESTNET_USDC);
            }
            if (inputToken.code.length == 0) revert TokenHasNoBytecode(inputToken);
            uint8 dec = IERC20WithDecimals(inputToken).decimals();
            if (dec != 6) revert UnexpectedDecimals(dec, 6);
            resolvedToken = inputToken;
        } else {
            revert UnsupportedChain(chainId);
        }
    }

    function run() external {
        address inputToken = vm.envOr("PAYMENT_TOKEN", address(0));
        address owner = vm.envOr("OWNER", msg.sender);
        uint256 chainId = block.chainid;

        vm.startBroadcast();

        address paymentToken = validateAndResolveToken(inputToken, chainId);
        StreamPaySettlement settlement = new StreamPaySettlement(paymentToken, owner);

        console.log("StreamPaySettlement deployed at:", address(settlement));
        console.log("Settlement:", address(settlement));
        console.log("Payment token:", address(settlement.paymentToken()));
        console.log("Owner:", settlement.owner());
        console.log("Chain ID:", chainId);

        vm.stopBroadcast();

        _writeDeploymentArtifact(address(settlement), paymentToken, chainId, block.number);
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
            "    \"address\": \"", vm.toString(tokenAddr), "\",\n",
            "    \"expectedDecimals\": 6,\n",
            "    \"source\": \"", chainId == 31337 ? "Local mock deployment" : "Configured payment token", "\"\n",
            "  },\n",
            "  \"settlementContract\": \"", vm.toString(settlementAddr), "\",\n",
            "  \"deploymentTxHash\": null,\n",
            "  \"deploymentBlock\": ", vm.toString(blockNumber), ",\n",
            "  \"abiVersion\": \"streampay-v2.5\",\n",
            "  \"eip712Name\": \"StreamPaySettlement\",\n",
            "  \"eip712Version\": \"2.5\"\n",
            "}\n"
        );

        string memory filePath = "deployment.json";
        vm.writeFile(filePath, json);
        console.log("Deployment artifact written to:", filePath);
        console.log("DEPLOYMENT_ARTIFACT_JSON:");
        console.log(json);
    }
}

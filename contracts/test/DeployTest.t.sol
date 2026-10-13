// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deploy, IERC20WithDecimals} from "../script/Deploy.s.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Mock18DecimalsToken is ERC20 {
    constructor() ERC20("18 Decimals Token", "DEC18") {}
}

contract DeployTest is Test {
    Deploy public deployScript;
    MockUSDC public mockUSDC;

    function setUp() public {
        deployScript = new Deploy();
        mockUSDC = new MockUSDC();
    }

    /// @notice Local chain (31337) auto-deploys MockUSDC when input token is address(0).
    function test_LocalChain_UnspecifiedToken_DeploysMockUSDC() public {
        address token = deployScript.validateAndResolveToken(address(0), 31337);
        assertTrue(token != address(0), "Resolved token must not be zero");
        assertTrue(token.code.length > 0, "Resolved token must have deployed bytecode");
        assertEq(IERC20WithDecimals(token).decimals(), 6, "Resolved token must have 6 decimals");
    }

    /// @notice Local chain (31337) allows explicit valid 6-decimal token.
    function test_LocalChain_SpecifiedValidToken_Succeeds() public {
        address token = deployScript.validateAndResolveToken(address(mockUSDC), 31337);
        assertEq(token, address(mockUSDC), "Resolved token must match input token");
    }

    /// @notice Monad Testnet (10143) rejects unspecified token (address(0)).
    function test_Testnet_UnspecifiedToken_RevertsMissingToken() public {
        vm.expectRevert(Deploy.MissingPaymentTokenForTestnet.selector);
        deployScript.validateAndResolveToken(address(0), 10143);
    }

    /// @notice Monad Testnet (10143) rejects any token address other than approved Circle USDC.
    function test_Testnet_WrongToken_RevertsInvalidTestnetToken() public {
        address wrongToken = address(0x1234567890123456789012345678901234567890);
        vm.expectRevert(
            abi.encodeWithSelector(
                Deploy.InvalidTestnetToken.selector,
                wrongToken,
                deployScript.APPROVED_MONAD_TESTNET_USDC()
            )
        );
        deployScript.validateAndResolveToken(wrongToken, 10143);
    }

    /// @notice Monad Testnet (10143) rejects approved token address if it has no deployed bytecode.
    function test_Testnet_TokenNoBytecode_RevertsTokenHasNoBytecode() public {
        address approvedToken = deployScript.APPROVED_MONAD_TESTNET_USDC();
        // In local test environment, no bytecode exists at approved address unless etched
        vm.expectRevert(abi.encodeWithSelector(Deploy.TokenHasNoBytecode.selector, approvedToken));
        deployScript.validateAndResolveToken(approvedToken, 10143);
    }

    /// @notice Token with unexpected decimals (e.g. 18 instead of 6) reverts UnexpectedDecimals.
    function test_Token_WrongDecimals_RevertsUnexpectedDecimals() public {
        Mock18DecimalsToken badDecToken = new Mock18DecimalsToken();
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnexpectedDecimals.selector, 18, 6));
        deployScript.validateAndResolveToken(address(badDecToken), 31337);
    }

    /// @notice Unsupported chain IDs (e.g. 1, 137, 9999) revert UnsupportedChain.
    function test_UnsupportedChain_RevertsUnsupportedChain() public {
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 1));
        deployScript.validateAndResolveToken(address(mockUSDC), 1);

        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 9999));
        deployScript.validateAndResolveToken(address(mockUSDC), 9999);
    }

    /// @notice Monad Testnet (10143) succeeds when approved USDC token has bytecode and 6 decimals.
    function test_Testnet_ValidApprovedToken_Succeeds() public {
        address approvedToken = deployScript.APPROVED_MONAD_TESTNET_USDC();
        // Etch MockUSDC bytecode at the approved testnet address
        vm.etch(approvedToken, address(mockUSDC).code);

        address resolved = deployScript.validateAndResolveToken(approvedToken, 10143);
        assertEq(resolved, approvedToken, "Resolved token must match approved testnet token");
        assertEq(IERC20WithDecimals(resolved).decimals(), 6, "Resolved token must have 6 decimals");
    }
}

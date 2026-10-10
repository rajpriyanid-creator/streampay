// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StreamPaySettlement} from "../src/StreamPaySettlement.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract DeployDiscoveryTest is Test {
    MockUSDC public mockUSDC;
    StreamPaySettlement public settlement;
    address public owner;
    address public payer;
    address public creator;

    function setUp() public {
        owner = makeAddr("owner");
        payer = makeAddr("payer");
        creator = makeAddr("creator");

        mockUSDC = new MockUSDC();
        settlement = new StreamPaySettlement(address(mockUSDC), owner);

        mockUSDC.mint(payer, 1_000_000);
    }

    /// @notice Proves MockUSDC cannot be mistaken for StreamPaySettlement.
    /// Calling paymentToken() or getSession() on MockUSDC reverts.
    function test_MockUSDC_CannotBeMistakenFor_Settlement() public {
        // Attempting to call settlement paymentToken() selector on mockUSDC must revert
        (bool success, ) = address(mockUSDC).staticcall(
            abi.encodeWithSelector(settlement.paymentToken.selector)
        );
        assertFalse(success, "MockUSDC must not respond to settlement paymentToken() selector");

        // Attempting to call getSession selector on mockUSDC must revert
        (bool successSession, ) = address(mockUSDC).staticcall(
            abi.encodeWithSelector(settlement.getSession.selector, bytes32(0))
        );
        assertFalse(successSession, "MockUSDC must not respond to getSession selector");

        // Real settlement responds with the exact payment token
        assertEq(address(settlement.paymentToken()), address(mockUSDC), "Settlement payment token must match deployed token");
    }

    /// @notice Proves that an offer with a mismatched token cannot open a session on settlement.
    function test_PayerMustUseSameTokenDeployedToChain() public {
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(payer, 1_000_000);

        bytes32 contentHash = keccak256("test-content");
        bytes32 policyHash = keccak256("fixed-rate-0.0005-usdc-per-second-unit");
        bytes32 manifestRoot = keccak256("manifest-root");

        // Create an offer specifying otherToken instead of settlement.paymentToken()
        StreamPaySettlement.ContentOffer memory badOffer = StreamPaySettlement.ContentOffer({
            recipient: creator,
            token: address(otherToken),
            contentIdHash: contentHash,
            pricingPolicyHash: policyHash,
            unitPrice: 500,
            maxBillableUnits: 3600,
            manifestRoot: manifestRoot,
            maxCreditSegments: 3,
            maxCreditWindowUnits: 10,
            maxUnredeemedAmount: 50_000,
            offerNonce: 1,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours)
        });

        bytes32 offerDigest = settlement.hashContentOffer(badOffer);

        StreamPaySettlement.SessionConfig memory cfg = StreamPaySettlement.SessionConfig({
            payer: payer,
            sessionSigner: makeAddr("signer"),
            offerDigest: offerDigest,
            initialDeposit: 10_000,
            maxLeadUnits: 10,
            validUntil: uint64(block.timestamp + 1 hours),
            redemptionGraceSeconds: 3600,
            nonce: 1
        });

        vm.startPrank(payer);
        otherToken.approve(address(settlement), 10_000);

        bytes memory dummySig = new bytes(65);

        // Must revert with InvalidOffer because offer.token != settlement.paymentToken()
        vm.expectRevert(StreamPaySettlement.InvalidOffer.selector);
        settlement.openWithSignature(badOffer, dummySig, cfg, dummySig);
        vm.stopPrank();
    }
}

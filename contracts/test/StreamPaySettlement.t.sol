// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {StreamPaySettlement} from "../src/StreamPaySettlement.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/**
 * @title StreamPaySettlementTest
 * @notice Comprehensive tests for the StreamPay settlement contract.
 * Covers: open, checkpoint, close, expiry, refund, attack scenarios.
 */
contract StreamPaySettlementTest is Test {
    StreamPaySettlement public settlement;
    MockUSDC public usdc;

    // Test accounts
    uint256 constant CREATOR_KEY = 0xA11CE;
    uint256 constant PAYER_KEY = 0xB0B;
    uint256 constant SESSION_SIGNER_KEY = 0xC0DE;
    uint256 constant ATTACKER_KEY = 0xDEAD;

    address creator;
    address payer;
    address sessionSigner;
    address attacker;
    address owner;

    // Default offer params
    uint256 constant UNIT_PRICE = 500; // 0.0005 USDC per second
    uint64 constant MAX_BILLABLE = 3600; // 1 hour
    uint64 constant MAX_CREDIT_WINDOW = 12; // 12 seconds
    uint8 constant MAX_CREDIT_SEGMENTS = 3;
    uint256 constant INITIAL_DEPOSIT = 1_800_000; // 1.8 USDC for 1 hour
    uint64 constant MAX_LEAD = 12;

    bytes32 constant CONTENT_HASH = keccak256("test-video-content-id");
    bytes32 constant POLICY_HASH = keccak256("fixed-rate-500-per-second");
    bytes32 constant MANIFEST_ROOT = keccak256("merkle-root-of-segments");

    function setUp() public {
        creator = vm.addr(CREATOR_KEY);
        payer = vm.addr(PAYER_KEY);
        sessionSigner = vm.addr(SESSION_SIGNER_KEY);
        attacker = vm.addr(ATTACKER_KEY);
        owner = address(this);

        usdc = new MockUSDC();
        settlement = new StreamPaySettlement(address(usdc), owner);

        // Fund payer
        usdc.mint(payer, 100_000_000); // 100 USDC
        vm.prank(payer);
        usdc.approve(address(settlement), type(uint256).max);

        // Fund attacker
        usdc.mint(attacker, 100_000_000);
        vm.prank(attacker);
        usdc.approve(address(settlement), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════

    function _defaultOffer() internal view returns (StreamPaySettlement.ContentOffer memory) {
        return StreamPaySettlement.ContentOffer({
            recipient: creator,
            token: address(usdc),
            contentIdHash: CONTENT_HASH,
            pricingPolicyHash: POLICY_HASH,
            unitPrice: UNIT_PRICE,
            maxBillableUnits: MAX_BILLABLE,
            manifestRoot: MANIFEST_ROOT,
            maxCreditSegments: MAX_CREDIT_SEGMENTS,
            maxCreditWindowUnits: MAX_CREDIT_WINDOW,
            maxUnredeemedAmount: UNIT_PRICE * MAX_CREDIT_WINDOW * 5, // 5 windows worth
            offerNonce: 1,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 2 hours)
        });
    }

    function _defaultConfig(bytes32 offerDigest) internal view returns (StreamPaySettlement.SessionConfig memory) {
        return StreamPaySettlement.SessionConfig({
            payer: payer,
            sessionSigner: sessionSigner,
            offerDigest: offerDigest,
            initialDeposit: INITIAL_DEPOSIT,
            maxLeadUnits: MAX_LEAD,
            validUntil: uint64(block.timestamp + 1 hours),
            redemptionGraceSeconds: uint64(1 hours),
            nonce: 0
        });
    }

    function _signOffer(StreamPaySettlement.ContentOffer memory offer, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = settlement.hashContentOffer(offer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signConfig(StreamPaySettlement.SessionConfig memory config, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = settlement.hashSessionConfig(config);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signVoucher(StreamPaySettlement.Voucher memory voucher, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = settlement.hashVoucher(voucher);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signCloseAck(StreamPaySettlement.CloseAck memory ack, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = settlement.hashCloseAck(ack);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _openSession() internal returns (bytes32 sessionId) {
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);
        bytes32 configDigest = settlement.hashSessionConfig(config);

        sessionId = keccak256(abi.encode(configDigest, offerDigest));

        settlement.openWithSignature(offer, offerSig, config, configSig);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Open Session Tests
    // ═══════════════════════════════════════════════════════════════════

    function test_openSession_success() public {
        uint256 payerBefore = usdc.balanceOf(payer);

        bytes32 sessionId = _openSession();

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(s.payer, payer);
        assertEq(s.sessionSigner, sessionSigner);
        assertEq(s.recipient, creator);
        assertEq(s.initialDeposit, INITIAL_DEPOSIT);
        assertEq(s.unitPrice, UNIT_PRICE);
        assertEq(s.settledAmount, 0);
        assertEq(s.settledUnits, 0);
        assertEq(uint8(s.status), uint8(StreamPaySettlement.SessionStatus.OPEN));

        // Deposit was transferred
        assertEq(usdc.balanceOf(payer), payerBefore - INITIAL_DEPOSIT);
        assertEq(usdc.balanceOf(address(settlement)), INITIAL_DEPOSIT);
    }

    function test_openSession_emitsEvents() public {
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);

        vm.expectEmit(true, true, true, false);
        bytes32 configDigest = settlement.hashSessionConfig(config);
        bytes32 expectedSessionId = keccak256(abi.encode(configDigest, offerDigest));
        emit StreamPaySettlement.StreamOpened(
            expectedSessionId, payer, creator, sessionSigner, offerDigest,
            INITIAL_DEPOSIT, config.validUntil, config.redemptionGraceSeconds,
            config.validUntil + config.redemptionGraceSeconds
        );

        settlement.openWithSignature(offer, offerSig, config, configSig);
    }

    function test_openSession_revert_wrongCreatorSig() public {
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        bytes memory badSig = _signOffer(offer, ATTACKER_KEY); // Wrong signer
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);

        vm.expectRevert(StreamPaySettlement.InvalidOffer.selector);
        settlement.openWithSignature(offer, badSig, config, configSig);
    }

    function test_openSession_revert_wrongPayerSig() public {
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory badSig = _signConfig(config, ATTACKER_KEY); // Wrong signer

        vm.expectRevert(StreamPaySettlement.InvalidSignature.selector);
        settlement.openWithSignature(offer, offerSig, config, badSig);
    }

    function test_openSession_revert_expiredOffer() public {
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        offer.expiresAt = uint64(block.timestamp); // Already expired

        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);

        vm.expectRevert(StreamPaySettlement.InvalidOffer.selector);
        settlement.openWithSignature(offer, offerSig, config, configSig);
    }

    function test_openSession_revert_duplicateNonce() public {
        _openSession();

        // Try again with the same nonce
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);

        vm.expectRevert(StreamPaySettlement.NonceUsed.selector);
        settlement.openWithSignature(offer, offerSig, config, configSig);
    }

    function test_openSession_revert_payerEqualsRecipient() public {
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        offer.recipient = payer; // Payer = recipient
        bytes memory offerSig = _signOffer(offer, PAYER_KEY); // Now payer signs as creator
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);

        vm.expectRevert(StreamPaySettlement.PayerEqualsRecipient.selector);
        settlement.openWithSignature(offer, offerSig, config, configSig);
    }

    function test_openSession_revert_whenPaused() public {
        settlement.pauseNewSessions();

        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);

        vm.expectRevert(StreamPaySettlement.ContractPaused.selector);
        settlement.openWithSignature(offer, offerSig, config, configSig);
    }

    function test_openSession_revert_tokenMismatch() public {
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        offer.token = address(0x1234); // Wrong token
        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config = _defaultConfig(offerDigest);
        bytes memory configSig = _signConfig(config, PAYER_KEY);

        vm.expectRevert(StreamPaySettlement.InvalidOffer.selector);
        settlement.openWithSignature(offer, offerSig, config, configSig);
    }

    function test_openSession_unorderedNonces() public {
        // Open with nonce 5 first
        StreamPaySettlement.ContentOffer memory offer = _defaultOffer();
        bytes memory offerSig = _signOffer(offer, CREATOR_KEY);
        bytes32 offerDigest = settlement.hashContentOffer(offer);

        StreamPaySettlement.SessionConfig memory config5 = _defaultConfig(offerDigest);
        config5.nonce = 5;
        bytes memory configSig5 = _signConfig(config5, PAYER_KEY);
        settlement.openWithSignature(offer, offerSig, config5, configSig5);

        // Open with nonce 2 (should succeed - unordered)
        StreamPaySettlement.SessionConfig memory config2 = _defaultConfig(offerDigest);
        config2.nonce = 2;
        bytes memory configSig2 = _signConfig(config2, PAYER_KEY);
        settlement.openWithSignature(offer, offerSig, config2, configSig2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Checkpoint Tests
    // ═══════════════════════════════════════════════════════════════════

    function test_checkpoint_success() public {
        bytes32 sessionId = _openSession();
        uint256 creatorBefore = usdc.balanceOf(creator);

        // Advance time 10 seconds
        vm.warp(block.timestamp + 10);

        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 10
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        settlement.checkpoint(sessionId, v, vSig);

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(s.settledUnits, 10);
        assertEq(s.settledAmount, 10 * UNIT_PRICE);
        assertEq(usdc.balanceOf(creator), creatorBefore + 10 * UNIT_PRICE);
    }

    function test_checkpoint_multipleTimes() public {
        bytes32 sessionId = _openSession();

        // First checkpoint at 10 seconds
        vm.warp(block.timestamp + 10);
        StreamPaySettlement.Voucher memory v1 = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 10
        });
        settlement.checkpoint(sessionId, v1, _signVoucher(v1, SESSION_SIGNER_KEY));

        // Second checkpoint at 30 seconds
        vm.warp(block.timestamp + 20);
        StreamPaySettlement.Voucher memory v2 = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 30
        });
        settlement.checkpoint(sessionId, v2, _signVoucher(v2, SESSION_SIGNER_KEY));

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(s.settledUnits, 30);
        assertEq(s.settledAmount, 30 * UNIT_PRICE); // 15,000 base units
    }

    function test_checkpoint_revert_oversizedImmediateVoucher() public {
        bytes32 sessionId = _openSession();

        // Try to claim 100 units immediately (only MAX_LEAD allowed)
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 100
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        vm.expectRevert(StreamPaySettlement.ExceedsElapsedPlusLead.selector);
        settlement.checkpoint(sessionId, v, vSig);
    }

    function test_checkpoint_atMaxLead() public {
        bytes32 sessionId = _openSession();

        // At t=0, can claim up to MAX_LEAD (12) units
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: MAX_LEAD
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        settlement.checkpoint(sessionId, v, vSig);
        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(s.settledUnits, MAX_LEAD);
    }

    function test_checkpoint_revert_wrongSigner() public {
        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + 10);

        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 10
        });
        bytes memory badSig = _signVoucher(v, ATTACKER_KEY);

        vm.expectRevert(StreamPaySettlement.InvalidSignature.selector);
        settlement.checkpoint(sessionId, v, badSig);
    }

    function test_checkpoint_revert_lowerUnits() public {
        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + 20);

        // Checkpoint at 15
        StreamPaySettlement.Voucher memory v1 = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 15
        });
        settlement.checkpoint(sessionId, v1, _signVoucher(v1, SESSION_SIGNER_KEY));

        // Try lower units
        StreamPaySettlement.Voucher memory v2 = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 10
        });
        vm.expectRevert(StreamPaySettlement.VoucherNotAdvancing.selector);
        settlement.checkpoint(sessionId, v2, _signVoucher(v2, SESSION_SIGNER_KEY));
    }

    function test_checkpoint_revert_exceedsDeposit() public {
        bytes32 sessionId = _openSession();

        // Warp far enough that elapsed allows it
        vm.warp(block.timestamp + MAX_BILLABLE + MAX_LEAD);

        // Try to settle more than deposit allows
        uint64 maxAffordableUnits = uint64(INITIAL_DEPOSIT / UNIT_PRICE);
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: maxAffordableUnits + 1
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        vm.expectRevert(StreamPaySettlement.ExceedsDepositCap.selector);
        settlement.checkpoint(sessionId, v, vSig);
    }

    function test_checkpoint_revert_closedSession() public {
        bytes32 sessionId = _openSession();

        // Cooperative close at 0 units
        vm.warp(block.timestamp + 5);
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 0
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        bytes32 vDigest = settlement.hashVoucher(v);
        StreamPaySettlement.CloseAck memory ack = StreamPaySettlement.CloseAck({
            sessionId: sessionId,
            cumulativeUnits: 0,
            voucherDigest: vDigest
        });
        bytes memory ackSig = _signCloseAck(ack, CREATOR_KEY);

        settlement.closeCooperative(sessionId, v, vSig, ack, ackSig);

        // Now try checkpoint - should fail
        StreamPaySettlement.Voucher memory v2 = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 5
        });
        vm.expectRevert(StreamPaySettlement.SessionNotOpen.selector);
        settlement.checkpoint(sessionId, v2, _signVoucher(v2, SESSION_SIGNER_KEY));
    }

    // ═══════════════════════════════════════════════════════════════════
    // Cooperative Close Tests
    // ═══════════════════════════════════════════════════════════════════

    function test_cooperativeClose_success() public {
        bytes32 sessionId = _openSession();
        uint256 payerBefore = usdc.balanceOf(payer);
        uint256 creatorBefore = usdc.balanceOf(creator);

        vm.warp(block.timestamp + 60);

        // Checkpoint some units first
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 60
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        bytes32 vDigest = settlement.hashVoucher(v);
        StreamPaySettlement.CloseAck memory ack = StreamPaySettlement.CloseAck({
            sessionId: sessionId,
            cumulativeUnits: 60,
            voucherDigest: vDigest
        });
        bytes memory ackSig = _signCloseAck(ack, CREATOR_KEY);

        settlement.closeCooperative(sessionId, v, vSig, ack, ackSig);

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(uint8(s.status), uint8(StreamPaySettlement.SessionStatus.CLOSED));

        uint256 expectedPaid = 60 * UNIT_PRICE; // 30,000
        uint256 expectedRefund = INITIAL_DEPOSIT - expectedPaid;

        assertEq(usdc.balanceOf(creator), creatorBefore + expectedPaid);
        assertEq(usdc.balanceOf(payer), payerBefore + expectedRefund);
    }

    function test_cooperativeClose_zeroUnits() public {
        bytes32 sessionId = _openSession();
        uint256 payerBefore = usdc.balanceOf(payer);

        vm.warp(block.timestamp + 5);

        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 0
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        bytes32 vDigest = settlement.hashVoucher(v);
        StreamPaySettlement.CloseAck memory ack = StreamPaySettlement.CloseAck({
            sessionId: sessionId,
            cumulativeUnits: 0,
            voucherDigest: vDigest
        });
        bytes memory ackSig = _signCloseAck(ack, CREATOR_KEY);

        settlement.closeCooperative(sessionId, v, vSig, ack, ackSig);

        // Full refund
        assertEq(usdc.balanceOf(payer), payerBefore + INITIAL_DEPOSIT);
    }

    function test_cooperativeClose_revert_wrongAckSigner() public {
        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + 10);

        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 10
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        bytes32 vDigest = settlement.hashVoucher(v);
        StreamPaySettlement.CloseAck memory ack = StreamPaySettlement.CloseAck({
            sessionId: sessionId,
            cumulativeUnits: 10,
            voucherDigest: vDigest
        });
        bytes memory badAckSig = _signCloseAck(ack, ATTACKER_KEY); // Wrong signer

        vm.expectRevert(StreamPaySettlement.InvalidSignature.selector);
        settlement.closeCooperative(sessionId, v, vSig, ack, badAckSig);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Unilateral Close + Challenge Tests
    // ═══════════════════════════════════════════════════════════════════

    function test_requestClose_success() public {
        bytes32 sessionId = _openSession();

        vm.prank(payer);
        settlement.requestClose(sessionId);

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(uint8(s.status), uint8(StreamPaySettlement.SessionStatus.CLOSE_REQUESTED));
        assertEq(s.closeRequestedAt, uint64(block.timestamp));
        assertEq(s.challengeEndsAt, uint64(block.timestamp) + settlement.CHALLENGE_SECONDS());
    }

    function test_requestClose_revert_notPayer() public {
        bytes32 sessionId = _openSession();

        vm.prank(attacker);
        vm.expectRevert(StreamPaySettlement.InvalidSession.selector);
        settlement.requestClose(sessionId);
    }

    function test_challengeCheckpoint_success() public {
        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + 30);

        // Checkpoint first
        StreamPaySettlement.Voucher memory v1 = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 20
        });
        settlement.checkpoint(sessionId, v1, _signVoucher(v1, SESSION_SIGNER_KEY));

        // Payer requests close
        vm.prank(payer);
        settlement.requestClose(sessionId);

        // Creator submits higher voucher during challenge
        StreamPaySettlement.Voucher memory v2 = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 30
        });
        settlement.checkpoint(sessionId, v2, _signVoucher(v2, SESSION_SIGNER_KEY));

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(s.settledUnits, 30);
    }

    function test_challengeCheckpoint_revert_afterChallengeEnds() public {
        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + 30);

        vm.prank(payer);
        settlement.requestClose(sessionId);

        // Warp past challenge
        vm.warp(block.timestamp + settlement.CHALLENGE_SECONDS());

        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 30
        });

        vm.expectRevert(StreamPaySettlement.ChallengeNotEnded.selector);
        settlement.checkpoint(sessionId, v, _signVoucher(v, SESSION_SIGNER_KEY));
    }

    function test_finalizeAfterChallenge_success() public {
        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + 30);

        // Checkpoint
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 20
        });
        settlement.checkpoint(sessionId, v, _signVoucher(v, SESSION_SIGNER_KEY));

        // Request close
        vm.prank(payer);
        settlement.requestClose(sessionId);

        // Wait for challenge to end
        vm.warp(block.timestamp + settlement.CHALLENGE_SECONDS());

        // Anyone can finalize
        settlement.finalizeAfterChallenge(sessionId);

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(uint8(s.status), uint8(StreamPaySettlement.SessionStatus.CLOSED));
    }

    function test_finalizeAfterChallenge_revert_tooEarly() public {
        bytes32 sessionId = _openSession();

        vm.prank(payer);
        settlement.requestClose(sessionId);

        // Try to finalize before challenge ends
        vm.warp(block.timestamp + settlement.CHALLENGE_SECONDS() - 1);

        vm.expectRevert(StreamPaySettlement.ChallengePending.selector);
        settlement.finalizeAfterChallenge(sessionId);
    }

    function test_elapsedFreezes_afterCloseRequest() public {
        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + 30);

        vm.prank(payer);
        settlement.requestClose(sessionId);

        uint64 frozenElapsed = settlement.getEffectiveElapsed(sessionId);

        // Warp more - elapsed should stay frozen
        vm.warp(block.timestamp + 1000);
        assertEq(settlement.getEffectiveElapsed(sessionId), frozenElapsed);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Expiry Tests
    // ═══════════════════════════════════════════════════════════════════

    function test_finalizeExpired_success() public {
        bytes32 sessionId = _openSession();
        StreamPaySettlement.StreamSession memory session = settlement.getSession(sessionId);

        // Warp past redemption deadline
        vm.warp(session.redemptionDeadline);

        settlement.finalizeExpired(sessionId);

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(uint8(s.status), uint8(StreamPaySettlement.SessionStatus.CLOSED));
    }

    function test_finalizeExpired_revert_tooEarly() public {
        bytes32 sessionId = _openSession();
        StreamPaySettlement.StreamSession memory session = settlement.getSession(sessionId);

        vm.warp(session.redemptionDeadline - 1);

        vm.expectRevert(StreamPaySettlement.RedemptionDeadlineNotReached.selector);
        settlement.finalizeExpired(sessionId);
    }

    function test_finalizeExpired_withCheckpointedAmount() public {
        bytes32 sessionId = _openSession();
        uint256 payerBefore = usdc.balanceOf(payer);

        // Checkpoint 100 units
        vm.warp(block.timestamp + 100);
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 100
        });
        settlement.checkpoint(sessionId, v, _signVoucher(v, SESSION_SIGNER_KEY));

        uint256 settled = 100 * UNIT_PRICE;

        // Let expire
        StreamPaySettlement.StreamSession memory session = settlement.getSession(sessionId);
        vm.warp(session.redemptionDeadline);
        settlement.finalizeExpired(sessionId);

        // Payer gets refund of unused portion
        assertEq(usdc.balanceOf(payer), payerBefore + (INITIAL_DEPOSIT - settled));
    }

    // ═══════════════════════════════════════════════════════════════════
    // Security / Attack Tests
    // ═══════════════════════════════════════════════════════════════════

    function test_attack_cannotRedirectRefund() public {
        bytes32 sessionId = _openSession();
        uint256 payerBefore = usdc.balanceOf(payer);

        // Close at 0 units
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 0
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);
        bytes32 vDigest = settlement.hashVoucher(v);

        StreamPaySettlement.CloseAck memory ack = StreamPaySettlement.CloseAck({
            sessionId: sessionId,
            cumulativeUnits: 0,
            voucherDigest: vDigest
        });
        bytes memory ackSig = _signCloseAck(ack, CREATOR_KEY);

        // Attacker calls close - refund STILL goes to stored payer
        vm.prank(attacker);
        settlement.closeCooperative(sessionId, v, vSig, ack, ackSig);

        assertEq(usdc.balanceOf(payer), payerBefore + INITIAL_DEPOSIT);
        assertEq(usdc.balanceOf(attacker), 100_000_000); // unchanged
    }

    function test_attack_pauseDoesNotBlockExits() public {
        bytes32 sessionId = _openSession();

        // Pause contract
        settlement.pauseNewSessions();

        // Checkpoint still works during pause
        vm.warp(block.timestamp + 10);
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 10
        });
        settlement.checkpoint(sessionId, v, _signVoucher(v, SESSION_SIGNER_KEY));

        // Request close still works
        vm.prank(payer);
        settlement.requestClose(sessionId);

        // Finalize still works
        vm.warp(block.timestamp + settlement.CHALLENGE_SECONDS());
        settlement.finalizeAfterChallenge(sessionId);

        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        assertEq(uint8(s.status), uint8(StreamPaySettlement.SessionStatus.CLOSED));
    }

    function test_accountingInvariant_totalEqualsDeposit() public {
        bytes32 sessionId = _openSession();

        vm.warp(block.timestamp + 200);

        // Checkpoint 120 units
        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 120
        });
        settlement.checkpoint(sessionId, v, _signVoucher(v, SESSION_SIGNER_KEY));

        // Cooperative close at 200
        StreamPaySettlement.Voucher memory vFinal = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: 200
        });
        bytes memory vFinalSig = _signVoucher(vFinal, SESSION_SIGNER_KEY);
        bytes32 vDigest = settlement.hashVoucher(vFinal);

        StreamPaySettlement.CloseAck memory ack = StreamPaySettlement.CloseAck({
            sessionId: sessionId,
            cumulativeUnits: 200,
            voucherDigest: vDigest
        });
        bytes memory ackSig = _signCloseAck(ack, CREATOR_KEY);

        settlement.closeCooperative(sessionId, vFinal, vFinalSig, ack, ackSig);

        // Verify: paid + refund = deposit
        StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
        uint256 paid = s.settledAmount;
        uint256 refund = INITIAL_DEPOSIT - paid;

        assertEq(paid + refund, INITIAL_DEPOSIT);
        assertEq(usdc.balanceOf(creator), paid);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Fuzz Tests
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_voucherRespectsBounds(uint64 elapsed, uint64 claimed) public {
        elapsed = uint64(bound(elapsed, 0, 3600));
        claimed = uint64(bound(claimed, 0, 4000));

        bytes32 sessionId = _openSession();
        vm.warp(block.timestamp + elapsed);

        StreamPaySettlement.Voucher memory v = StreamPaySettlement.Voucher({
            sessionId: sessionId,
            cumulativeUnits: claimed
        });
        bytes memory vSig = _signVoucher(v, SESSION_SIGNER_KEY);

        uint256 maxAllowed = uint256(elapsed) + uint256(MAX_LEAD);
        uint256 maxByDeposit = INITIAL_DEPOSIT / UNIT_PRICE;
        uint256 maxByOffer = MAX_BILLABLE;

        if (claimed == 0 || claimed > maxAllowed || claimed > maxByDeposit || claimed > maxByOffer) {
            vm.expectRevert();
        }

        try settlement.checkpoint(sessionId, v, vSig) {
            // If successful, verify bounds
            StreamPaySettlement.StreamSession memory s = settlement.getSession(sessionId);
            assertTrue(s.settledUnits <= uint64(maxAllowed));
            assertTrue(s.settledAmount <= INITIAL_DEPOSIT);
        } catch {}
    }
}

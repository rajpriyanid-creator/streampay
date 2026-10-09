// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title StreamPaySettlement
 * @notice Bounded-credit cumulative-voucher settlement for pay-per-use media streaming.
 * @dev Non-upgradeable. One immutable payment token per deployment. No top-up.
 *
 * Key design:
 * - Creator signs an EIP-712 ContentOffer binding recipient, price, content, manifest root, and limits.
 * - Payer signs an EIP-712 SessionConfig binding the offer, deposit, session signer, and timing.
 * - Vouchers contain only {sessionId, cumulativeUnits}; amount = cumulativeUnits * unitPrice.
 * - Elapsed-plus-lead bound: cumulativeUnits <= effectiveElapsedSeconds + maxLeadUnits.
 * - Challenge close: unilateral close starts a fixed CHALLENGE_SECONDS window.
 * - Cooperative close: immediate with creator acknowledgement of exact final voucher.
 * - Push-with-pull-fallback payout: failed transfers become claimable credits.
 * - Refund always goes to stored payer. No caller-controlled refund address.
 */
contract StreamPaySettlement is EIP712, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────
    uint64 public constant MIN_SESSION_VALIDITY = 10 minutes;
    uint64 public constant MAX_SESSION_VALIDITY = 24 hours;
    uint64 public constant MIN_REDEMPTION_GRACE = 1 hours;
    uint64 public constant MAX_REDEMPTION_GRACE = 24 hours;
    uint64 public constant CHALLENGE_SECONDS = 15 minutes;
    uint64 public constant MAX_LEAD_UNITS = 30;
    uint64 public constant MAX_BILLABLE_UNITS = 86_430;
    uint8 public constant MAX_CREDIT_SEGMENTS = 5;
    uint64 public constant MAX_CREDIT_UNITS = 20;

    // ─── EIP-712 Type Hashes ─────────────────────────────────────────────

    bytes32 public constant CONTENT_OFFER_TYPEHASH = keccak256(
        "ContentOffer(address recipient,address token,bytes32 contentIdHash,bytes32 pricingPolicyHash,uint256 unitPrice,uint64 maxBillableUnits,bytes32 manifestRoot,uint8 maxCreditSegments,uint64 maxCreditWindowUnits,uint256 maxUnredeemedAmount,uint256 offerNonce,uint64 issuedAt,uint64 expiresAt)"
    );

    bytes32 public constant SESSION_CONFIG_TYPEHASH = keccak256(
        "SessionConfig(address payer,address sessionSigner,bytes32 offerDigest,uint256 initialDeposit,uint64 maxLeadUnits,uint64 validUntil,uint64 redemptionGraceSeconds,uint256 nonce)"
    );

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(bytes32 sessionId,uint64 cumulativeUnits)"
    );

    bytes32 public constant CLOSE_ACK_TYPEHASH = keccak256(
        "CloseAck(bytes32 sessionId,uint64 cumulativeUnits,bytes32 voucherDigest)"
    );

    bytes32 public constant REQUEST_CLOSE_TYPEHASH = keccak256(
        "RequestClose(bytes32 sessionId,uint64 deadline)"
    );

    // ─── Enums ───────────────────────────────────────────────────────────

    enum SessionStatus {
        NONE,
        OPEN,
        CLOSE_REQUESTED,
        CLOSED
    }

    enum CloseReason {
        COOPERATIVE,
        CHALLENGE_FINALIZED,
        EXPIRED
    }

    // ─── Structs ─────────────────────────────────────────────────────────

    struct ContentOffer {
        address recipient;
        address token;
        bytes32 contentIdHash;
        bytes32 pricingPolicyHash;
        uint256 unitPrice;
        uint64 maxBillableUnits;
        bytes32 manifestRoot;
        uint8 maxCreditSegments;
        uint64 maxCreditWindowUnits;
        uint256 maxUnredeemedAmount;
        uint256 offerNonce;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    struct SessionConfig {
        address payer;
        address sessionSigner;
        bytes32 offerDigest;
        uint256 initialDeposit;
        uint64 maxLeadUnits;
        uint64 validUntil;
        uint64 redemptionGraceSeconds;
        uint256 nonce;
    }

    struct Voucher {
        bytes32 sessionId;
        uint64 cumulativeUnits;
    }

    struct CloseAck {
        bytes32 sessionId;
        uint64 cumulativeUnits;
        bytes32 voucherDigest;
    }

    struct StreamSession {
        address payer;
        address sessionSigner;
        address recipient;
        bytes32 offerDigest;
        bytes32 contentIdHash;
        bytes32 pricingPolicyHash;
        bytes32 manifestRoot;
        uint256 initialDeposit;
        uint256 unitPrice;
        uint256 maxUnredeemedAmount;
        uint256 settledAmount;
        uint64 settledUnits;
        uint64 maxBillableUnits;
        uint64 maxCreditWindowUnits;
        uint64 maxLeadUnits;
        uint64 openedAt;
        uint64 validUntil;
        uint64 offerExpiresAt;
        uint64 redemptionGraceSeconds;
        uint64 redemptionDeadline;
        uint64 closeRequestedAt;
        uint64 challengeEndsAt;
        uint8 maxCreditSegments;
        SessionStatus status;
    }

    // ─── State ───────────────────────────────────────────────────────────

    IERC20 public immutable paymentToken;
    bool public paused;

    mapping(bytes32 => StreamSession) public sessions;
    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;
    mapping(address => mapping(address => uint256)) public claimable; // claimable[token][account]

    // ─── Events ──────────────────────────────────────────────────────────

    event StreamOpened(
        bytes32 indexed sessionId,
        address indexed payer,
        address indexed recipient,
        address sessionSigner,
        bytes32 offerDigest,
        uint256 initialDeposit,
        uint64 validUntil,
        uint64 redemptionGraceSeconds,
        uint64 redemptionDeadline
    );

    event StreamPolicyBound(
        bytes32 indexed sessionId,
        bytes32 contentIdHash,
        bytes32 pricingPolicyHash,
        bytes32 manifestRoot,
        uint256 unitPrice,
        uint64 maxBillableUnits,
        uint64 maxLeadUnits,
        uint8 maxCreditSegments,
        uint64 maxCreditWindowUnits,
        uint256 maxUnredeemedAmount,
        uint64 offerExpiresAt
    );

    event StreamCheckpointed(
        bytes32 indexed sessionId,
        uint64 cumulativeUnits,
        uint256 cumulativeAmount,
        uint256 delta,
        uint256 totalSettled
    );

    event CloseRequested(
        bytes32 indexed sessionId,
        uint64 closeRequestedAt,
        uint64 challengeEndsAt
    );

    event StreamClosed(
        bytes32 indexed sessionId,
        uint256 totalPaidOrCredited,
        uint256 refundAllocated,
        CloseReason closeReason
    );

    event PayoutCredited(
        address indexed token,
        address indexed account,
        uint256 amount,
        string reason
    );

    event Claimed(
        address indexed token,
        address indexed account,
        uint256 amount
    );

    event Paused(address account);
    event Unpaused(address account);

    // ─── Errors ──────────────────────────────────────────────────────────

    error ContractPaused();
    error InvalidOffer();
    error OfferExpired();
    error TokenMismatch();
    error InvalidSession();
    error SessionExists();
    error NonceUsed();
    error InvalidDeposit();
    error InsufficientDeposit();
    error InvalidValidity();
    error InvalidGrace();
    error InvalidLeadUnits();
    error InvalidCreditWindow();
    error InvalidVoucher();
    error VoucherNotAdvancing();
    error ExceedsMaxBillableUnits();
    error ExceedsDepositCap();
    error ExceedsElapsedPlusLead();
    error SessionNotOpen();
    error SessionNotCloseRequested();
    error SessionAlreadyClosed();
    error SessionExpired();
    error ChallengePending();
    error ChallengeNotEnded();
    error RedemptionDeadlineNotReached();
    error RedemptionDeadlinePassed();
    error InvalidSignature();
    error InvalidCloseAck();
    error ZeroAddress();
    error PayerEqualsRecipient();
    error PayerEqualsSessionSigner();
    error TransferFailed();
    error NothingToClaim();

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(
        address _paymentToken,
        address _owner
    ) EIP712("StreamPay", "2") Ownable(_owner) {
        if (_paymentToken == address(0)) revert ZeroAddress();
        paymentToken = IERC20(_paymentToken);
    }

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ─── View Functions ──────────────────────────────────────────────────

    function hashContentOffer(ContentOffer calldata offer) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            CONTENT_OFFER_TYPEHASH,
            offer.recipient,
            offer.token,
            offer.contentIdHash,
            offer.pricingPolicyHash,
            offer.unitPrice,
            offer.maxBillableUnits,
            offer.manifestRoot,
            offer.maxCreditSegments,
            offer.maxCreditWindowUnits,
            offer.maxUnredeemedAmount,
            offer.offerNonce,
            offer.issuedAt,
            offer.expiresAt
        )));
    }

    function hashSessionConfig(SessionConfig calldata config) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SESSION_CONFIG_TYPEHASH,
            config.payer,
            config.sessionSigner,
            config.offerDigest,
            config.initialDeposit,
            config.maxLeadUnits,
            config.validUntil,
            config.redemptionGraceSeconds,
            config.nonce
        )));
    }

    function hashVoucher(Voucher calldata voucher) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            voucher.sessionId,
            voucher.cumulativeUnits
        )));
    }

    function hashCloseAck(CloseAck calldata ack) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            CLOSE_ACK_TYPEHASH,
            ack.sessionId,
            ack.cumulativeUnits,
            ack.voucherDigest
        )));
    }

    function getSession(bytes32 sessionId) external view returns (StreamSession memory) {
        return sessions[sessionId];
    }

    function getEffectiveElapsed(bytes32 sessionId) public view returns (uint64) {
        StreamSession storage s = sessions[sessionId];
        if (s.status == SessionStatus.NONE) return 0;

        uint64 effectiveEnd;
        if (s.status == SessionStatus.CLOSE_REQUESTED) {
            effectiveEnd = s.closeRequestedAt < s.validUntil ? s.closeRequestedAt : s.validUntil;
        } else {
            effectiveEnd = uint64(block.timestamp) < s.validUntil ? uint64(block.timestamp) : s.validUntil;
        }

        if (effectiveEnd <= s.openedAt) return 0;
        return effectiveEnd - s.openedAt;
    }

    function getDerivedAmount(bytes32 sessionId, uint64 cumulativeUnits) public view returns (uint256) {
        StreamSession storage s = sessions[sessionId];
        return uint256(cumulativeUnits) * s.unitPrice;
    }

    function validateContentOffer(
        ContentOffer calldata offer,
        bytes calldata creatorSignature
    ) external view returns (bool valid, bytes32 offerDigest) {
        offerDigest = hashContentOffer(offer);
        valid = _validateOfferInternal(offer, offerDigest, creatorSignature);
    }

    // ─── Open Session ────────────────────────────────────────────────────

    function openWithSignature(
        ContentOffer calldata offer,
        bytes calldata offerSignature,
        SessionConfig calldata config,
        bytes calldata payerSignature
    ) external nonReentrant whenNotPaused {
        // 1. Validate creator offer
        bytes32 offerDigest = hashContentOffer(offer);
        if (!_validateOfferInternal(offer, offerDigest, offerSignature)) {
            revert InvalidOffer();
        }

        // 2. Validate session config
        if (config.payer == address(0) || config.sessionSigner == address(0)) revert ZeroAddress();
        if (config.payer == offer.recipient) revert PayerEqualsRecipient();
        if (config.payer == config.sessionSigner) revert PayerEqualsSessionSigner();
        if (config.offerDigest != offerDigest) revert InvalidSession();
        if (config.initialDeposit == 0) revert InvalidDeposit();

        // Validate lead units
        if (config.maxLeadUnits < offer.maxCreditWindowUnits) revert InvalidLeadUnits();
        if (config.maxLeadUnits > MAX_LEAD_UNITS) revert InvalidLeadUnits();

        // Validate timing
        if (config.validUntil < uint64(block.timestamp) + MIN_SESSION_VALIDITY) revert InvalidValidity();
        if (config.validUntil > uint64(block.timestamp) + MAX_SESSION_VALIDITY) revert InvalidValidity();
        if (config.validUntil > offer.expiresAt) revert InvalidValidity();
        if (config.redemptionGraceSeconds < MIN_REDEMPTION_GRACE) revert InvalidGrace();
        if (config.redemptionGraceSeconds > MAX_REDEMPTION_GRACE) revert InvalidGrace();

        // Validate deposit covers at least one credit window
        uint256 minWindowCost = offer.unitPrice * uint256(offer.maxCreditWindowUnits);
        if (config.initialDeposit < minWindowCost) revert InsufficientDeposit();

        // Validate unredeemed amount relationship
        if (offer.maxUnredeemedAmount > config.initialDeposit) revert InvalidDeposit();
        if (offer.maxUnredeemedAmount < minWindowCost) revert InvalidCreditWindow();

        // 3. Verify payer signature
        bytes32 configDigest = hashSessionConfig(config);
        if (!SignatureChecker.isValidSignatureNow(config.payer, configDigest, payerSignature)) {
            revert InvalidSignature();
        }

        // 4. Consume unordered bitmap nonce
        _useNonce(config.payer, config.nonce);

        // 5. Derive session ID
        bytes32 sessionId = keccak256(abi.encode(configDigest, offerDigest));
        if (sessions[sessionId].status != SessionStatus.NONE) revert SessionExists();

        // 6. Transfer exact deposit
        uint256 balBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(config.payer, address(this), config.initialDeposit);
        uint256 balAfter = paymentToken.balanceOf(address(this));
        if (balAfter - balBefore != config.initialDeposit) revert InvalidDeposit();

        // 7. Store session
        uint64 redemptionDeadline = config.validUntil + config.redemptionGraceSeconds;

        StreamSession storage s = sessions[sessionId];
        s.payer = config.payer;
        s.sessionSigner = config.sessionSigner;
        s.recipient = offer.recipient;
        s.offerDigest = offerDigest;
        s.contentIdHash = offer.contentIdHash;
        s.pricingPolicyHash = offer.pricingPolicyHash;
        s.manifestRoot = offer.manifestRoot;
        s.initialDeposit = config.initialDeposit;
        s.unitPrice = offer.unitPrice;
        s.maxUnredeemedAmount = offer.maxUnredeemedAmount;
        s.settledAmount = 0;
        s.settledUnits = 0;
        s.maxBillableUnits = offer.maxBillableUnits;
        s.maxCreditWindowUnits = offer.maxCreditWindowUnits;
        s.maxLeadUnits = config.maxLeadUnits;
        s.openedAt = uint64(block.timestamp);
        s.validUntil = config.validUntil;
        s.offerExpiresAt = offer.expiresAt;
        s.redemptionGraceSeconds = config.redemptionGraceSeconds;
        s.redemptionDeadline = redemptionDeadline;
        s.maxCreditSegments = offer.maxCreditSegments;
        s.status = SessionStatus.OPEN;

        // 8. Emit events
        emit StreamOpened(
            sessionId,
            config.payer,
            offer.recipient,
            config.sessionSigner,
            offerDigest,
            config.initialDeposit,
            config.validUntil,
            config.redemptionGraceSeconds,
            redemptionDeadline
        );

        emit StreamPolicyBound(
            sessionId,
            offer.contentIdHash,
            offer.pricingPolicyHash,
            offer.manifestRoot,
            offer.unitPrice,
            offer.maxBillableUnits,
            config.maxLeadUnits,
            offer.maxCreditSegments,
            offer.maxCreditWindowUnits,
            offer.maxUnredeemedAmount,
            offer.expiresAt
        );
    }

    // ─── Checkpoint ──────────────────────────────────────────────────────

    function checkpoint(
        bytes32 sessionId,
        Voucher calldata voucher,
        bytes calldata voucherSignature
    ) external nonReentrant {
        StreamSession storage s = sessions[sessionId];

        // Validate session status
        if (s.status == SessionStatus.NONE || s.status == SessionStatus.CLOSED) {
            revert SessionNotOpen();
        }

        // If CLOSE_REQUESTED, checkpoint must be before challenge ends
        if (s.status == SessionStatus.CLOSE_REQUESTED) {
            if (uint64(block.timestamp) >= s.challengeEndsAt) revert ChallengeNotEnded();
        }

        // If OPEN, checkpoint must be before redemption deadline
        if (s.status == SessionStatus.OPEN) {
            if (uint64(block.timestamp) >= s.redemptionDeadline) revert RedemptionDeadlinePassed();
        }

        _applyVoucher(sessionId, s, voucher, voucherSignature, true);
    }

    // ─── Cooperative Close ───────────────────────────────────────────────

    function closeCooperative(
        bytes32 sessionId,
        Voucher calldata finalVoucher,
        bytes calldata voucherSignature,
        CloseAck calldata ack,
        bytes calldata ackSignature
    ) external nonReentrant {
        StreamSession storage s = sessions[sessionId];
        if (s.status != SessionStatus.OPEN && s.status != SessionStatus.CLOSE_REQUESTED) {
            revert SessionNotOpen();
        }
        if (uint64(block.timestamp) >= s.redemptionDeadline) revert RedemptionDeadlinePassed();

        // Validate close ack matches the voucher
        bytes32 voucherDigest = hashVoucher(finalVoucher);
        if (ack.sessionId != sessionId) revert InvalidCloseAck();
        if (ack.cumulativeUnits != finalVoucher.cumulativeUnits) revert InvalidCloseAck();
        if (ack.voucherDigest != voucherDigest) revert InvalidCloseAck();

        // Verify creator/recipient signed the ack
        bytes32 ackDigest = hashCloseAck(ack);
        if (!SignatureChecker.isValidSignatureNow(s.recipient, ackDigest, ackSignature)) {
            revert InvalidSignature();
        }

        // Apply the final voucher (allow no-op if units equal settled)
        _applyVoucher(sessionId, s, finalVoucher, voucherSignature, false);

        // Finalize
        _finalizeSession(sessionId, s, CloseReason.COOPERATIVE);
    }

    // ─── Request Close (Unilateral) ──────────────────────────────────────

    function requestClose(bytes32 sessionId) external nonReentrant {
        StreamSession storage s = sessions[sessionId];
        if (s.status != SessionStatus.OPEN) revert SessionNotOpen();
        if (msg.sender != s.payer) revert InvalidSession();
        if (uint64(block.timestamp) >= s.validUntil) revert SessionExpired();

        _startChallenge(sessionId, s);
    }

    function requestCloseBySignature(
        bytes32 sessionId,
        uint64 deadline,
        bytes calldata payerSignature
    ) external nonReentrant {
        StreamSession storage s = sessions[sessionId];
        if (s.status != SessionStatus.OPEN) revert SessionNotOpen();
        if (uint64(block.timestamp) >= s.validUntil) revert SessionExpired();
        if (uint64(block.timestamp) > deadline) revert SessionExpired();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            REQUEST_CLOSE_TYPEHASH,
            sessionId,
            deadline
        )));
        if (!SignatureChecker.isValidSignatureNow(s.payer, digest, payerSignature)) {
            revert InvalidSignature();
        }

        _startChallenge(sessionId, s);
    }

    // ─── Finalize After Challenge ────────────────────────────────────────

    function finalizeAfterChallenge(bytes32 sessionId) external nonReentrant {
        StreamSession storage s = sessions[sessionId];
        if (s.status != SessionStatus.CLOSE_REQUESTED) revert SessionNotCloseRequested();
        if (uint64(block.timestamp) < s.challengeEndsAt) revert ChallengePending();

        _finalizeSession(sessionId, s, CloseReason.CHALLENGE_FINALIZED);
    }

    // ─── Finalize Expired ────────────────────────────────────────────────

    function finalizeExpired(bytes32 sessionId) external nonReentrant {
        StreamSession storage s = sessions[sessionId];

        // Only OPEN sessions can be expired (CLOSE_REQUESTED uses finalizeAfterChallenge)
        if (s.status != SessionStatus.OPEN) revert SessionNotOpen();
        if (uint64(block.timestamp) < s.redemptionDeadline) revert RedemptionDeadlineNotReached();

        _finalizeSession(sessionId, s, CloseReason.EXPIRED);
    }

    // ─── Claim ───────────────────────────────────────────────────────────

    function claim(address token) external nonReentrant {
        uint256 amount = claimable[token][msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[token][msg.sender] = 0;

        bool success = _tryTransfer(IERC20(token), msg.sender, amount);
        if (!success) {
            // Restore claimable if transfer still fails
            claimable[token][msg.sender] = amount;
            revert TransferFailed();
        }

        emit Claimed(token, msg.sender, amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function pauseNewSessions() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpauseNewSessions() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ─── Internal: Validate Offer ────────────────────────────────────────

    function _validateOfferInternal(
        ContentOffer calldata offer,
        bytes32 offerDigest,
        bytes calldata creatorSignature
    ) internal view returns (bool) {
        // Basic field validation
        if (offer.recipient == address(0)) return false;
        if (offer.token != address(paymentToken)) return false;
        if (offer.unitPrice == 0) return false;
        if (offer.maxBillableUnits == 0) return false;
        if (offer.maxBillableUnits > MAX_BILLABLE_UNITS) return false;
        if (offer.manifestRoot == bytes32(0)) return false;
        if (offer.contentIdHash == bytes32(0)) return false;
        if (offer.pricingPolicyHash == bytes32(0)) return false;

        // Time checks
        if (offer.expiresAt <= uint64(block.timestamp)) return false;
        if (offer.issuedAt > uint64(block.timestamp) + 300) return false; // 5 min clock skew
        if (offer.expiresAt <= offer.issuedAt) return false;

        // Credit window checks
        if (offer.maxCreditSegments == 0 || offer.maxCreditSegments > MAX_CREDIT_SEGMENTS) return false;
        if (offer.maxCreditWindowUnits == 0 || offer.maxCreditWindowUnits > MAX_CREDIT_UNITS) return false;
        if (offer.maxBillableUnits < offer.maxCreditWindowUnits) return false;

        // Unredeemed amount check (must cover at least one credit window)
        if (offer.maxUnredeemedAmount == 0) return false;
        uint256 windowCost = offer.unitPrice * uint256(offer.maxCreditWindowUnits);
        if (offer.maxUnredeemedAmount < windowCost) return false;

        // Verify creator signature
        if (!SignatureChecker.isValidSignatureNow(offer.recipient, offerDigest, creatorSignature)) {
            return false;
        }

        return true;
    }

    // ─── Internal: Apply Voucher ─────────────────────────────────────────

    function _applyVoucher(
        bytes32 sessionId,
        StreamSession storage s,
        Voucher calldata voucher,
        bytes calldata voucherSignature,
        bool requireAdvance
    ) internal {
        // Validate voucher fields
        if (voucher.sessionId != sessionId) revert InvalidVoucher();

        // Verify session signer
        bytes32 vDigest = hashVoucher(voucher);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(vDigest, voucherSignature);
        if (err != ECDSA.RecoverError.NoError || recovered != s.sessionSigner) {
            revert InvalidSignature();
        }

        uint64 newUnits = voucher.cumulativeUnits;

        if (requireAdvance) {
            if (newUnits <= s.settledUnits) revert VoucherNotAdvancing();
        } else {
            // Cooperative close: allow equal (no-op) or advancing
            if (newUnits < s.settledUnits) revert VoucherNotAdvancing();
        }

        // Check max billable units
        if (newUnits > s.maxBillableUnits) revert ExceedsMaxBillableUnits();

        // Check elapsed + lead bound
        uint64 effectiveElapsed = getEffectiveElapsed(sessionId);
        if (newUnits > effectiveElapsed + s.maxLeadUnits) revert ExceedsElapsedPlusLead();

        // Compute derived amount
        uint256 newAmount = uint256(newUnits) * s.unitPrice;
        if (newAmount > s.initialDeposit) revert ExceedsDepositCap();

        // Compute delta
        uint256 delta = newAmount - s.settledAmount;

        if (delta > 0) {
            // Update state before transfer (CEI)
            s.settledUnits = newUnits;
            s.settledAmount = newAmount;

            // Pay creator (push with pull fallback)
            _safePayout(address(paymentToken), s.recipient, delta, "checkpoint");

            emit StreamCheckpointed(
                sessionId,
                newUnits,
                newAmount,
                delta,
                newAmount
            );
        } else if (!requireAdvance) {
            // No-op for cooperative close at same units
            s.settledUnits = newUnits;
        }
    }

    // ─── Internal: Finalize Session ──────────────────────────────────────

    function _finalizeSession(
        bytes32 sessionId,
        StreamSession storage s,
        CloseReason reason
    ) internal {
        uint256 totalPaid = s.settledAmount;
        uint256 refund = s.initialDeposit - totalPaid;

        s.status = SessionStatus.CLOSED;

        if (refund > 0) {
            _safePayout(address(paymentToken), s.payer, refund, "refund");
        }

        emit StreamClosed(sessionId, totalPaid, refund, reason);
    }

    // ─── Internal: Challenge ─────────────────────────────────────────────

    function _startChallenge(bytes32 sessionId, StreamSession storage s) internal {
        s.status = SessionStatus.CLOSE_REQUESTED;
        s.closeRequestedAt = uint64(block.timestamp);
        s.challengeEndsAt = uint64(block.timestamp) + CHALLENGE_SECONDS;

        emit CloseRequested(sessionId, s.closeRequestedAt, s.challengeEndsAt);
    }

    // ─── Internal: Nonce ─────────────────────────────────────────────────

    function _useNonce(address account, uint256 nonce) internal {
        uint256 wordPos = nonce >> 8;
        uint256 bitPos = nonce & 255;
        uint256 mask = 1 << bitPos;

        uint256 word = nonceBitmap[account][wordPos];
        if (word & mask != 0) revert NonceUsed();
        nonceBitmap[account][wordPos] = word | mask;
    }

    // ─── Internal: Safe Payout ───────────────────────────────────────────

    function _safePayout(
        address token,
        address account,
        uint256 amount,
        string memory reason
    ) internal {
        bool success = _tryTransfer(IERC20(token), account, amount);
        if (!success) {
            claimable[token][account] += amount;
            emit PayoutCredited(token, account, amount, reason);
        }
    }

    function _tryTransfer(IERC20 token, address to, uint256 amount) internal returns (bool) {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        if (success && data.length > 0) {
            return abi.decode(data, (bool));
        }
        return success && data.length == 0;
    }
}

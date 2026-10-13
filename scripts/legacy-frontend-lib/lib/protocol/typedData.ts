/**
 * StreamPay Protocol TypedData Definitions
 * EIP-712 type definitions matching the Solidity contract exactly.
 * These types are the canonical source for both frontend and access service.
 */

// ─── Domain ──────────────────────────────────────────────────────────

export const STREAMPAY_DOMAIN = {
  name: 'StreamPaySettlement',
  version: '2.5',
} as const;

export function getStreamPayDomain(chainId: number, verifyingContract: string) {
  return {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId: BigInt(chainId),
    verifyingContract: verifyingContract as `0x${string}`,
  };
}

export const CANONICAL_PRICING_POLICY_STRING = 'fixed-rate-0.0005-usdc-per-second-unit';
export const CANONICAL_PRICING_POLICY_HASH = '0x76422f1e290b9f7982658421843336df3a5b54190454061ecfa6748f5987c500' as const;

// ─── ContentOffer ────────────────────────────────────────────────────

export const CONTENT_OFFER_TYPES = {
  ContentOffer: [
    { name: 'recipient', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'contentIdHash', type: 'bytes32' },
    { name: 'pricingPolicyHash', type: 'bytes32' },
    { name: 'unitPrice', type: 'uint256' },
    { name: 'maxBillableUnits', type: 'uint64' },
    { name: 'manifestRoot', type: 'bytes32' },
    { name: 'maxCreditSegments', type: 'uint8' },
    { name: 'maxCreditWindowUnits', type: 'uint64' },
    { name: 'maxUnredeemedAmount', type: 'uint256' },
    { name: 'offerNonce', type: 'uint256' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const;

export interface ContentOffer {
  recipient: string;
  token: string;
  contentIdHash: string;
  pricingPolicyHash: string;
  unitPrice: bigint;
  maxBillableUnits: bigint;
  manifestRoot: string;
  maxCreditSegments: number;
  maxCreditWindowUnits: bigint;
  maxUnredeemedAmount: bigint;
  offerNonce: bigint;
  issuedAt: bigint;
  expiresAt: bigint;
}

// ─── SessionConfig ───────────────────────────────────────────────────

export const SESSION_CONFIG_TYPES = {
  SessionConfig: [
    { name: 'payer', type: 'address' },
    { name: 'sessionSigner', type: 'address' },
    { name: 'offerDigest', type: 'bytes32' },
    { name: 'initialDeposit', type: 'uint256' },
    { name: 'maxLeadUnits', type: 'uint64' },
    { name: 'validUntil', type: 'uint64' },
    { name: 'redemptionGraceSeconds', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export interface SessionConfig {
  payer: string;
  sessionSigner: string;
  offerDigest: string;
  initialDeposit: bigint;
  maxLeadUnits: bigint;
  validUntil: bigint;
  redemptionGraceSeconds: bigint;
  nonce: bigint;
}

// ─── Voucher ─────────────────────────────────────────────────────────

export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'cumulativeUnits', type: 'uint64' },
  ],
} as const;

export interface Voucher {
  sessionId: string;
  cumulativeUnits: bigint;
}

// ─── CloseAck ────────────────────────────────────────────────────────

export const CLOSE_ACK_TYPES = {
  CloseAck: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'cumulativeUnits', type: 'uint64' },
    { name: 'voucherDigest', type: 'bytes32' },
  ],
} as const;

export interface CloseAck {
  sessionId: string;
  cumulativeUnits: bigint;
  voucherDigest: string;
}

// ─── RequestClose ────────────────────────────────────────────────────

export const REQUEST_CLOSE_TYPES = {
  RequestClose: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

// ─── Segment Manifest ────────────────────────────────────────────────

export const SEGMENT_LEAF_TYPE_STRING =
  'StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)';

export interface SegmentManifestEntry {
  segmentIndex: number;
  durationUnits: number;
  costUSDC?: string;
  cumulativeUnits?: string;
  contentIdHash?: string;
  renditionIdHash?: string;
  segmentSha256: string;
  byteLength?: number;
  merkleProof: string[];
}

export interface SegmentManifest {
  schemaVersion: number;
  streamId?: string;
  title?: string;
  totalSegments?: number;
  totalDurationSec?: number;
  unitPriceUSDC?: string;
  unitPrice?: string;
  contentIdHash: string;
  manifestRoot: string;
  merkleRoot?: string;
  pricingPolicyHash: string;
  renditionIdHash: string;
  segments: SegmentManifestEntry[];
}

// ─── Session Status ──────────────────────────────────────────────────

export enum SessionStatus {
  NONE = 0,
  OPEN = 1,
  CLOSE_REQUESTED = 2,
  CLOSED = 3,
}

// ─── UI State Machine ────────────────────────────────────────────────

export enum AppState {
  NO_ACCOUNT = 'NO_ACCOUNT',
  ACCOUNT_READY = 'ACCOUNT_READY',
  AUTHENTICATOR_UNSUPPORTED = 'AUTHENTICATOR_UNSUPPORTED',
  INSUFFICIENT_TOKEN_BALANCE = 'INSUFFICIENT_TOKEN_BALANCE',
  SIGNING_SESSION = 'SIGNING_SESSION',
  OPEN_TX_PENDING = 'OPEN_TX_PENDING',
  OPEN = 'OPEN',
  PLAYBACK_REQUESTING_SEGMENT = 'PLAYBACK_REQUESTING_SEGMENT',
  PLAYBACK_ACTIVE = 'PLAYBACK_ACTIVE',
  VOUCHER_SIGNING = 'VOUCHER_SIGNING',
  VOUCHER_STORED_OFFCHAIN = 'VOUCHER_STORED_OFFCHAIN',
  CHECKPOINT_PENDING = 'CHECKPOINT_PENDING',
  CHECKPOINT_FAILED = 'CHECKPOINT_FAILED',
  CLOSE_COOPERATIVE_PENDING = 'CLOSE_COOPERATIVE_PENDING',
  CLOSE_REQUESTED = 'CLOSE_REQUESTED',
  CHALLENGE_WINDOW = 'CHALLENGE_WINDOW',
  FINALIZATION_PENDING = 'FINALIZATION_PENDING',
  CLOSED = 'CLOSED',
  EXPIRED_WAITING = 'EXPIRED_WAITING',
  REFUND_CREDITED = 'REFUND_CREDITED',
  REFUND_TRANSFERRED = 'REFUND_TRANSFERRED',
  RELAYER_UNAVAILABLE = 'RELAYER_UNAVAILABLE',
  ACCESS_SERVICE_UNAVAILABLE = 'ACCESS_SERVICE_UNAVAILABLE',
  WRONG_NETWORK = 'WRONG_NETWORK',
  CONTRACT_PAUSED = 'CONTRACT_PAUSED',
}

// ─── Constants ───────────────────────────────────────────────────────

export const PROTOCOL_CONSTANTS = {
  MIN_SESSION_VALIDITY: 600n, // 10 minutes
  MAX_SESSION_VALIDITY: 86400n, // 24 hours
  MIN_REDEMPTION_GRACE: 3600n, // 1 hour
  MAX_REDEMPTION_GRACE: 86400n, // 24 hours
  CHALLENGE_SECONDS: 900n, // 15 minutes
  MAX_LEAD_UNITS: 30n,
  MAX_BILLABLE_UNITS: 86430n,
  MAX_CREDIT_SEGMENTS: 5,
  MAX_CREDIT_UNITS: 20n,
} as const;

// ─── Network Config ──────────────────────────────────────────────────

export interface NetworkConfig {
  schemaVersion: number;
  network: string;
  chainId: number;
  rpcHttp: string;
  rpcWs?: string;
  explorers: string[];
  paymentToken: {
    symbol: string;
    address: string | null;
    expectedDecimals: number;
    source: string;
  };
  settlementContract: string | null;
  deploymentTxHash: string | null;
  deploymentBlock: number | null;
  abiVersion: string;
  eip712Name: string;
  eip712Version: string;
}

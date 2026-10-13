/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}

export function getStreamPayDomain(chainId: number, verifyingContract: `0x${string}`): EIP712Domain {
  return {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId,
    verifyingContract,
  };
}

export const EIP712_TYPES = {
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
  Voucher: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'cumulativeUnits', type: 'uint64' },
  ],
  CloseAck: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'cumulativeUnits', type: 'uint64' },
    { name: 'voucherDigest', type: 'bytes32' },
  ],
} as const;

export interface ContentOfferData {
  recipient: `0x${string}`;
  token: `0x${string}`;
  contentIdHash: `0x${string}`;
  pricingPolicyHash: `0x${string}`;
  unitPrice: bigint;
  maxBillableUnits: bigint;
  manifestRoot: `0x${string}`;
  maxCreditSegments: number;
  maxCreditWindowUnits: bigint;
  maxUnredeemedAmount: bigint;
  offerNonce: bigint;
  issuedAt: bigint;
  expiresAt: bigint;
}

export interface SessionConfigData {
  payer: `0x${string}`;
  sessionSigner: `0x${string}`;
  offerDigest: `0x${string}`;
  initialDeposit: bigint;
  maxLeadUnits: bigint;
  validUntil: bigint;
  redemptionGraceSeconds: bigint;
  nonce: bigint;
}

export interface VoucherData {
  sessionId: `0x${string}`;
  cumulativeUnits: bigint;
}

export interface CloseAckData {
  sessionId: `0x${string}`;
  cumulativeUnits: bigint;
  voucherDigest: `0x${string}`;
}

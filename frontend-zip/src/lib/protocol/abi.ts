/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const SETTLEMENT_ABI = [
  {
    type: 'function',
    name: 'paymentToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'CHALLENGE_SECONDS',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hashContentOffer',
    inputs: [
      {
        name: 'offer',
        type: 'tuple',
        components: [
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
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'hashSessionConfig',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'payer', type: 'address' },
          { name: 'sessionSigner', type: 'address' },
          { name: 'offerDigest', type: 'bytes32' },
          { name: 'initialDeposit', type: 'uint256' },
          { name: 'maxLeadUnits', type: 'uint64' },
          { name: 'validUntil', type: 'uint64' },
          { name: 'redemptionGraceSeconds', type: 'uint64' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'hashVoucher',
    inputs: [
      {
        name: 'voucher',
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'cumulativeUnits', type: 'uint64' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'hashCloseAck',
    inputs: [
      {
        name: 'ack',
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'cumulativeUnits', type: 'uint64' },
          { name: 'voucherDigest', type: 'bytes32' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'openWithSignature',
    inputs: [
      {
        name: 'offer',
        type: 'tuple',
        components: [
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
      },
      { name: 'offerSignature', type: 'bytes' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'payer', type: 'address' },
          { name: 'sessionSigner', type: 'address' },
          { name: 'offerDigest', type: 'bytes32' },
          { name: 'initialDeposit', type: 'uint256' },
          { name: 'maxLeadUnits', type: 'uint64' },
          { name: 'validUntil', type: 'uint64' },
          { name: 'redemptionGraceSeconds', type: 'uint64' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      { name: 'payerSignature', type: 'bytes' },
    ],
    outputs: [{ name: 'sessionId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'checkpoint',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      {
        name: 'voucher',
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'cumulativeUnits', type: 'uint64' },
        ],
      },
      { name: 'voucherSignature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'closeCooperative',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      {
        name: 'finalVoucher',
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'cumulativeUnits', type: 'uint64' },
        ],
      },
      { name: 'voucherSignature', type: 'bytes' },
      {
        name: 'ack',
        type: 'tuple',
        components: [
          { name: 'sessionId', type: 'bytes32' },
          { name: 'cumulativeUnits', type: 'uint64' },
          { name: 'voucherDigest', type: 'bytes32' },
        ],
      },
      { name: 'ackSignature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getSession',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'payer', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'sessionSigner', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'unitPrice', type: 'uint256' },
          { name: 'deposit', type: 'uint256' },
          { name: 'settledUnits', type: 'uint64' },
          { name: 'validUntil', type: 'uint64' },
          { name: 'state', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'requestClose',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'finalizeExpired',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [
      { name: 'token', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

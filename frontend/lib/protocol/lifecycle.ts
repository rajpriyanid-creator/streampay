/**
 * StreamPay v2.5 — real contract lifecycle helpers for the frontend.
 *
 * The functions here wrap viem wallet/public client calls that send REAL
 * transactions to the StreamPaySettlement contract (local Anvil or Monad testnet).
 *
 * Every function accepts explicit parameters so the caller (page.tsx) does not
 * need to import viem directly.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Settlement ABI (minimal) ──────────────────────────────────────
const openAbi = [
  {
    type: 'function',
    name: 'openWithSignature',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'offer', type: 'tuple',
        components: [
          { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' },
          { name: 'contentIdHash', type: 'bytes32' }, { name: 'pricingPolicyHash', type: 'bytes32' },
          { name: 'unitPrice', type: 'uint256' }, { name: 'maxBillableUnits', type: 'uint64' },
          { name: 'manifestRoot', type: 'bytes32' }, { name: 'maxCreditSegments', type: 'uint8' },
          { name: 'maxCreditWindowUnits', type: 'uint64' }, { name: 'maxUnredeemedAmount', type: 'uint256' },
          { name: 'offerNonce', type: 'uint256' }, { name: 'issuedAt', type: 'uint64' },
          { name: 'expiresAt', type: 'uint64' },
        ],
      },
      { name: 'offerSig', type: 'bytes' },
      {
        name: 'cfg', type: 'tuple',
        components: [
          { name: 'payer', type: 'address' }, { name: 'sessionSigner', type: 'address' },
          { name: 'offerDigest', type: 'bytes32' }, { name: 'initialDeposit', type: 'uint256' },
          { name: 'maxLeadUnits', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
          { name: 'redemptionGraceSeconds', type: 'uint64' }, { name: 'nonce', type: 'uint256' },
        ],
      },
      { name: 'cfgSig', type: 'bytes' },
    ],
    outputs: [{ name: 'sessionId', type: 'bytes32' }],
  },
] as const;

const checkpointAbi = [
  {
    type: 'function', name: 'checkpoint', stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'voucher', type: 'tuple', components: [
        { name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' },
      ]},
      { name: 'voucherSig', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const closeCooperativeAbi = [
  {
    type: 'function', name: 'closeCooperative', stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'voucher', type: 'tuple', components: [
        { name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' },
      ]},
      { name: 'voucherSig', type: 'bytes' },
      { name: 'ack', type: 'tuple', components: [
        { name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' },
        { name: 'voucherDigest', type: 'bytes32' },
      ]},
      { name: 'ackSig', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const hashOfferAbi = [
  { type: 'function', name: 'hashContentOffer', stateMutability: 'view',
    inputs: [{ name: 'offer', type: 'tuple', components: [
      { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' },
      { name: 'contentIdHash', type: 'bytes32' }, { name: 'pricingPolicyHash', type: 'bytes32' },
      { name: 'unitPrice', type: 'uint256' }, { name: 'maxBillableUnits', type: 'uint64' },
      { name: 'manifestRoot', type: 'bytes32' }, { name: 'maxCreditSegments', type: 'uint8' },
      { name: 'maxCreditWindowUnits', type: 'uint64' }, { name: 'maxUnredeemedAmount', type: 'uint256' },
      { name: 'offerNonce', type: 'uint256' }, { name: 'issuedAt', type: 'uint64' },
      { name: 'expiresAt', type: 'uint64' },
    ]}],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

const hashConfigAbi = [
  { type: 'function', name: 'hashSessionConfig', stateMutability: 'view',
    inputs: [{ name: 'cfg', type: 'tuple', components: [
      { name: 'payer', type: 'address' }, { name: 'sessionSigner', type: 'address' },
      { name: 'offerDigest', type: 'bytes32' }, { name: 'initialDeposit', type: 'uint256' },
      { name: 'maxLeadUnits', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
      { name: 'redemptionGraceSeconds', type: 'uint64' }, { name: 'nonce', type: 'uint256' },
    ]}],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

const hashVoucherAbi = [
  { type: 'function', name: 'hashVoucher', stateMutability: 'view',
    inputs: [{ name: 'v', type: 'tuple', components: [
      { name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' },
    ]}],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

const hashCloseAckAbi = [
  { type: 'function', name: 'hashCloseAck', stateMutability: 'view',
    inputs: [{ name: 'ack', type: 'tuple', components: [
      { name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' },
      { name: 'voucherDigest', type: 'bytes32' },
    ]}],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

const approveAbi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ─── helpers ─────────────────────────────────────────────────────
function pub(rpc: string) { return createPublicClient({ transport: http(rpc) }); }

function wallet(rpc: string, key: Hex) {
  return createWalletClient({ account: privateKeyToAccount(key), transport: http(rpc) });
}

// ─── openSession (real tx) ──────────────────────────────────────
export async function openSession(p: {
  rpc: string; settlement: Address; token: Address;
  creatorKey: Hex; payerKey: Hex; signerKey: Hex;
  recipient: Address; manifestRoot: Hex;
  unitPrice: bigint; maxBillable: bigint; deposit: bigint;
  validSec: number; graceSec: number; maxLead: bigint;
  maxCreditWindow: bigint; maxCreditSegments: number; maxUnredeemedAmount: bigint;
}) {
  const pc = pub(p.rpc);
  const payerWallet = wallet(p.rpc, p.payerKey);
  const payer = payerWallet.account.address;
  const creator = privateKeyToAccount(p.creatorKey);
  const signer = privateKeyToAccount(p.signerKey);
  const now = BigInt(Math.floor(Date.now() / 1000));

  // ensure allowance
  const allow = await pc.readContract({ address: p.token, abi: approveAbi, functionName: 'allowance', args: [payer, p.settlement] });
  if ((allow as bigint) < p.deposit) {
    const h = await payerWallet.writeContract({ address: p.token, abi: approveAbi, functionName: 'approve', args: [p.settlement, p.deposit * 10n], chain: null });
    await pc.waitForTransactionReceipt({ hash: h });
  }

  const offer = {
    recipient: p.recipient, token: p.token,
    contentIdHash: keccak256(Buffer.from('stream-content-monad-keynote-hd')),
    pricingPolicyHash: keccak256(Buffer.from('fixed-rate-0.01-usdc-per-unit')),
    unitPrice: p.unitPrice, maxBillableUnits: p.maxBillable,
    manifestRoot: p.manifestRoot, maxCreditSegments: p.maxCreditSegments,
    maxCreditWindowUnits: p.maxCreditWindow, maxUnredeemedAmount: p.maxUnredeemedAmount,
    offerNonce: now, issuedAt: now, expiresAt: now + 86400n,
  };

  const offerDigest = await pc.readContract({ address: p.settlement, abi: hashOfferAbi, functionName: 'hashContentOffer', args: [offer] }) as Hex;
  const offerSig = await creator.signMessage({ message: { raw: offerDigest } });

  const cfg = {
    payer, sessionSigner: signer.address,
    offerDigest, initialDeposit: p.deposit,
    maxLeadUnits: p.maxLead, validUntil: now + BigInt(p.validSec),
    redemptionGraceSeconds: BigInt(p.graceSec), nonce: now + 1n,
  };

  const cfgDigest = await pc.readContract({ address: p.settlement, abi: hashConfigAbi, functionName: 'hashSessionConfig', args: [cfg] }) as Hex;
  const cfgSig = await privateKeyToAccount(p.payerKey).signMessage({ message: { raw: cfgDigest } });

  const txHash = await payerWallet.writeContract({
    address: p.settlement, abi: openAbi, functionName: 'openWithSignature',
    args: [offer, offerSig, cfg, cfgSig], chain: null,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });

  const sessionId = keccak256(encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), [cfgDigest, offerDigest]));
  return { txHash, sessionId, receipt, signerAddress: signer.address as Address };
}

// ─── signVoucher ────────────────────────────────────────────────
export async function signVoucher(p: {
  rpc: string; settlement: Address; signerKey: Hex;
  sessionId: Hex; cumulativeUnits: bigint;
}): Promise<Hex> {
  const pc = pub(p.rpc);
  const account = privateKeyToAccount(p.signerKey);
  const digest = await pc.readContract({
    address: p.settlement, abi: hashVoucherAbi, functionName: 'hashVoucher',
    args: [{ sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }],
  }) as Hex;
  return account.signMessage({ message: { raw: digest } });
}

// ─── checkpoint ─────────────────────────────────────────────────
export async function checkpoint(p: {
  rpc: string; settlement: Address; anyKey: Hex;
  sessionId: Hex; cumulativeUnits: bigint; voucherSig: Hex;
}): Promise<Hex> {
  const w = wallet(p.rpc, p.anyKey);
  const pc = pub(p.rpc);
  const txHash = await w.writeContract({
    address: p.settlement, abi: checkpointAbi, functionName: 'checkpoint',
    args: [p.sessionId, { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }, p.voucherSig],
    chain: null,
  });
  await pc.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

// ─── closeCooperative ───────────────────────────────────────────
export async function closeCooperative(p: {
  rpc: string; settlement: Address; anyKey: Hex; creatorKey: Hex;
  sessionId: Hex; cumulativeUnits: bigint; voucherSig: Hex;
}): Promise<Hex> {
  const pc = pub(p.rpc);
  const voucherDigest = await pc.readContract({
    address: p.settlement, abi: hashVoucherAbi, functionName: 'hashVoucher',
    args: [{ sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }],
  }) as Hex;
  const ack = { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits, voucherDigest };
  const ackDigest = await pc.readContract({
    address: p.settlement, abi: hashCloseAckAbi, functionName: 'hashCloseAck', args: [ack],
  }) as Hex;
  const ackSig = await privateKeyToAccount(p.creatorKey).signMessage({ message: { raw: ackDigest } });

  const w = wallet(p.rpc, p.anyKey);
  const txHash = await w.writeContract({
    address: p.settlement, abi: closeCooperativeAbi, functionName: 'closeCooperative',
    args: [p.sessionId, { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }, p.voucherSig, ack, ackSig],
    chain: null,
  });
  await pc.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

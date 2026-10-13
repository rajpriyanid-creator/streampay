/**
 * StreamPay v2.5 — real contract lifecycle helpers for the frontend.
 *
 * The functions here wrap viem wallet/public client calls that send REAL
 * transactions to the StreamPaySettlement contract (local Anvil or Monad testnet).
 *
 * All digest signatures use raw hash signing (account.sign({ hash: digest }))
 * so that signatures match Solidity's _hashTypedDataV4 / SignatureChecker recovery.
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
import { CANONICAL_PRICING_POLICY_HASH } from './typedData';

// ─── Settlement ABI (exact matching Solidity) ─────────────────────
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
    outputs: [],
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

// ─── Helpers ─────────────────────────────────────────────────────
function pub(rpc: string) { return createPublicClient({ transport: http(rpc) }); }
function wallet(rpc: string, key: Hex) {
  return createWalletClient({ account: privateKeyToAccount(key), transport: http(rpc) });
}

// ─── openSession (real tx) ──────────────────────────────────────
export async function openSession(p: {
  rpc: string; settlement: Address; token: Address;
  creatorKey: Hex; payerKey: Hex; signerKey: Hex;
  recipient: Address; manifestRoot: Hex;
  contentIdHash?: Hex; pricingPolicyHash?: Hex;
  unitPrice: bigint; maxBillable: bigint; deposit: bigint;
  validSec: number; graceSec: number; maxLead: bigint;
  maxCreditWindow: bigint; maxCreditSegments: number; maxUnredeemedAmount: bigint;
  nonce?: bigint;
}) {
  const pc = pub(p.rpc);
  const payerWallet = wallet(p.rpc, p.payerKey);
  const payer = payerWallet.account.address;
  const creator = privateKeyToAccount(p.creatorKey);
  const signer = privateKeyToAccount(p.signerKey);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const nonce = p.nonce !== undefined ? p.nonce : BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  // Ensure ERC-20 allowance for settlement contract
  const allow = await pc.readContract({ address: p.token, abi: approveAbi, functionName: 'allowance', args: [payer, p.settlement] });
  if ((allow as bigint) < p.deposit) {
    const h = await payerWallet.writeContract({ address: p.token, abi: approveAbi, functionName: 'approve', args: [p.settlement, p.deposit * 10n], chain: null });
    await pc.waitForTransactionReceipt({ hash: h });
  }

  const offer = {
    recipient: p.recipient, token: p.token,
    contentIdHash: p.contentIdHash || keccak256(Buffer.from('stream-content-monad-keynote-hd')),
    pricingPolicyHash: p.pricingPolicyHash || CANONICAL_PRICING_POLICY_HASH,
    unitPrice: p.unitPrice, maxBillableUnits: p.maxBillable,
    manifestRoot: p.manifestRoot, maxCreditSegments: p.maxCreditSegments,
    maxCreditWindowUnits: p.maxCreditWindow, maxUnredeemedAmount: p.maxUnredeemedAmount,
    offerNonce: now, issuedAt: now, expiresAt: now + 86400n,
  };

  const offerDigest = await pc.readContract({ address: p.settlement, abi: hashOfferAbi, functionName: 'hashContentOffer', args: [offer] }) as Hex;
  const offerSig = await creator.sign({ hash: offerDigest });

  const cfg = {
    payer, sessionSigner: signer.address,
    offerDigest, initialDeposit: p.deposit,
    maxLeadUnits: p.maxLead, validUntil: now + BigInt(p.validSec),
    redemptionGraceSeconds: BigInt(p.graceSec), nonce,
  };

  const cfgDigest = await pc.readContract({ address: p.settlement, abi: hashConfigAbi, functionName: 'hashSessionConfig', args: [cfg] }) as Hex;
  const cfgSig = await privateKeyToAccount(p.payerKey).sign({ hash: cfgDigest });

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
  rpc?: string; settlement: Address; signerKey: Hex;
  sessionId: Hex; cumulativeUnits: bigint; chainId?: number;
}): Promise<Hex> {
  const account = privateKeyToAccount(p.signerKey);
  const domain = {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId: BigInt(p.chainId || 31337),
    verifyingContract: p.settlement,
  };
  const types = {
    Voucher: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'cumulativeUnits', type: 'uint64' },
    ],
  };
  return account.signTypedData({
    domain,
    types,
    primaryType: 'Voucher',
    message: {
      sessionId: p.sessionId,
      cumulativeUnits: p.cumulativeUnits,
    },
  });
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
  const ackSig = await privateKeyToAccount(p.creatorKey).sign({ hash: ackDigest });

  const w = wallet(p.rpc, p.anyKey);
  const txHash = await w.writeContract({
    address: p.settlement, abi: closeCooperativeAbi, functionName: 'closeCooperative',
    args: [p.sessionId, { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }, p.voucherSig, ack, ackSig],
    chain: null,
  });
  await pc.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

// ─── Wallet-Client Based Lifecycle Helpers (Testnet / Injected Wallet) ───

export const contentOfferTypes = {
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

export const sessionConfigTypes = {
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

export const closeAckTypes = {
  CloseAck: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'cumulativeUnits', type: 'uint64' },
    { name: 'voucherDigest', type: 'bytes32' },
  ],
} as const;

export async function assertWalletClientChainAndAccount(
  walletClient: any,
  expectedAccount: Address,
  expectedChainId?: number
): Promise<void> {
  if (!walletClient) return;
  if (expectedChainId !== undefined) {
    let clientChainId: number | undefined;
    if (typeof walletClient.getChainId === 'function') {
      try { clientChainId = Number(await walletClient.getChainId()); } catch {}
    } else if (walletClient.chain?.id) {
      clientChainId = Number(walletClient.chain.id);
    }
    if (clientChainId !== undefined && clientChainId !== expectedChainId) {
      throw new Error(`Wallet chain ID mismatch: connected wallet is on chain ${clientChainId}, but expected chain ID is ${expectedChainId}. Switch networks in your wallet.`);
    }
  }

  let activeAccount: string | undefined;
  if (typeof walletClient.getAddresses === 'function') {
    try {
      const addrs = await walletClient.getAddresses();
      if (addrs && addrs.length > 0) activeAccount = addrs[0];
    } catch {}
  }
  if (!activeAccount && walletClient.account?.address) {
    activeAccount = walletClient.account.address;
  }
  if (activeAccount && activeAccount.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new Error(`Wallet account mismatch: wallet is active on ${activeAccount}, but expected account is ${expectedAccount}. Switch accounts in your wallet.`);
  }
}

export async function signContentOfferWithWallet(p: {
  walletClient: any;
  settlement: Address;
  chainId: number;
  offer: any;
  account: Address;
}): Promise<Hex> {
  await assertWalletClientChainAndAccount(p.walletClient, p.account, p.chainId);
  const domain = {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId: BigInt(p.chainId),
    verifyingContract: p.settlement,
  };
  return await p.walletClient.signTypedData({
    account: p.account,
    domain,
    types: contentOfferTypes,
    primaryType: 'ContentOffer',
    message: p.offer,
  });
}

export async function signCloseAckWithWallet(p: {
  walletClient: any;
  settlement: Address;
  chainId: number;
  ack: { sessionId: Hex; cumulativeUnits: bigint; voucherDigest: Hex };
  account: Address;
}): Promise<Hex> {
  await assertWalletClientChainAndAccount(p.walletClient, p.account, p.chainId);
  const domain = {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId: BigInt(p.chainId),
    verifyingContract: p.settlement,
  };
  return await p.walletClient.signTypedData({
    account: p.account,
    domain,
    types: closeAckTypes,
    primaryType: 'CloseAck',
    message: p.ack,
  });
}

export function buildContentOffer(p: {
  recipient: Address;
  token: Address;
  contentIdHash?: Hex;
  pricingPolicyHash?: Hex;
  unitPrice: bigint;
  maxBillableUnits?: bigint;
  manifestRoot: Hex;
  maxCreditSegments?: number;
  maxCreditWindowUnits?: bigint;
  maxUnredeemedAmount?: bigint;
  offerNonce?: bigint;
  issuedAt?: bigint;
  expiresAt?: bigint;
}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    recipient: p.recipient,
    token: p.token,
    contentIdHash: p.contentIdHash || keccak256(Buffer.from('stream-content-monad-keynote-hd')),
    pricingPolicyHash: p.pricingPolicyHash || CANONICAL_PRICING_POLICY_HASH,
    unitPrice: p.unitPrice,
    maxBillableUnits: p.maxBillableUnits !== undefined ? p.maxBillableUnits : 3600n,
    manifestRoot: p.manifestRoot,
    maxCreditSegments: p.maxCreditSegments !== undefined ? p.maxCreditSegments : 3,
    maxCreditWindowUnits: p.maxCreditWindowUnits !== undefined ? p.maxCreditWindowUnits : 10n,
    maxUnredeemedAmount: p.maxUnredeemedAmount !== undefined ? p.maxUnredeemedAmount : p.unitPrice * 10n,
    offerNonce: p.offerNonce !== undefined ? p.offerNonce : now,
    issuedAt: p.issuedAt !== undefined ? p.issuedAt : now,
    expiresAt: p.expiresAt !== undefined ? p.expiresAt : now + 86400n,
  };
}

export async function openSessionWithWallet(p: {
  walletClient: any;
  publicClient: any;
  settlement: Address;
  token: Address;
  payer: Address;
  recipient: Address;
  signerAddress: Address;
  manifestRoot: Hex;
  contentIdHash?: Hex;
  pricingPolicyHash?: Hex;
  unitPrice: bigint;
  maxBillable: bigint;
  deposit: bigint;
  validSec: number;
  graceSec: number;
  maxLead: bigint;
  maxCreditWindow: bigint;
  maxCreditSegments: number;
  maxUnredeemedAmount: bigint;
  offer?: any;
  creatorKey?: Hex;
  offerSignature?: Hex;
  chainId: number;
  nonce?: bigint;
}) {
  const pc = p.publicClient;
  const payer = p.payer;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const nonce = p.nonce !== undefined ? p.nonce : BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  // 1. Contract constraints: payer cannot equal recipient or sessionSigner
  if (payer.toLowerCase() === p.recipient.toLowerCase()) {
    throw new Error('Contract constraint violation: payer cannot equal recipient (PayerEqualsRecipient)');
  }
  if (payer.toLowerCase() === p.signerAddress.toLowerCase()) {
    throw new Error('Contract constraint violation: payer cannot equal session signer (PayerEqualsSessionSigner)');
  }

  // 2. Validate injected wallet account and chain match expected parameters
  await assertWalletClientChainAndAccount(p.walletClient, payer, p.chainId);

  // 3. Security validation: creatorKey / private keys are STRICTLY FORBIDDEN on testnet and non-local chains
  if (p.chainId !== 31337 && p.creatorKey) {
    throw new Error(`SECURITY VIOLATION: creatorKey / private keys are strictly forbidden on non-local chain ${p.chainId}. Testnet requires wallet-signed offerSignature.`);
  }

  // 4. Ensure ERC-20 allowance via wallet
  const allow = (await pc.readContract({
    address: p.token,
    abi: approveAbi,
    functionName: 'allowance',
    args: [payer, p.settlement],
  })) as bigint;

  if (allow < p.deposit) {
    const approveTx = await p.walletClient.writeContract({
      address: p.token,
      abi: approveAbi,
      functionName: 'approve',
      args: [p.settlement, p.deposit * 10n],
      account: payer,
    });
    const approveReceipt = await pc.waitForTransactionReceipt({ hash: approveTx });
    if (approveReceipt.status !== 'success') {
      throw new Error(`ERC-20 token approval failed: ${approveTx}`);
    }
  }

  // 4. Prepare content offer
  const offer = p.offer || {
    recipient: p.recipient,
    token: p.token,
    contentIdHash: p.contentIdHash || keccak256(Buffer.from('stream-content-monad-keynote-hd')),
    pricingPolicyHash: p.pricingPolicyHash || CANONICAL_PRICING_POLICY_HASH,
    unitPrice: p.unitPrice,
    maxBillableUnits: p.maxBillable,
    manifestRoot: p.manifestRoot,
    maxCreditSegments: p.maxCreditSegments,
    maxCreditWindowUnits: p.maxCreditWindow,
    maxUnredeemedAmount: p.maxUnredeemedAmount,
    offerNonce: now,
    issuedAt: now,
    expiresAt: now + 86400n,
  };

  const domain = {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId: BigInt(p.chainId),
    verifyingContract: p.settlement,
  };

  const offerDigest = (await pc.readContract({
    address: p.settlement,
    abi: hashOfferAbi,
    functionName: 'hashContentOffer',
    args: [offer],
  })) as Hex;

  let offerSig: Hex;
  if (p.offerSignature) {
    offerSig = p.offerSignature;
  } else if (p.chainId === 31337 && p.creatorKey) {
    const creator = privateKeyToAccount(p.creatorKey);
    offerSig = await creator.signTypedData({
      domain,
      types: contentOfferTypes,
      primaryType: 'ContentOffer',
      message: offer,
    });
  } else {
    throw new Error('Creator signature (offerSignature) is required. On Testnet, creator must sign ContentOffer using their wallet.');
  }

  // 5. Prepare session config
  const cfg = {
    payer,
    sessionSigner: p.signerAddress,
    offerDigest,
    initialDeposit: p.deposit,
    maxLeadUnits: p.maxLead,
    validUntil: now + BigInt(p.validSec),
    redemptionGraceSeconds: BigInt(p.graceSec),
    nonce,
  };

  const cfgDigest = (await pc.readContract({
    address: p.settlement,
    abi: hashConfigAbi,
    functionName: 'hashSessionConfig',
    args: [cfg],
  })) as Hex;

  // 6. Wallet signs session config typed data
  const cfgSig = await p.walletClient.signTypedData({
    account: payer,
    domain,
    types: sessionConfigTypes,
    primaryType: 'SessionConfig',
    message: cfg,
  });

  // 7. Submit openWithSignature transaction
  const txHash = await p.walletClient.writeContract({
    address: p.settlement,
    abi: openAbi,
    functionName: 'openWithSignature',
    args: [offer, offerSig, cfg, cfgSig],
    account: payer,
  });

  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`openWithSignature transaction reverted on-chain: ${txHash}`);
  }

  const sessionId = keccak256(encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), [cfgDigest, offerDigest]));

  return { txHash, sessionId, receipt, signerAddress: p.signerAddress };
}

export async function checkpointWithWallet(p: {
  walletClient: any;
  publicClient: any;
  settlement: Address;
  sessionId: Hex;
  cumulativeUnits: bigint;
  voucherSig: Hex;
  account: Address;
  chainId?: number;
}): Promise<{ txHash: Hex; receipt: any }> {
  await assertWalletClientChainAndAccount(p.walletClient, p.account, p.chainId);
  const txHash = await p.walletClient.writeContract({
    address: p.settlement,
    abi: checkpointAbi,
    functionName: 'checkpoint',
    args: [p.sessionId, { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }, p.voucherSig],
    account: p.account,
  });
  const receipt = await p.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Checkpoint transaction reverted on-chain: ${txHash}`);
  }
  return { txHash, receipt };
}

export async function closeCooperativeWithWallet(p: {
  walletClient: any;
  publicClient: any;
  settlement: Address;
  sessionId: Hex;
  cumulativeUnits: bigint;
  voucherSig: Hex;
  creatorKey?: Hex;
  ackSig?: Hex;
  chainId: number;
  account: Address;
}): Promise<{ txHash: Hex; receipt: any }> {
  await assertWalletClientChainAndAccount(p.walletClient, p.account, p.chainId);

  // Security validation: creatorKey forbidden outside local dev
  if (p.chainId !== 31337 && p.creatorKey) {
    throw new Error(`SECURITY VIOLATION: creatorKey / private keys are strictly forbidden on non-local chain ${p.chainId}. Testnet requires wallet-signed ackSig.`);
  }

  const pc = p.publicClient;
  const voucherDigest = (await pc.readContract({
    address: p.settlement,
    abi: hashVoucherAbi,
    functionName: 'hashVoucher',
    args: [{ sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }],
  })) as Hex;
  const ack = { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits, voucherDigest };

  let finalAckSig: Hex;
  if (p.ackSig) {
    finalAckSig = p.ackSig;
  } else if (p.chainId === 31337 && p.creatorKey) {
    const domain = {
      name: 'StreamPaySettlement',
      version: '2.5',
      chainId: BigInt(p.chainId),
      verifyingContract: p.settlement,
    };
    const creator = privateKeyToAccount(p.creatorKey);
    finalAckSig = await creator.signTypedData({
      domain,
      types: closeAckTypes,
      primaryType: 'CloseAck',
      message: ack,
    });
  } else {
    throw new Error('Creator authorization signature (ackSig) is required for cooperative close. On Testnet, creator must sign CloseAck using their wallet.');
  }

  const txHash = await p.walletClient.writeContract({
    address: p.settlement,
    abi: closeCooperativeAbi,
    functionName: 'closeCooperative',
    args: [p.sessionId, { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }, p.voucherSig, ack, finalAckSig],
    account: p.account,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`closeCooperative transaction reverted on-chain: ${txHash}`);
  }
  return { txHash, receipt };
}

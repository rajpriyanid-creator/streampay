import { createPublicClient, http, type Hex, type Address } from 'viem';
import { config, readManifestPaymentToken } from './config';

export const SESSION_STATUS = { NONE: 0, OPEN: 1, CLOSE_REQUESTED: 2, CLOSED: 3 } as const;

const sessionComponents = [
  ['payer', 'address'], ['sessionSigner', 'address'], ['recipient', 'address'],
  ['offerDigest', 'bytes32'], ['contentIdHash', 'bytes32'], ['pricingPolicyHash', 'bytes32'],
  ['manifestRoot', 'bytes32'], ['initialDeposit', 'uint256'], ['unitPrice', 'uint256'],
  ['maxUnredeemedAmount', 'uint256'], ['settledAmount', 'uint256'], ['settledUnits', 'uint64'],
  ['maxBillableUnits', 'uint64'], ['maxCreditWindowUnits', 'uint64'], ['maxLeadUnits', 'uint64'],
  ['openedAt', 'uint64'], ['validUntil', 'uint64'], ['offerExpiresAt', 'uint64'],
  ['redemptionGraceSeconds', 'uint64'], ['redemptionDeadline', 'uint64'],
  ['closeRequestedAt', 'uint64'], ['challengeEndsAt', 'uint64'],
  ['maxCreditSegments', 'uint8'], ['status', 'uint8'],
].map(([name, type]) => ({ name, type }));

export const settlementAbi = [
  {
    type: 'function',
    name: 'getSession',
    stateMutability: 'view',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'tuple', components: sessionComponents }],
  },
  {
    type: 'function',
    name: 'paymentToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'CHALLENGE_SECONDS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
] as const;

export interface OnChainSession {
  payer: Hex;
  sessionSigner: Hex;
  recipient: Hex;
  offerDigest: Hex;
  contentIdHash: Hex;
  pricingPolicyHash: Hex;
  manifestRoot: Hex;
  initialDeposit: bigint;
  unitPrice: bigint;
  maxUnredeemedAmount: bigint;
  settledAmount: bigint;
  settledUnits: bigint;
  maxBillableUnits: bigint;
  maxCreditWindowUnits: bigint;
  maxLeadUnits: bigint;
  openedAt: bigint;
  validUntil: bigint;
  offerExpiresAt: bigint;
  redemptionGraceSeconds: bigint;
  redemptionDeadline: bigint;
  closeRequestedAt: bigint;
  challengeEndsAt: bigint;
  maxCreditSegments: number;
  status: number;
}

export const publicClient = createPublicClient({
  transport: http(config.rpcUrl, { timeout: 3000, retryCount: 1 }),
});

let chainId = 0;
export function getChainId() { return chainId; }

export async function initChain(): Promise<number> {
  const isLocal = config.NETWORK === 'local';

  if (!config.settlementAddress) {
    throw new Error('SETTLEMENT_ADDRESS is not configured');
  }

  chainId = await publicClient.getChainId();

  if (!isLocal) {
    const expectedChain = config.NETWORK === 'testnet' ? 10143 : 143;
    if (chainId !== expectedChain) {
      throw new Error(`CRITICAL: Chain ID mismatch for ${config.NETWORK}. Expected ${expectedChain}, got ${chainId}`);
    }
  }

  const code = await publicClient.getCode({ address: config.settlementAddress });
  if (!code || code === '0x') {
    throw new Error(`No contract bytecode found at SETTLEMENT_ADDRESS ${config.settlementAddress} on chain ${chainId}`);
  }

  // 1. Verify paymentToken() getter
  const paymentToken = (await publicClient.readContract({
    address: config.settlementAddress,
    abi: settlementAbi,
    functionName: 'paymentToken',
  })) as Address;

  if (!paymentToken || paymentToken === '0x0000000000000000000000000000000000000000') {
    throw new Error('Settlement contract returned zero paymentToken address');
  }

  // 2. Verify payment token bytecode
  const tokenCode = await publicClient.getCode({ address: paymentToken });
  if (!tokenCode || tokenCode === '0x') {
    throw new Error(`Payment token ${paymentToken} has no deployed bytecode on chain ${chainId}`);
  }

  // 3. Match against manifest expected payment token if configured
  const manifestToken = readManifestPaymentToken();
  if (manifestToken?.address && paymentToken.toLowerCase() !== manifestToken.address.toLowerCase()) {
    throw new Error(`Payment token mismatch: contract has ${paymentToken}, manifest expects ${manifestToken.address}`);
  }

  // 4. Verify token decimals
  try {
    const decimals = (await publicClient.readContract({
      address: paymentToken,
      abi: [{
        type: 'function',
        name: 'decimals',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint8' }],
      }],
      functionName: 'decimals',
    })) as number;

    const expectedDecimals = manifestToken?.expectedDecimals ?? 6;
    if (decimals !== expectedDecimals) {
      throw new Error(`Payment token decimals mismatch: got ${decimals}, expected ${expectedDecimals}`);
    }
  } catch (err: any) {
    throw new Error(`Payment token validation failed: ${err.message}`);
  }

  // 5. Verify StreamPay settlement contract specific constant
  try {
    const challengeSec = (await publicClient.readContract({
      address: config.settlementAddress,
      abi: settlementAbi,
      functionName: 'CHALLENGE_SECONDS',
    })) as bigint;

    if (challengeSec !== 900n) {
      throw new Error(`Settlement CHALLENGE_SECONDS mismatch: expected 900, got ${challengeSec}`);
    }
  } catch (err: any) {
    throw new Error(`Contract at ${config.settlementAddress} is not a valid StreamPaySettlement: ${err.message}`);
  }

  return chainId;
}

const cache = new Map<string, { at: number; value: OnChainSession }>();
const CACHE_MS = 1500;

export async function readSession(sessionId: Hex): Promise<OnChainSession | null> {
  if (!config.settlementAddress) return null;
  const key = sessionId.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const value = (await publicClient.readContract({
      address: config.settlementAddress,
      abi: settlementAbi,
      functionName: 'getSession',
      args: [sessionId],
    })) as unknown as OnChainSession;
    if (value && value.status !== SESSION_STATUS.NONE) {
      if (cache.size > 5000) cache.clear();
      cache.set(key, { at: Date.now(), value });
    }
    return value;
  } catch (err) {
    console.error(`Failed reading session ${sessionId} from contract:`, err);
    return null;
  }
}

export async function checkSessionState(
  sessionId: Hex,
  expectedSigner: Hex
): Promise<{ valid: boolean; reason?: string; session?: OnChainSession }> {
  const session = await readSession(sessionId);
  if (!session || session.status === SESSION_STATUS.NONE) {
    return { valid: false, reason: `Session ${sessionId} not found on chain` };
  }
  if (session.status !== SESSION_STATUS.OPEN) {
    return { valid: false, reason: `Session status is ${session.status}, expected OPEN (1)`, session };
  }
  if (session.sessionSigner.toLowerCase() !== expectedSigner.toLowerCase()) {
    return {
      valid: false,
      reason: `Session signer mismatch: on-chain ${session.sessionSigner} vs provided ${expectedSigner}`,
      session,
    };
  }
  return { valid: true, session };
}

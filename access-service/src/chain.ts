import { createPublicClient, http, type Hex } from 'viem';
import { config } from './config';

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
] as const;

export interface OnChainSession {
  payer: Hex; sessionSigner: Hex; recipient: Hex; manifestRoot: Hex;
  initialDeposit: bigint; unitPrice: bigint; maxUnredeemedAmount: bigint;
  settledUnits: bigint; maxBillableUnits: bigint; maxLeadUnits: bigint;
  openedAt: bigint; validUntil: bigint; status: number;
}

export const publicClient = createPublicClient({ transport: http(config.rpcUrl) });

let chainId = 0;
export function getChainId() { return chainId; }

export async function initChain() {
  if (!config.settlementAddress) return 0;
  chainId = await publicClient.getChainId();
  const code = await publicClient.getCode({ address: config.settlementAddress });
  if (!code || code === '0x') {
    throw new Error(`No contract code at SETTLEMENT_ADDRESS ${config.settlementAddress} on chain ${chainId}`);
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

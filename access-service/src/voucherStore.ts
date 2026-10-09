import { verifyTypedData, type Hex } from 'viem';

// EIP-712 Voucher Type Definition matching StreamPaySettlement.sol v2.5
export const VOUCHER_TYPE = {
  Voucher: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'cumulativeUnits', type: 'uint64' },
  ],
} as const;

export interface Voucher {
  sessionId: Hex;
  cumulativeUnits: bigint;
  signature: Hex;
}

export interface StoredSessionVoucher {
  sessionId: Hex;
  sessionSigner: Hex;
  recipient: Hex;
  contractAddress: Hex;
  chainId: number;
  highestCumulativeUnits: bigint;
  lastVoucher: Voucher;
  lastUpdated: number;
  totalServedSegments: number;
}

// In-memory store for active streaming vouchers by sessionId
const voucherStore = new Map<string, StoredSessionVoucher>();

/**
 * Verifies EIP-712 Voucher signature against expected sessionSigner (or payer) address.
 */
export async function verifyVoucherSignature(
  voucher: Voucher,
  signerAddress: Hex,
  contractAddress: Hex,
  chainId: number
): Promise<boolean> {
  const domain = {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId: BigInt(chainId),
    verifyingContract: contractAddress,
  } as const;

  try {
    const valid = await verifyTypedData({
      address: signerAddress,
      domain,
      types: VOUCHER_TYPE,
      primaryType: 'Voucher',
      message: {
        sessionId: voucher.sessionId,
        cumulativeUnits: voucher.cumulativeUnits,
      },
      signature: voucher.signature,
    });
    return valid;
  } catch (err) {
    console.error('Voucher signature verification failed:', err);
    return false;
  }
}

/**
 * Records and updates voucher state for a given session.
 * Guarantees monotonic cumulativeUnits increments.
 */
export function updateSessionVoucher(
  sessionId: Hex,
  sessionSigner: Hex,
  recipient: Hex,
  contractAddress: Hex,
  chainId: number,
  voucher: Voucher
): { success: boolean; reason?: string } {
  const existing = voucherStore.get(sessionId.toLowerCase());

  if (existing) {
    if (voucher.cumulativeUnits <= existing.highestCumulativeUnits) {
      return {
        success: false,
        reason: `Cumulative units non-monotonic: ${voucher.cumulativeUnits} <= existing ${existing.highestCumulativeUnits}`,
      };
    }

    existing.highestCumulativeUnits = voucher.cumulativeUnits;
    existing.lastVoucher = voucher;
    existing.lastUpdated = Date.now();
    existing.totalServedSegments += 1;
  } else {
    voucherStore.set(sessionId.toLowerCase(), {
      sessionId,
      sessionSigner,
      recipient,
      contractAddress,
      chainId,
      highestCumulativeUnits: voucher.cumulativeUnits,
      lastVoucher: voucher,
      lastUpdated: Date.now(),
      totalServedSegments: 1,
    });
  }

  return { success: true };
}

/**
 * Gets the latest recorded voucher for a session.
 */
export function getLatestVoucher(sessionId: Hex): StoredSessionVoucher | undefined {
  return voucherStore.get(sessionId.toLowerCase());
}

/**
 * Returns all active session voucher states.
 */
export function getAllVouchers(): StoredSessionVoucher[] {
  return Array.from(voucherStore.values());
}


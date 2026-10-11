import { verifyTypedData, type Hex } from 'viem';
import { saveAllDurableState, syncFromDisk } from './durableStore';

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
  deliveredCumulativeUnits: bigint;
  lastVoucher: Voucher;
  lastDeliveredVoucher?: Voucher;
  lastUpdated: number;
  totalServedSegments: number;
}

// In-memory store for active streaming session vouchers
const voucherStore = new Map<string, StoredSessionVoucher>();
export const voucherStoreMap = voucherStore;

/**
 * Verifies EIP-712 Voucher signature against expected sessionSigner.
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
 * Binds immutable session identity (signer, recipient, contractAddress, chainId).
 * Enforces monotonic cumulativeUnits increments, while permitting idempotent retries
 * for vouchers whose segments have not yet been successfully delivered.
 */
export function updateSessionVoucher(
  sessionId: Hex,
  sessionSigner: Hex,
  recipient: Hex,
  contractAddress: Hex,
  chainId: number,
  voucher: Voucher
): { success: boolean; reason?: string; isRetry?: boolean } {
  syncFromDisk();
  const key = sessionId.toLowerCase();
  const existing = voucherStore.get(key);

  // Cross-session sanity check
  if (voucher.sessionId.toLowerCase() !== key) {
    return {
      success: false,
      reason: `Voucher sessionId mismatch: ${voucher.sessionId} !== expected ${sessionId}`,
    };
  }

  if (existing) {
    // Immutable identity binding checks
    if (existing.sessionSigner.toLowerCase() !== sessionSigner.toLowerCase()) {
      return { success: false, reason: 'Session signer mismatch' };
    }
    if (existing.recipient.toLowerCase() !== recipient.toLowerCase()) {
      return { success: false, reason: 'Recipient mismatch' };
    }
    if (existing.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) {
      return { success: false, reason: 'Contract address mismatch' };
    }
    if (existing.chainId !== chainId) {
      return { success: false, reason: 'Chain ID mismatch' };
    }

    // Monotonicity / Retry check
    if (voucher.cumulativeUnits < existing.highestCumulativeUnits) {
      return {
        success: false,
        reason: `Cumulative units non-monotonic: ${voucher.cumulativeUnits} < existing ${existing.highestCumulativeUnits}`,
      };
    }

    if (voucher.cumulativeUnits === existing.highestCumulativeUnits) {
      // If this cumulative level has already been delivered, reject duplicate billing
      if (existing.deliveredCumulativeUnits >= voucher.cumulativeUnits) {
        return {
          success: false,
          reason: `Cumulative units ${voucher.cumulativeUnits} already delivered. Duplicate request rejected.`,
        };
      }

      // Segment was reserved previously but NOT delivered (e.g. failed/expired token).
      // Permit safe retry with the same voucher.
      existing.lastVoucher = voucher;
      existing.lastUpdated = Date.now();
      saveAllDurableState();
      return { success: true, isRetry: true };
    }

    // New higher cumulative units for subsequent segment
    existing.highestCumulativeUnits = voucher.cumulativeUnits;
    existing.lastVoucher = voucher;
    existing.lastUpdated = Date.now();
  } else {
    voucherStore.set(key, {
      sessionId,
      sessionSigner,
      recipient,
      contractAddress,
      chainId,
      highestCumulativeUnits: voucher.cumulativeUnits,
      deliveredCumulativeUnits: 0n,
      lastVoucher: voucher,
      lastUpdated: Date.now(),
      totalServedSegments: 0,
    });
  }

  saveAllDurableState();
  return { success: true };
}

/**
 * Marks voucher delivery as completed upon successful HTTP content delivery.
 */
export function markVoucherDelivered(sessionId: Hex, voucher: Voucher): void {
  syncFromDisk();
  const key = sessionId.toLowerCase();
  const existing = voucherStore.get(key);
  if (!existing || voucher.sessionId.toLowerCase() !== key) return;
  // The reservation supplies the exact voucher that was delivered. Never copy
  // existing.lastVoucher: a newer concurrent request may have replaced it.
  if (voucher.cumulativeUnits < existing.deliveredCumulativeUnits) return;
  if (voucher.cumulativeUnits === existing.deliveredCumulativeUnits &&
      existing.lastDeliveredVoucher?.signature.toLowerCase() === voucher.signature.toLowerCase()) return;
  existing.deliveredCumulativeUnits = voucher.cumulativeUnits;
  existing.lastDeliveredVoucher = { ...voucher };
  existing.totalServedSegments += 1;
  existing.lastUpdated = Date.now();
  saveAllDurableState();
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

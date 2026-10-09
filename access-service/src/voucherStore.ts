import { verifyTypedData, keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem';

// EIP-712 Voucher Type Definition
export const VOUCHER_TYPE = {
  PaymentVoucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'voucherNonce', type: 'uint64' },
    { name: 'cumulativeAmount', type: 'uint256' },
    { name: 'segmentIndex', type: 'uint32' },
    { name: 'manifestHash', type: 'bytes32' },
  ],
} as const;

export interface Voucher {
  channelId: Hex;
  voucherNonce: bigint;
  cumulativeAmount: bigint;
  segmentIndex: number;
  manifestHash: Hex;
  signature: Hex;
}

export interface StoredChannelVoucher {
  channelId: Hex;
  payer: Hex;
  merchant: Hex;
  contractAddress: Hex;
  chainId: number;
  highestNonce: bigint;
  highestCumulativeAmount: bigint;
  lastVoucher: Voucher;
  lastUpdated: number;
  totalServedSegments: number;
}

// In-memory store for active streaming vouchers
const voucherStore = new Map<string, StoredChannelVoucher>();

/**
 * Verifies EIP-712 Voucher signature against expected payer address.
 */
export async function verifyVoucherSignature(
  voucher: Voucher,
  payerAddress: Hex,
  contractAddress: Hex,
  chainId: number
): Promise<boolean> {
  const domain = {
    name: 'StreamPaySettlement',
    version: '1',
    chainId: BigInt(chainId),
    verifyingContract: contractAddress,
  } as const;

  try {
    const valid = await verifyTypedData({
      address: payerAddress,
      domain,
      types: VOUCHER_TYPE,
      primaryType: 'PaymentVoucher',
      message: {
        channelId: voucher.channelId,
        voucherNonce: voucher.voucherNonce,
        cumulativeAmount: voucher.cumulativeAmount,
        segmentIndex: voucher.segmentIndex,
        manifestHash: voucher.manifestHash,
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
 * Records and updates voucher state for a given channel.
 * Guarantees monotonic nonce & cumulative amount increments.
 */
export function updateChannelVoucher(
  channelId: Hex,
  payer: Hex,
  merchant: Hex,
  contractAddress: Hex,
  chainId: number,
  voucher: Voucher
): { success: boolean; reason?: string } {
  const existing = voucherStore.get(channelId.toLowerCase());

  if (existing) {
    if (voucher.voucherNonce <= existing.highestNonce) {
      return {
        success: false,
        reason: `Stale or replay nonce: ${voucher.voucherNonce} <= existing ${existing.highestNonce}`,
      };
    }

    if (voucher.cumulativeAmount < existing.highestCumulativeAmount) {
      return {
        success: false,
        reason: `Cumulative amount non-monotonic: ${voucher.cumulativeAmount} < existing ${existing.highestCumulativeAmount}`,
      };
    }

    existing.highestNonce = voucher.voucherNonce;
    existing.highestCumulativeAmount = voucher.cumulativeAmount;
    existing.lastVoucher = voucher;
    existing.lastUpdated = Date.now();
    existing.totalServedSegments += 1;
  } else {
    voucherStore.set(channelId.toLowerCase(), {
      channelId,
      payer,
      merchant,
      contractAddress,
      chainId,
      highestNonce: voucher.voucherNonce,
      highestCumulativeAmount: voucher.cumulativeAmount,
      lastVoucher: voucher,
      lastUpdated: Date.now(),
      totalServedSegments: 1,
    });
  }

  return { success: true };
}

/**
 * Gets the latest recorded voucher for a channel.
 */
export function getLatestVoucher(channelId: Hex): StoredChannelVoucher | undefined {
  return voucherStore.get(channelId.toLowerCase());
}

/**
 * Returns all active channel voucher states.
 */
export function getAllVouchers(): StoredChannelVoucher[] {
  return Array.from(voucherStore.values());
}

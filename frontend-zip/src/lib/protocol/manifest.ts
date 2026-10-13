/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { encodeAbiParameters, encodePacked, keccak256, concat, parseAbiParameters, stringToHex } from 'viem';

const SEGMENT_LEAF_TYPEHASH = keccak256(stringToHex('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)'));

export interface SegmentManifest {
  segmentIndex: number;
  durationUnits: number;
  costUSDC: string;
  cumulativeUnits: string;
  contentIdHash: `0x${string}`;
  renditionIdHash: `0x${string}`;
  segmentSha256: `0x${string}`;
  byteLength: number;
  merkleProof: `0x${string}`[];
}

export interface StreamManifest {
  schemaVersion: number;
  streamId: string;
  title: string;
  totalSegments: number;
  totalDurationSec: number;
  unitPriceUSDC: string;
  unitPrice: string;
  contentIdHash: `0x${string}`;
  pricingPolicyHash: `0x${string}`;
  renditionIdHash: `0x${string}`;
  manifestRoot: `0x${string}`;
  merkleRoot: `0x${string}`;
  segments: SegmentManifest[];
}

/**
 * Computes the Merkle leaf for a video segment according to StreamPay specification.
 * Leaf = keccak256(encodePacked(uint32, uint64, bytes32, bytes32, bytes32))
 */
export function computeSegmentLeaf(segment: SegmentManifest): `0x${string}` {
  return keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
    [SEGMENT_LEAF_TYPEHASH, 1, segment.contentIdHash, segment.segmentIndex, segment.durationUnits, segment.renditionIdHash, segment.segmentSha256]
  ));
}

/**
 * Verifies a Merkle proof against a root using standard commutative sorted-pair hashing.
 */
export function verifyMerkleProof(
  leaf: `0x${string}`,
  proof: `0x${string}`[],
  root: `0x${string}`
): boolean {
  let currentHash = leaf;

  for (const element of proof) {
    if (!element) continue;
    // Commutative sorted order
    if (currentHash.toLowerCase() <= element.toLowerCase()) {
      currentHash = keccak256(concat([currentHash, element]));
    } else {
      currentHash = keccak256(concat([element, currentHash]));
    }
  }

  return currentHash.toLowerCase() === root.toLowerCase();
}

/**
 * Computes SHA-256 hash of binary data (ArrayBuffer or Uint8Array) and returns 0x-prefixed hex string.
 */
export async function computeSha256(data: ArrayBuffer | Uint8Array): Promise<`0x${string}`> {
  let buffer: ArrayBuffer;
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    buffer = copy.buffer;
  } else {
    buffer = data;
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

/**
 * Verifies that downloaded binary bytes match the manifest segmentSha256 and Merkle proof.
 */
export async function verifySegmentIntegrity(
  segmentData: ArrayBuffer | Uint8Array,
  segment: SegmentManifest,
  expectedRoot: `0x${string}`
): Promise<{
  sha256Valid: boolean;
  computedSha256: `0x${string}`;
  merkleValid: boolean;
  leaf: `0x${string}`;
}> {
  const computedSha256 = await computeSha256(segmentData);
  const sha256Valid = computedSha256.toLowerCase() === segment.segmentSha256.toLowerCase();

  const leaf = computeSegmentLeaf(segment);
  const merkleValid = verifyMerkleProof(leaf, segment.merkleProof, expectedRoot);

  if (!sha256Valid) {
    throw new Error(`Segment SHA-256 mismatch: expected ${segment.segmentSha256}, got ${computedSha256}`);
  }
  if (!merkleValid) {
    throw new Error('Segment Merkle proof verification failed');
  }

  return {
    sha256Valid,
    computedSha256,
    merkleValid,
    leaf,
  };
}

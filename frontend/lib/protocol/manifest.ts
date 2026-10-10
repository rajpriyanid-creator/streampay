/**
 * StreamPay Unified Merkle Manifest Verification & Leaf Encoding
 * Standardized Keccak-256 Merkle tree calculation matching Solidity contract & protocol spec.
 */
import { keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem';

export const SEGMENT_LEAF_TYPEHASH: Hex = keccak256(
  Buffer.from('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)')
);

/**
 * Canonical segment leaf computation matching StreamPaySegmentLeaf struct.
 */
export function computeSegmentLeaf(params: {
  schemaVersion?: number;
  contentIdHash: Hex;
  segmentIndex: number;
  durationUnits: number;
  renditionIdHash?: Hex;
  segmentSha256: Hex;
}): Hex {
  const schemaVersion = params.schemaVersion ?? 1;
  const renditionIdHash = params.renditionIdHash ?? ('0x' + '00'.repeat(32) as Hex);

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
      [
        SEGMENT_LEAF_TYPEHASH,
        schemaVersion,
        params.contentIdHash,
        params.segmentIndex,
        params.durationUnits,
        renditionIdHash,
        params.segmentSha256,
      ]
    )
  );
}

/**
 * Hash segment bytes with SHA-256 (for manifest verification).
 */
export async function hashSegmentBytes(bytes: Uint8Array): Promise<Hex> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}` as Hex;
}

/**
 * Hash two Merkle nodes in sorted lexicographical order.
 */
export function hashPair(a: Hex, b: Hex): Hex {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = a.toLowerCase() < b.toLowerCase() ? b : a;
  return keccak256((`${left}${right.slice(2)}`) as Hex);
}

/**
 * Verify a Merkle proof against a root hash.
 */
export function verifyMerkleProof(
  leaf: Hex,
  proof: Hex[],
  root: Hex
): boolean {
  let computedHash = leaf;
  for (const sibling of proof) {
    computedHash = hashPair(computedHash, sibling);
  }
  return computedHash.toLowerCase() === root.toLowerCase();
}

/**
 * Build a deterministic Merkle tree from leaves with duplicate-last odd node pairing.
 */
export function buildMerkleTree(leaves: Hex[]): {
  root: Hex;
  layers: Hex[][];
  proofs: Hex[][];
} {
  if (leaves.length === 0) {
    return {
      root: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      layers: [[]],
      proofs: [],
    };
  }

  if (leaves.length === 1) {
    return { root: leaves[0], layers: [[leaves[0]]], proofs: [[]] };
  }

  const proofs: Hex[][] = leaves.map(() => []);
  let currentLevel = [...leaves];
  let leafIndices = leaves.map((_, i) => [i]);
  const layers: Hex[][] = [currentLevel];

  while (currentLevel.length > 1) {
    const nextLevel: Hex[] = [];
    const nextIndices: number[][] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const hash = hashPair(currentLevel[i], currentLevel[i + 1]);
        nextLevel.push(hash);

        for (const idx of leafIndices[i]) {
          proofs[idx].push(currentLevel[i + 1]);
        }
        for (const idx of leafIndices[i + 1]) {
          proofs[idx].push(currentLevel[i]);
        }

        nextIndices.push([...leafIndices[i], ...leafIndices[i + 1]]);
      } else {
        const hash = hashPair(currentLevel[i], currentLevel[i]);
        nextLevel.push(hash);

        for (const idx of leafIndices[i]) {
          proofs[idx].push(currentLevel[i]);
        }

        nextIndices.push([...leafIndices[i]]);
      }
    }

    layers.push(nextLevel);
    currentLevel = nextLevel;
    leafIndices = nextIndices;
  }

  return { root: currentLevel[0], layers, proofs };
}

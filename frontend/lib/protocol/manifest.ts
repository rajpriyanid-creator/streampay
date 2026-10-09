/**
 * StreamPay Manifest Verification
 * Deterministic leaf encoding, Merkle proof verification using Keccak-256.
 */
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';

const SEGMENT_LEAF_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)'
  )
);

/**
 * Compute the leaf hash for a segment.
 */
export function computeSegmentLeaf(params: {
  schemaVersion: number;
  contentIdHash: `0x${string}`;
  segmentIndex: number;
  durationUnits: number;
  renditionIdHash: `0x${string}`;
  segmentSha256: `0x${string}`;
}): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
    [
      SEGMENT_LEAF_TYPEHASH,
      params.schemaVersion,
      params.contentIdHash,
      params.segmentIndex,
      params.durationUnits,
      params.renditionIdHash,
      params.segmentSha256,
    ]
  );
  return keccak256(encoded);
}

/**
 * Hash two nodes in sorted order (OpenZeppelin Merkle tree convention).
 */
export function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  // Sort lexicographically
  const [left, right] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256((`${left}${right.slice(2)}`) as `0x${string}`);
}

/**
 * Verify a Merkle proof for a leaf against a root.
 */
export function verifyMerkleProof(
  leaf: `0x${string}`,
  proof: `0x${string}`[],
  root: `0x${string}`
): boolean {
  let computedHash = leaf;
  for (const sibling of proof) {
    computedHash = hashPair(computedHash, sibling);
  }
  return computedHash.toLowerCase() === root.toLowerCase();
}

/**
 * Build a Merkle tree from leaves and return root + proofs.
 */
export function buildMerkleTree(leaves: `0x${string}`[]): {
  root: `0x${string}`;
  proofs: `0x${string}`[][];
} {
  if (leaves.length === 0) {
    return { root: '0x0000000000000000000000000000000000000000000000000000000000000000', proofs: [] };
  }

  if (leaves.length === 1) {
    return { root: leaves[0], proofs: [[]] };
  }

  // Store proofs for each leaf
  const proofs: `0x${string}`[][] = leaves.map(() => []);

  // Track which original leaf index maps to which current index
  let currentLevel = [...leaves];
  let leafIndices = leaves.map((_, i) => [i]);

  while (currentLevel.length > 1) {
    const nextLevel: `0x${string}`[] = [];
    const nextIndices: number[][] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Pair exists
        const hash = hashPair(currentLevel[i], currentLevel[i + 1]);
        nextLevel.push(hash);

        // Add sibling to proofs
        for (const idx of leafIndices[i]) {
          proofs[idx].push(currentLevel[i + 1]);
        }
        for (const idx of leafIndices[i + 1]) {
          proofs[idx].push(currentLevel[i]);
        }

        nextIndices.push([...leafIndices[i], ...leafIndices[i + 1]]);
      } else {
        // Odd node - duplicate
        const hash = hashPair(currentLevel[i], currentLevel[i]);
        nextLevel.push(hash);

        for (const idx of leafIndices[i]) {
          proofs[idx].push(currentLevel[i]);
        }

        nextIndices.push([...leafIndices[i]]);
      }
    }

    currentLevel = nextLevel;
    leafIndices = nextIndices;
  }

  return { root: currentLevel[0], proofs };
}

/**
 * Hash segment bytes with SHA-256 (for manifest verification).
 */
export async function hashSegmentBytes(bytes: Uint8Array): Promise<`0x${string}`> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}` as `0x${string}`;
}

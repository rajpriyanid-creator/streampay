import crypto from 'crypto';
import { keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem';

export const UNITS_PER_SEGMENT = 2n;
export const SEGMENT_DURATION_SEC = 2;
export const SEGMENT_COUNT = 20;
export const UNIT_PRICE = 500n; // 0.0005 USDC per unit (6 decimals). 1 unit = 1 second.

export const SEGMENT_LEAF_TYPEHASH: Hex = keccak256(
  Buffer.from('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)')
);

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

export function hashPair(a: Hex, b: Hex): Hex {
  const [l, r] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(`${l}${r.slice(2)}` as Hex);
}

export function buildMerkleTree(leaves: Hex[]): Hex[][] {
  if (leaves.length === 0) return [[]];
  let cur = [...leaves];
  const layers: Hex[][] = [cur];
  while (cur.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(hashPair(cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
    }
    layers.push(next);
    cur = next;
  }
  return layers;
}

export function getMerkleProof(streamId: string, index: number): Hex[] {
  const manifest = getManifest(streamId);
  const layers = manifest.treeLayers as Hex[][];
  const proof: Hex[] = [];
  let idx = index;
  for (let i = 0; i < layers.length - 1; i++) {
    const pair = idx % 2 === 1 ? idx - 1 : idx + 1;
    proof.push(pair < layers[i].length ? layers[i][pair] : layers[i][idx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyMerkleProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}

const manifestStore = new Map<string, any>();

/**
 * Generate deterministic segment content bytes for demo/testing.
 * Each segment is a unique reproducible payload.
 */
function generateSegmentBytes(streamId: string, segmentIndex: number): Buffer {
  // Deterministic pseudo-real segment content (188-byte TS packets)
  const packetCount = 7; // 7 × 188 = 1316 bytes per segment
  const buf = Buffer.alloc(packetCount * 188);
  for (let p = 0; p < packetCount; p++) {
    buf[p * 188] = 0x47; // TS sync byte
    // Fill with deterministic data based on stream/segment/packet
    const seed = crypto.createHash('sha256')
      .update(`${streamId}-segment-${segmentIndex}-packet-${p}`)
      .digest();
    seed.copy(buf, p * 188 + 1, 0, Math.min(seed.length, 187));
  }
  return buf;
}

/**
 * Compute real SHA-256 of segment bytes (NOT keccak256 of a label).
 */
function computeSegmentSha256(bytes: Buffer): Hex {
  const hash = crypto.createHash('sha256').update(bytes).digest();
  return `0x${hash.toString('hex')}` as Hex;
}

// Pre-generated segment bytes storage
const segmentBytesStore = new Map<string, Buffer>();

export function getSegmentBytes(streamId: string, segmentIndex: number): Buffer {
  const key = `${streamId}:${segmentIndex}`;
  if (!segmentBytesStore.has(key)) {
    segmentBytesStore.set(key, generateSegmentBytes(streamId, segmentIndex));
  }
  return segmentBytesStore.get(key)!;
}

export function createDemoManifest(streamId: string) {
  const segments = [];
  let cum = 0n;
  const contentIdHash = keccak256(Buffer.from(`stream-content-${streamId}`));

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    cum += UNITS_PER_SEGMENT;
    // Generate actual segment bytes and compute real SHA-256
    const segBytes = getSegmentBytes(streamId, i);
    const segmentSha256 = computeSegmentSha256(segBytes);

    segments.push({
      index: i,
      durationUnits: SEGMENT_DURATION_SEC,
      costUSDC: (UNITS_PER_SEGMENT * UNIT_PRICE).toString(),
      cumulativeUnits: cum.toString(),
      contentHash: contentIdHash,
      segmentSha256,
      byteLength: segBytes.length,
    });
  }

  const leaves = segments.map((s) =>
    computeSegmentLeaf({
      contentIdHash,
      segmentIndex: s.index,
      durationUnits: s.durationUnits,
      segmentSha256: s.segmentSha256 as Hex,
    })
  );

  const treeLayers = buildMerkleTree(leaves);
  return {
    streamId,
    title: 'Monad StreamPay HD Demo Video',
    totalSegments: segments.length,
    totalDurationSec: segments.length * SEGMENT_DURATION_SEC,
    unitPriceUSDC: '0.0005',
    unitPrice: UNIT_PRICE.toString(),
    merkleRoot: treeLayers[treeLayers.length - 1][0],
    segments,
    treeLayers,
  };
}

export function getManifest(streamId: string) {
  const key = streamId || 'monad-keynote-hd';
  // Only create manifests for allowed streams
  const allowed = getStreamIdList();
  if (!allowed.includes(key)) {
    throw new Error(`Stream '${key}' is not in the allowlist`);
  }
  if (!manifestStore.has(key)) {
    manifestStore.set(key, createDemoManifest(key));
  }
  return manifestStore.get(key)!;
}

export function getSegment(streamId: string, index: number) {
  const manifest = getManifest(streamId);
  return manifest.segments[index] || null;
}

export function getStreamIdList(): string[] {
  return ['monad-keynote-hd', 'demo-stream'];
}

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem';
import { config } from './config';

export const UNITS_PER_SEGMENT = 5n;
export const SEGMENT_DURATION_SEC = 5;
export const UNIT_PRICE = 500n; // Existing canonical demo streams: 0.0005 USDC per unit.
export const REAL_DEMO_UNIT_PRICE = 100n; // Real-video demo: 0.0001 USDC per unit.

export const SEGMENT_LEAF_TYPEHASH: Hex = keccak256(
  Buffer.from('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)')
);

export const CANONICAL_PRICING_POLICY_STRING = 'fixed-rate-0.0005-usdc-per-second-unit';
export const CANONICAL_PRICING_POLICY_HASH: Hex = '0x76422f1e290b9f7982658421843336df3a5b54190454061ecfa6748f5987c500';
export const REAL_DEMO_PRICING_POLICY_HASH: Hex = '0xa1260b9017cc00b80f61903c15d8521c2732b58901a984429a5fb6b174e48f64';

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

export function getMerkleProof(layersOrStreamId: Hex[][] | string, index: number): Hex[] {
  let layers: Hex[][];
  if (typeof layersOrStreamId === 'string') {
    const manifest = getManifest(layersOrStreamId);
    layers = manifest.treeLayers as Hex[][];
  } else {
    layers = layersOrStreamId;
  }

  const proof: Hex[] = [];
  let idx = index;
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    let siblingIdx = idx % 2 === 1 ? idx - 1 : (idx + 1 < layer.length ? idx + 1 : idx);
    proof.push(layer[siblingIdx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyMerkleProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}

/**
 * Compute real SHA-256 of segment bytes.
 */
export function computeSegmentSha256(bytes: Buffer): Hex {
  const hash = crypto.createHash('sha256').update(bytes).digest();
  return `0x${hash.toString('hex')}` as Hex;
}

// Memory cache for segment buffers
const segmentBytesStore = new Map<string, Buffer>();

export function getSegmentFilePath(streamId: string, segmentIndex: number): string {
  const candidatePaths = [
    path.join(__dirname, '../media', streamId, `segment_${segmentIndex}.mp4`),
    path.join(__dirname, '../media', streamId, `segment_${segmentIndex}.ts`),
    path.join(__dirname, '../../fixtures/media', `segment_${segmentIndex}.mp4`),
    path.join(__dirname, '../../fixtures/media', `segment_${segmentIndex}.ts`),
    path.join(process.cwd(), 'media', streamId, `segment_${segmentIndex}.mp4`),
    path.join(process.cwd(), 'media', streamId, `segment_${segmentIndex}.ts`),
    path.join(process.cwd(), 'fixtures/media', `segment_${segmentIndex}.mp4`),
    path.join(process.cwd(), 'fixtures/media', `segment_${segmentIndex}.ts`),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(`Segment file segment_${segmentIndex}.mp4 or .ts not found on disk for stream ${streamId}`);
}

function loadSegmentBytesFromDisk(streamId: string, segmentIndex: number): Buffer {
  return fs.readFileSync(getSegmentFilePath(streamId, segmentIndex));
}

export function getSegmentBytes(streamId: string, segmentIndex: number): Buffer {
  const key = `${streamId}:${segmentIndex}`;
  if (!segmentBytesStore.has(key)) {
    segmentBytesStore.set(key, loadSegmentBytesFromDisk(streamId, segmentIndex));
  }
  return segmentBytesStore.get(key)!;
}

const manifestStore = new Map<string, any>();

export function createCanonicalManifest(streamId: string) {
  const contentIdHash = keccak256(Buffer.from(`stream-content-${streamId}`));
  const unitPrice = streamId === 'real-demo' ? REAL_DEMO_UNIT_PRICE : UNIT_PRICE;
  const pricingPolicyHash = streamId === 'real-demo' ? REAL_DEMO_PRICING_POLICY_HASH : CANONICAL_PRICING_POLICY_HASH;
  const zeroHash = ('0x' + '00'.repeat(32)) as Hex;

  // Scan disk to discover available segment files
  const candidateDirs = [
    path.join(__dirname, '../media', streamId),
    path.join(__dirname, '../../fixtures/media'),
    path.join(process.cwd(), 'media', streamId),
    path.join(process.cwd(), 'fixtures/media'),
  ];

  let mediaDir = '';
  for (const d of candidateDirs) {
    if (fs.existsSync(d)) {
      mediaDir = d;
      break;
    }
  }

  let segmentCount = 5;
  if (mediaDir) {
    const files = fs.readdirSync(mediaDir).filter(f => /^segment_\d+\.(?:ts|mp4)$/i.test(f));
    const segmentIndexes = new Set(files.map((file) => Number(file.match(/^segment_(\d+)\./i)?.[1])).filter(Number.isInteger));
    if (segmentIndexes.size > 0) segmentCount = segmentIndexes.size;
  }

  const rawSegments = [];
  let cum = 0n;

  for (let i = 0; i < segmentCount; i++) {
    cum += UNITS_PER_SEGMENT;
    const segBytes = getSegmentBytes(streamId, i);
    const segmentSha256 = computeSegmentSha256(segBytes);

    rawSegments.push({
      segmentIndex: i,
      durationUnits: SEGMENT_DURATION_SEC,
      costUSDC: (UNITS_PER_SEGMENT * unitPrice).toString(),
      cumulativeUnits: cum.toString(),
      contentIdHash,
      renditionIdHash: zeroHash,
      segmentSha256,
      byteLength: segBytes.length,
    });
  }

  const leaves = rawSegments.map((s) =>
    computeSegmentLeaf({
      contentIdHash,
      segmentIndex: s.segmentIndex,
      durationUnits: s.durationUnits,
      renditionIdHash: zeroHash,
      segmentSha256: s.segmentSha256,
    })
  );

  const treeLayers = buildMerkleTree(leaves);
  const manifestRoot = treeLayers[treeLayers.length - 1][0];

  const segments = rawSegments.map((s) => ({
    ...s,
    merkleProof: getMerkleProof(treeLayers, s.segmentIndex),
  }));

  return {
    schemaVersion: 1,
    streamId,
    title: streamId === 'real-demo' ? 'Real Video Test — RuralFlowAI' : 'Monad StreamPay HD Demo Video',
    totalSegments: segments.length,
    totalDurationSec: segments.length * SEGMENT_DURATION_SEC,
    unitPriceUSDC: streamId === 'real-demo' ? '0.0001' : '0.0005',
    unitPrice: unitPrice.toString(),
    contentIdHash,
    pricingPolicyHash,
    renditionIdHash: zeroHash,
    manifestRoot,
    merkleRoot: manifestRoot,
    segments,
    treeLayers,
  };
}

export function getManifest(streamId: string) {
  const key = streamId || 'monad-keynote-hd';
  const allowed = getStreamIdList();
  if (!allowed.includes(key)) {
    throw new Error(`Stream '${key}' is not in the allowlist`);
  }
  if (!manifestStore.has(key)) {
    manifestStore.set(key, createCanonicalManifest(key));
  }
  return manifestStore.get(key)!;
}

export function getSegment(streamId: string, index: number) {
  const manifest = getManifest(streamId);
  return manifest.segments[index] || null;
}

export function getStreamIdList(): string[] {
  return config.streamIds.filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
}

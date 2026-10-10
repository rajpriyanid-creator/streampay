import { keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem';

export const UNITS_PER_SEGMENT = 2n;
export const SEGMENT_DURATION_SEC = 2;
export const SEGMENT_COUNT = 20;
export const UNIT_PRICE = 10_000n; // 0.01 USDC per unit (6 decimals)

export function segmentLeaf(index: number, contentHash: Hex, cumulativeUnits: bigint): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('uint32, bytes32, uint64'), [index, contentHash, cumulativeUnits])
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

export function createDemoManifest(streamId: string) {
  const segments = [];
  let cum = 0n;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    cum += UNITS_PER_SEGMENT;
    segments.push({
      index: i,
      durationUnits: SEGMENT_DURATION_SEC,
      costUSDC: (UNITS_PER_SEGMENT * UNIT_PRICE).toString(),
      cumulativeUnits: cum.toString(),
      contentHash: keccak256(Buffer.from(`streampay-segment-content-${streamId}-${i}`)),
    });
  }
  const leaves = segments.map((s) => segmentLeaf(s.index, s.contentHash as Hex, BigInt(s.cumulativeUnits)));
  const treeLayers = buildMerkleTree(leaves);
  return {
    streamId,
    title: 'Monad StreamPay HD Demo Video',
    totalSegments: segments.length,
    totalDurationSec: segments.length * SEGMENT_DURATION_SEC,
    unitPriceUSDC: '0.01',
    unitPrice: UNIT_PRICE.toString(),
    merkleRoot: treeLayers[treeLayers.length - 1][0],
    segments,
    treeLayers,
  };
}

export function getManifest(streamId: string) {
  const key = streamId || 'demo-stream';
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

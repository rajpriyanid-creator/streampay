/**
 * StreamPay Unified Merkle Manifest Generator Utility
 * Generates sample segment manifests with deterministic Keccak-256 Merkle trees matching StreamPaySegmentLeaf struct.
 */
const { keccak256, encodeAbiParameters, parseAbiParameters } = require('viem');
const fs = require('fs');
const path = require('path');

const SEGMENT_LEAF_TYPEHASH = keccak256(
  Buffer.from('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)')
);

function hashPair(a, b) {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = a.toLowerCase() < b.toLowerCase() ? b : a;
  return keccak256(`${left}${right.slice(2)}`);
}

function generateManifest(streamId, segmentCount, unitsPerSegment) {
  const segments = [];
  let cumulativeUnits = 0n;
  const UNITS_PER_SEG = BigInt(unitsPerSegment);
  const contentIdHash = keccak256(Buffer.from(`stream-content-${streamId}`));
  const zeroRendition = '0x' + '00'.repeat(32);

  for (let i = 0; i < segmentCount; i++) {
    cumulativeUnits += UNITS_PER_SEG;
    const segmentSha256 = keccak256(Buffer.from(`segment-bytes-${streamId}-${i}`));
    segments.push({
      index: i,
      durationUnits: Number(UNITS_PER_SEG),
      costUSDC: (UNITS_PER_SEG * 10000n).toString(), // 0.01 USDC per unit
      cumulativeUnits: cumulativeUnits.toString(),
      contentIdHash,
      segmentSha256,
    });
  }

  // Canonical StreamPaySegmentLeaf calculation matching contract specification
  const leaves = segments.map((s) =>
    keccak256(
      encodeAbiParameters(
        parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
        [
          SEGMENT_LEAF_TYPEHASH,
          1,
          s.contentIdHash,
          s.index,
          s.durationUnits,
          zeroRendition,
          s.segmentSha256,
        ]
      )
    )
  );

  let currentLayer = [...leaves];
  const treeLayers = [currentLayer];

  while (currentLayer.length > 1) {
    const nextLayer = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        nextLayer.push(hashPair(currentLayer[i], currentLayer[i + 1]));
      } else {
        nextLayer.push(hashPair(currentLayer[i], currentLayer[i]));
      }
    }
    treeLayers.push(nextLayer);
    currentLayer = nextLayer;
  }

  const merkleRoot = treeLayers[treeLayers.length - 1][0];

  return {
    streamId,
    title: `StreamPay Stream ${streamId}`,
    totalSegments: segmentCount,
    totalDurationSec: segmentCount * Number(UNITS_PER_SEG),
    unitPriceUSDC: '0.01',
    merkleRoot,
    segments,
  };
}

const manifest = generateManifest('monad-keynote-hd', 20, 2);
const outPath = path.join(__dirname, '../manifests/demo_stream.json');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log(`✅ Generated manifest written to ${outPath}`);
console.log(`Merkle Root: ${manifest.merkleRoot}`);

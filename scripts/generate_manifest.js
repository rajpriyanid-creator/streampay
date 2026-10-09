/**
 * StreamPay Unified Merkle Manifest Generator Utility
 * Generates sample segment manifests with deterministic Keccak-256 Merkle trees.
 */
const { keccak256, encodeAbiParameters, parseAbiParameters } = require('viem');
const fs = require('fs');
const path = require('path');

function hashPair(a, b) {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = a.toLowerCase() < b.toLowerCase() ? b : a;
  return keccak256(`${left}${right.slice(2)}`);
}

function generateManifest(streamId, segmentCount, unitsPerSegment) {
  const segments = [];
  let cumulativeUnits = 0n;
  const UNITS_PER_SEG = BigInt(unitsPerSegment);

  for (let i = 0; i < segmentCount; i++) {
    cumulativeUnits += UNITS_PER_SEG;
    const contentHash = keccak256(
      Buffer.from(`streampay-segment-content-${streamId}-${i}`)
    );
    segments.push({
      index: i,
      durationUnits: Number(UNITS_PER_SEG),
      costUSDC: (UNITS_PER_SEG * 10000n).toString(), // 0.01 USDC per unit
      cumulativeUnits: cumulativeUnits.toString(),
      contentHash,
    });
  }

  // Leaf calculation matching contract leaf format exactly
  const leaves = segments.map((s) =>
    keccak256(
      encodeAbiParameters(
        parseAbiParameters('uint32, bytes32, uint64'),
        [s.index, s.contentHash, BigInt(s.cumulativeUnits)]
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

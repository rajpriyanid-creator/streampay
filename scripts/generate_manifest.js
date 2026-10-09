/**
 * StreamPay Merkle Manifest Generator Utility
 * Generates sample segment manifests with deterministic Keccak-256 Merkle trees.
 */
const { keccak256, encodeAbiParameters, parseAbiParameters } = require('viem');
const fs = require('fs');
const path = require('path');

function generateManifest(streamId, segmentCount, costPerSegmentUSDC) {
  const segments = [];
  let cumulativeCost = 0n;
  const costUnits = BigInt(Math.floor(costPerSegmentUSDC * 1_000_000));

  for (let i = 0; i < segmentCount; i++) {
    cumulativeCost += costUnits;
    const contentHash = keccak256(
      Buffer.from(`streampay-segment-content-${streamId}-${i}`)
    );
    segments.push({
      index: i,
      durationSec: 2,
      costUSDC: costUnits.toString(),
      cumulativeCost: cumulativeCost.toString(),
      contentHash,
    });
  }

  // Leaf calculation matching contract leaf format exactly
  const leaves = segments.map((s) =>
    keccak256(
      encodeAbiParameters(
        parseAbiParameters('uint32, bytes32, uint256'),
        [s.index, s.contentHash, BigInt(s.cumulativeCost)]
      )
    )
  );

  let currentLayer = [...leaves];
  const treeLayers = [currentLayer];

  while (currentLayer.length > 1) {
    const nextLayer = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        const combined =
          currentLayer[i] < currentLayer[i + 1]
            ? currentLayer[i] + currentLayer[i + 1].slice(2)
            : currentLayer[i + 1] + currentLayer[i].slice(2);
        nextLayer.push(keccak256(combined));
      } else {
        nextLayer.push(currentLayer[i]);
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
    totalDurationSec: segmentCount * 2,
    pricePerSegmentUSDC: costPerSegmentUSDC.toString(),
    merkleRoot,
    segments,
  };
}

const manifest = generateManifest('monad-keynote-hd', 20, 0.01);
const outPath = path.join(__dirname, '../manifests/demo_stream.json');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log(`✅ Generated manifest written to ${outPath}`);
console.log(`Merkle Root: ${manifest.merkleRoot}`);

/**
 * StreamPay Unified Merkle Manifest Generator Utility
 * Generates canonical segment manifests from real media fixtures with
 * deterministic Keccak-256 Merkle trees matching the canonical StreamPaySegmentLeaf struct.
 *
 * Segment hashes use real SHA-256 of the exact bytes served.
 * Unit price: 500 base units (0.0005 USDC per second/unit).
 */
const crypto = require('crypto');
const { keccak256, encodeAbiParameters, parseAbiParameters } = require('viem');
const fs = require('fs');
const path = require('path');

const SEGMENT_LEAF_TYPEHASH = keccak256(
  Buffer.from('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)')
);

const UNIT_PRICE = 500n; // 0.0005 USDC per unit (6 decimals). 1 unit = 1 second.
const DURATION_UNITS = 2; // 2 seconds per segment

function hashPair(a, b) {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = a.toLowerCase() < b.toLowerCase() ? b : a;
  return keccak256(`${left}${right.slice(2)}`);
}

function buildMerkleTree(leaves) {
  if (leaves.length === 0) return [[]];
  let cur = [...leaves];
  const layers = [cur];
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(hashPair(cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
    }
    layers.push(next);
    cur = next;
  }
  return layers;
}

function getMerkleProof(layers, index) {
  const proof = [];
  let idx = index;
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    let siblingIdx = idx % 2 === 1 ? idx - 1 : (idx + 1 < layer.length ? idx + 1 : idx);
    proof.push(layer[siblingIdx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

function computeSegmentSha256(bytes) {
  const hash = crypto.createHash('sha256').update(bytes).digest();
  return `0x${hash.toString('hex')}`;
}

function loadFixtureMediaSegments(streamId) {
  const candidateDirs = [
    path.join(__dirname, '../access-service/media', streamId),
    path.join(__dirname, '../fixtures/media'),
  ];
  let mediaDir = '';
  for (const d of candidateDirs) {
    if (fs.existsSync(d)) {
      mediaDir = d;
      break;
    }
  }
  if (!mediaDir) {
    throw new Error(`Media directory not found for stream ${streamId}`);
  }
  const files = fs.readdirSync(mediaDir)
    .filter(f => /^segment_\d+\.ts$/i.test(f))
    .sort((a, b) => {
      const idxA = parseInt(a.match(/\d+/)[0], 10);
      const idxB = parseInt(b.match(/\d+/)[0], 10);
      return idxA - idxB;
    });

  return files.map((filename, i) => {
    const buf = fs.readFileSync(path.join(mediaDir, filename));
    return {
      index: i,
      filename,
      bytes: buf,
      sha256: computeSegmentSha256(buf),
    };
  });
}

function generateManifest(streamId) {
  const rawSegments = loadFixtureMediaSegments(streamId);
  const contentIdHash = keccak256(Buffer.from(`stream-content-${streamId}`));
  const zeroHash = '0x' + '00'.repeat(32);
  let cumulativeUnits = 0n;

  // 1. Compute leaves
  const leaves = rawSegments.map((s) => {
    return keccak256(
      encodeAbiParameters(
        parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
        [
          SEGMENT_LEAF_TYPEHASH,
          1,
          contentIdHash,
          s.index,
          DURATION_UNITS,
          zeroHash,
          s.sha256,
        ]
      )
    );
  });

  // 2. Build Merkle tree & root
  const treeLayers = buildMerkleTree(leaves);
  const manifestRoot = treeLayers[treeLayers.length - 1][0];

  // 3. Assemble canonical segment entries with explicit proofs
  const segments = rawSegments.map((s) => {
    cumulativeUnits += BigInt(DURATION_UNITS);
    const proof = getMerkleProof(treeLayers, s.index);
    return {
      segmentIndex: s.index,
      durationUnits: DURATION_UNITS,
      costUSDC: (BigInt(DURATION_UNITS) * UNIT_PRICE).toString(),
      cumulativeUnits: cumulativeUnits.toString(),
      contentIdHash,
      renditionIdHash: zeroHash,
      segmentSha256: s.sha256,
      byteLength: s.bytes.length,
      merkleProof: proof,
    };
  });

  return {
    schemaVersion: 1,
    streamId,
    title: `StreamPay Stream ${streamId}`,
    totalSegments: segments.length,
    totalDurationSec: segments.length * DURATION_UNITS,
    unitPriceUSDC: '0.0005',
    unitPrice: UNIT_PRICE.toString(),
    contentIdHash,
    pricingPolicyHash: zeroHash,
    renditionIdHash: zeroHash,
    manifestRoot,
    merkleRoot: manifestRoot,
    segments,
  };
}

const manifest = generateManifest('monad-keynote-hd');
const outPath = path.join(__dirname, '../manifests/demo_stream.json');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log(`✅ Generated canonical manifest written to ${outPath}`);
console.log(`Manifest Root: ${manifest.manifestRoot}`);
console.log(`Unit Price: ${manifest.unitPriceUSDC} USDC/unit (${UNIT_PRICE} base units)`);
console.log(`Segments: ${manifest.totalSegments} (real HLS fixture bytes)`);

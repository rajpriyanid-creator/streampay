#!/usr/bin/env node
/**
 * StreamPay e2e test suite.
 * Tests HTTP endpoints, manifest schemas, cryptographic Merkle proofs,
 * segment gating, token consumption, and rate limiting.
 *
 * Usage: node scripts/e2e/e2e.mjs
 */

import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';

const BASE = process.env.ACCESS_URL || 'http://localhost:4001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
let pass = 0, fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) { assert(a === b, `${msg || ''}: expected ${b}, got ${a}`); }

async function json(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function post(path, data) {
  return json(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function hashPair(a, b) {
  const [l, r] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(`${l}${r.slice(2)}`);
}

function verifyMerkleProof(leaf, proof, root) {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}

const SEGMENT_LEAF_TYPEHASH = keccak256(
  Buffer.from('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)')
);

let activeSettlement = process.env.SETTLEMENT_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

// ─── Tests ─────────────────────────────────────────────────────────
console.log('\n🧪 StreamPay e2e test suite\n');

// Health
await test('GET /health returns ok + chainId and updates activeSettlement', async () => {
  const { status, body } = await json(`${BASE}/health`);
  assertEq(status, 200, 'status');
  assertEq(body.status, 'ok');
  assert(typeof body.chainId === 'number', 'chainId is number');
  assert(body.settlement, 'settlement present');
  activeSettlement = body.settlement;
});

// Canonical Manifest Schema & Proofs
await test('GET /api/manifest/:streamId returns canonical schema with proofs', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/monad-keynote-hd`);
  assertEq(status, 200, 'status');
  assertEq(body.schemaVersion, 1, 'schemaVersion');
  assert(body.manifestRoot, 'manifestRoot');
  assert(body.merkleRoot, 'merkleRoot');
  assert(body.contentIdHash, 'contentIdHash');
  assert(body.totalSegments >= 5, 'segments count');
  assert(!body.treeLayers, 'treeLayers should be omitted from public response');
  assert(Array.isArray(body.segments), 'segments is array');

  // Verify first segment canonical structure
  const s0 = body.segments[0];
  assertEq(s0.segmentIndex, 0, 'segmentIndex');
  assertEq(s0.durationUnits, 2, 'durationUnits');
  assert(s0.segmentSha256, 'segmentSha256');
  assert(Array.isArray(s0.merkleProof), 'merkleProof is array');
  assert(s0.merkleProof.length > 0, 'merkleProof not empty');
});

await test('GET /api/manifest/unknown returns 404 with UNKNOWN_STREAM code', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/no-such-stream`);
  assertEq(status, 404, 'status');
  assertEq(body.code, 'UNKNOWN_STREAM', 'error code');
});

// Cryptographic Proof Verification Success
await test('Cryptographic Merkle proof validation succeeds for valid segment', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/monad-keynote-hd`);
  assertEq(status, 200, 'status');
  const s0 = body.segments[0];
  const zeroHash = '0x' + '00'.repeat(32);

  const leaf = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
      [
        SEGMENT_LEAF_TYPEHASH,
        1,
        body.contentIdHash,
        s0.segmentIndex,
        s0.durationUnits,
        zeroHash,
        s0.segmentSha256,
      ]
    )
  );

  const valid = verifyMerkleProof(leaf, s0.merkleProof, body.manifestRoot);
  assert(valid === true, 'Merkle proof must verify against manifest root');
});

// Cryptographic Proof Rejection for Tampered / Corrupted Content
await test('Cryptographic Merkle proof validation fails for invalid/tampered content hash', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/monad-keynote-hd`);
  assertEq(status, 200, 'status');
  const s0 = body.segments[0];
  const zeroHash = '0x' + '00'.repeat(32);

  // Tampered SHA-256
  const badHash = '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0';
  const badLeaf = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
      [
        SEGMENT_LEAF_TYPEHASH,
        1,
        body.contentIdHash,
        s0.segmentIndex,
        s0.durationUnits,
        zeroHash,
        badHash,
      ]
    )
  );

  const valid = verifyMerkleProof(badLeaf, s0.merkleProof, body.manifestRoot);
  assert(valid === false, 'Tampered leaf must fail verification');
});

// Proof endpoint
await test('GET proof endpoint for segment 0', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/monad-keynote-hd/segment/0/proof`);
  assertEq(status, 200, 'status');
  assert(Array.isArray(body.proof), 'proof array');
  assert(body.manifestRoot || body.merkleRoot, 'root');
});

await test('GET proof for out-of-range segment returns 404', async () => {
  const { status } = await json(`${BASE}/api/manifest/monad-keynote-hd/segment/999/proof`);
  assertEq(status, 404, 'status');
});

// Segment gate – bad inputs & validation
await test('POST /api/access/segment with missing body returns 400', async () => {
  const { status, body } = await post('/api/access/segment', {});
  assertEq(status, 400, 'status');
  assert(body.code, 'error code present');
});

await test('POST /api/access/segment with bad sessionId returns 400', async () => {
  const { status } = await post('/api/access/segment', {
    sessionId: 'not-hex', streamId: 'monad-keynote-hd', segmentIndex: 0,
    sessionSigner: '0x' + 'cc'.repeat(20),
    contractAddress: activeSettlement,
    voucher: { sessionId: '0x00', cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 400, 'status');
});

await test('POST /api/access/segment with voucher sessionId mismatch returns 400 SESSION_MISMATCH', async () => {
  const fakeId = '0x' + 'ab'.repeat(32);
  const otherId = '0x' + 'cd'.repeat(32);
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'cc'.repeat(20), streamId: 'monad-keynote-hd', segmentIndex: 0,
    contractAddress: activeSettlement,
    voucher: { sessionId: otherId, cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 400, 'status');
  assertEq(body.code, 'SESSION_MISMATCH', 'code');
});

await test('POST /api/access/segment with contract address mismatch returns 400 CONTRACT_MISMATCH', async () => {
  const fakeId = '0x' + 'ab'.repeat(32);
  const mismatchedAddress = activeSettlement.toLowerCase() === '0x0000000000000000000000000000000000000001'
    ? '0x0000000000000000000000000000000000000002'
    : '0x0000000000000000000000000000000000000001';
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'cc'.repeat(20), streamId: 'monad-keynote-hd', segmentIndex: 0,
    contractAddress: mismatchedAddress,
    voucher: { sessionId: fakeId, cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 400, 'status');
  assertEq(body.code, 'CONTRACT_MISMATCH', 'code');
});

await test('POST /api/access/segment with cumulative units too low returns 402 PAYMENT_REQUIRED', async () => {
  const fakeId = '0x' + 'ab'.repeat(32);
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'cc'.repeat(20), streamId: 'monad-keynote-hd', segmentIndex: 0,
    contractAddress: activeSettlement,
    voucher: { sessionId: fakeId, cumulativeUnits: '1', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 402, 'status');
  assertEq(body.code, 'PAYMENT_REQUIRED', 'code');
});

await test('POST /api/access/segment with cumulative units too high returns 400 CUMULATIVE_UNITS_TOO_HIGH', async () => {
  const fakeId = '0x' + 'ab'.repeat(32);
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'cc'.repeat(20), streamId: 'monad-keynote-hd', segmentIndex: 0,
    contractAddress: activeSettlement,
    voucher: { sessionId: fakeId, cumulativeUnits: '10', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 400, 'status');
  assertEq(body.code, 'CUMULATIVE_UNITS_TOO_HIGH', 'code');
});

await test('POST /api/access/segment with invalid recipient returns 400', async () => {
  const fakeId = '0x' + 'ab'.repeat(32);
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'cc'.repeat(20), recipient: 'not-an-address', streamId: 'monad-keynote-hd', segmentIndex: 0,
    contractAddress: activeSettlement,
    voucher: { sessionId: fakeId, cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 400, 'status');
  assertEq(body.code, 'INVALID_RECIPIENT', 'code');
});

await test('POST /api/access/segment with non-existent session returns 401 or 403', async () => {
  const fakeId = '0x' + 'ab'.repeat(32);
  const { status } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'cc'.repeat(20), streamId: 'monad-keynote-hd', segmentIndex: 0,
    contractAddress: activeSettlement,
    voucher: { sessionId: fakeId, cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assert(status === 401 || status === 403, `expected 401 or 403, got ${status}`);
});

// Playlist
await test('GET playlist returns m3u8', async () => {
  const r = await fetch(`${BASE}/api/access/playlist/monad-keynote-hd.m3u8`);
  assertEq(r.status, 200, 'status');
  const text = await r.text();
  assert(text.includes('#EXTM3U'), 'is m3u8');
});

// Content delivery without token
await test('GET content without token returns 401', async () => {
  const { status } = await json(`${BASE}/api/access/content/monad-keynote-hd/segment_0.ts`);
  assertEq(status, 401, 'status');
});

await test('GET content with bad token returns 403', async () => {
  const { status } = await json(`${BASE}/api/access/content/monad-keynote-hd/segment_0.ts?token=badtoken`);
  assertEq(status, 403, 'status');
});

// Rate limiter doesn't trigger under normal load (sanity)
await test('rate limiter allows normal traffic', async () => {
  for (let i = 0; i < 5; i++) {
    const { status } = await json(`${BASE}/health`);
    assertEq(status, 200, `request ${i}`);
  }
});

// Bad JSON body
await test('POST with invalid JSON returns 400', async () => {
  const r = await fetch(`${BASE}/api/access/segment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{{{invalid',
  });
  assertEq(r.status, 400, 'status');
});

// Unknown stream in gate — should return 404 with UNKNOWN_STREAM code
await test('POST gate with unknown stream returns 404 UNKNOWN_STREAM', async () => {
  const fakeId = '0x' + 'cd'.repeat(32);
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'dd'.repeat(20), streamId: 'nonexistent', segmentIndex: 0,
    contractAddress: activeSettlement,
    voucher: { sessionId: fakeId, cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 404, 'status');
  assertEq(body.code, 'UNKNOWN_STREAM', 'code');
});

// Segment index validation
await test('POST gate with negative segmentIndex returns 400', async () => {
  const fakeId = '0x' + 'cd'.repeat(32);
  const { status } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'dd'.repeat(20), streamId: 'monad-keynote-hd', segmentIndex: -1,
    contractAddress: activeSettlement,
    voucher: { sessionId: fakeId, cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 400, 'status');
});

// Invalid segment filename
await test('GET content with invalid segment filename returns 400', async () => {
  const { status } = await json(`${BASE}/api/access/content/monad-keynote-hd/not_a_segment.ts?token=sometoken`);
  assertEq(status, 400, 'status');
});

// Unknown stream in manifest proof
await test('GET proof for unknown stream returns 404', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/unknown-stream/segment/0/proof`);
  assertEq(status, 404, 'status');
  assertEq(body.code, 'UNKNOWN_STREAM', 'code');
});

// Unknown stream in playlist
await test('GET playlist for unknown stream returns 404', async () => {
  const r = await fetch(`${BASE}/api/access/playlist/unknown-stream.m3u8`);
  assertEq(r.status, 404, 'status');
});

// ─── Summary ───────────────────────────────────────────────────────
console.log(`\n📊 Results: ${pass} passed, ${fail} failed out of ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

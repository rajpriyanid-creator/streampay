#!/usr/bin/env node
/**
 * StreamPay e2e test suite.
 * Requires: access-service running (optionally with deployed contract on Anvil).
 *
 * Usage: node scripts/e2e/e2e.mjs
 */

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

// ─── Tests ─────────────────────────────────────────────────────────
console.log('\n🧪 StreamPay e2e test suite\n');

// Health
await test('GET /health returns ok + chainId', async () => {
  const { status, body } = await json(`${BASE}/health`);
  assertEq(status, 200, 'status');
  assertEq(body.status, 'ok');
  assert(typeof body.chainId === 'number', 'chainId is number');
  assert(body.settlement, 'settlement present');
});

// Manifest
await test('GET /api/manifest/:streamId returns manifest', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/monad-keynote-hd`);
  assertEq(status, 200, 'status');
  assert(body.merkleRoot, 'merkleRoot');
  assertEq(body.totalSegments, 20, 'segments');
  assert(!body.treeLayers, 'treeLayers should be omitted from public response');
});

await test('GET /api/manifest/unknown returns 404 with UNKNOWN_STREAM code', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/no-such-stream`);
  assertEq(status, 404, 'status');
  assertEq(body.code, 'UNKNOWN_STREAM', 'error code');
});

// Proof
await test('GET proof for segment 0', async () => {
  const { status, body } = await json(`${BASE}/api/manifest/monad-keynote-hd/segment/0/proof`);
  assertEq(status, 200, 'status');
  assert(Array.isArray(body.proof), 'proof array');
  assert(body.merkleRoot, 'root');
});

await test('GET proof for out-of-range segment returns 404', async () => {
  const { status } = await json(`${BASE}/api/manifest/monad-keynote-hd/segment/999/proof`);
  assertEq(status, 404, 'status');
});

// Segment gate – bad inputs
await test('POST /api/access/segment with missing body returns 400', async () => {
  const { status, body } = await post('/api/access/segment', {});
  assertEq(status, 400, 'status');
  assert(body.code, 'error code present');
});

await test('POST /api/access/segment with bad sessionId returns 400', async () => {
  const { status } = await post('/api/access/segment', {
    sessionId: 'not-hex', streamId: 'monad-keynote-hd', segmentIndex: 0,
    voucher: { sessionId: '0x00', cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  assertEq(status, 400, 'status');
});

// Note: POST with non-existent session tests depend on whether SETTLEMENT_ADDRESS is set.
// If set, the server will do on-chain lookup and return 403.
// If not set, the server skips on-chain check but will fail on signature verification.
await test('POST /api/access/segment with non-existent session returns error', async () => {
  const fakeId = '0x' + 'ab'.repeat(32);
  const { status } = await post('/api/access/segment', {
    sessionId: fakeId, sessionSigner: '0x' + 'cc'.repeat(20), streamId: 'monad-keynote-hd', segmentIndex: 0,
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    voucher: { sessionId: fakeId, cumulativeUnits: '2', signature: '0x' + '00'.repeat(65) },
  });
  // Should return 401 (bad sig) or 403 (session not found) depending on config
  assert(status === 401 || status === 403, `expected 401 or 403, got ${status}`);
});

// Admin endpoints — protected by ADMIN_TOKEN
await test('GET /api/vouchers without token returns 401 in non-local mode or 200 in local mode', async () => {
  const { status } = await json(`${BASE}/api/vouchers`);
  // In local mode without ADMIN_TOKEN set, returns 200. Otherwise 401.
  assert(status === 200 || status === 401, `expected 200 or 401, got ${status}`);
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
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
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
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
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

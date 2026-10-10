#!/usr/bin/env node
/**
 * StreamPay attack / negative-path tests.
 * Exercises the access gate with forged, replayed, and out-of-bounds vouchers.
 *
 * Usage: node scripts/e2e/attack.mjs
 */

const BASE = process.env.ACCESS_URL || 'http://localhost:4001';
let pass = 0, fail = 0;

async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

async function post(path, data) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

console.log('\n🔐 StreamPay attack / negative-path tests\n');

const fakeId = '0x' + 'aa'.repeat(32);
const fakeSig = '0x' + '11'.repeat(65);

await test('forged signature is rejected', async () => {
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, streamId: 'monad-keynote-hd', segmentIndex: 0,
    voucher: { sessionId: fakeId, cumulativeUnits: '2', signature: fakeSig },
  });
  // Should be 403 (no session on-chain) not 200
  assert(status >= 400, `expected 4xx, got ${status}`);
});

await test('session-id mismatch in voucher is rejected', async () => {
  const otherId = '0x' + 'bb'.repeat(32);
  const { status, body } = await post('/api/access/segment', {
    sessionId: fakeId, streamId: 'monad-keynote-hd', segmentIndex: 0,
    voucher: { sessionId: otherId, cumulativeUnits: '2', signature: fakeSig },
  });
  assert(status === 400, `expected 400, got ${status}: ${body.code}`);
});

await test('cumulativeUnits overflow (> uint64) is rejected', async () => {
  const { status } = await post('/api/access/segment', {
    sessionId: fakeId, streamId: 'monad-keynote-hd', segmentIndex: 0,
    voucher: { sessionId: fakeId, cumulativeUnits: '99999999999999999999', signature: fakeSig },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

console.log(`\n📊 Attack tests: ${pass} passed, ${fail} failed out of ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

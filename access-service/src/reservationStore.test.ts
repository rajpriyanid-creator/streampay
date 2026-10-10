import test from 'node:test';
import assert from 'node:assert/strict';
import { ReservationLedger, SessionLimits } from './reservationStore';

const defaultLimits: SessionLimits = {
  maxCreditSegments: 3,
  maxCreditWindowUnits: 10n,
  maxUnredeemedAmount: 5000n, // 10 units * 500 unitPrice = 5000
  unitPrice: 500n,
  maxBillableUnits: 100n,
  deposit: 50000n, // 100 units * 500 = 50000
};

test('ReservationLedger Suite', async (t) => {
  const ledger = new ReservationLedger();

  await t.test('1. Monotonicity: rejects cumulative units below settled units', async () => {
    ledger.clear();
    const sessionId = '0xsession1';
    // Session already settled at 10 units
    const res = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      8n, // Lower than 10 settled
      'token1',
      'sig1',
      30,
      10n // settledUnits
    );
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason!, /lower than already settled/);
  });

  await t.test('2. Idempotency: duplicate requests return existing active token without double-counting slots', async () => {
    ledger.clear();
    const sessionId = '0xsession2';
    const now = 1000000;

    const res1 = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'token-seg0',
      'sig-seg0',
      30,
      0n,
      now
    );
    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.isDuplicate, undefined);

    const stats1 = ledger.getStats(sessionId, now);
    assert.strictEqual(stats1?.inFlightSegments, 1);

    // Duplicate request for same segment 0 while active
    const res2 = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'new-candidate-token',
      'new-sig',
      30,
      0n,
      now
    );
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.isDuplicate, true);
    assert.strictEqual(res2.existingToken, 'token-seg0');

    // Slot count MUST still be 1, NOT 2
    const stats2 = ledger.getStats(sessionId, now);
    assert.strictEqual(stats2?.inFlightSegments, 1);
  });

  await t.test('3. In-flight Cap: maxCreditSegments boundary blocks excess reservations', async () => {
    ledger.clear();
    const sessionId = '0xsession3';
    const now = 1000000;

    // Issue 3 segments (maxCreditSegments = 3)
    await ledger.checkAndReserve(sessionId, defaultLimits, 0, 2n, 'tok0', 'sig0', 30, 0n, now);
    await ledger.checkAndReserve(sessionId, defaultLimits, 1, 4n, 'tok1', 'sig1', 30, 0n, now);
    await ledger.checkAndReserve(sessionId, defaultLimits, 2, 6n, 'tok2', 'sig2', 30, 0n, now);

    const stats = ledger.getStats(sessionId, now);
    assert.strictEqual(stats?.inFlightSegments, 3);

    // 4th request must be rejected because 3 are already in-flight
    const res4 = await ledger.checkAndReserve(sessionId, defaultLimits, 3, 8n, 'tok3', 'sig3', 30, 0n, now);
    assert.strictEqual(res4.allowed, false);
    assert.match(res4.reason!, /Credit window full: 3\/3/);
  });

  await t.test('4. Failed HTTP Delivery: immediately releases in-flight reservation slot', async () => {
    ledger.clear();
    const sessionId = '0xsession4';
    const now = 1000000;

    // Fill capacity to 3
    await ledger.checkAndReserve(sessionId, defaultLimits, 0, 2n, 'tok0', 'sig0', 30, 0n, now);
    await ledger.checkAndReserve(sessionId, defaultLimits, 1, 4n, 'tok1', 'sig1', 30, 0n, now);
    await ledger.checkAndReserve(sessionId, defaultLimits, 2, 6n, 'tok2', 'sig2', 30, 0n, now);

    // Segment 1 delivery fails (HTTP aborted/dropped)
    await ledger.onDeliveryFailed(sessionId, 'sig1');

    // In-flight should decrease to 2
    const stats = ledger.getStats(sessionId, now);
    assert.strictEqual(stats?.inFlightSegments, 2);

    // Now requesting segment 3 should succeed
    const res3 = await ledger.checkAndReserve(sessionId, defaultLimits, 3, 8n, 'tok3', 'sig3', 30, 0n, now);
    assert.strictEqual(res3.allowed, true);
  });

  await t.test('5. Never-consumed / Expired tokens: pruned automatically after TTL', async () => {
    ledger.clear();
    const sessionId = '0xsession5';
    const startTime = 1000000;
    const ttlSec = 10; // 10 seconds TTL

    // Fill capacity
    await ledger.checkAndReserve(sessionId, defaultLimits, 0, 2n, 'tok0', 'sig0', ttlSec, 0n, startTime);
    await ledger.checkAndReserve(sessionId, defaultLimits, 1, 4n, 'tok1', 'sig1', ttlSec, 0n, startTime);
    await ledger.checkAndReserve(sessionId, defaultLimits, 2, 6n, 'tok2', 'sig2', ttlSec, 0n, startTime);

    // At startTime + 5s (not yet expired) -> should still be full
    const blockedRes = await ledger.checkAndReserve(sessionId, defaultLimits, 3, 8n, 'tok3', 'sig3', ttlSec, 0n, startTime + 5000);
    assert.strictEqual(blockedRes.allowed, false);

    // At startTime + 11s (TTL expired, never consumed) -> prune should free slots
    const allowedRes = await ledger.checkAndReserve(sessionId, defaultLimits, 3, 8n, 'tok3', 'sig3', ttlSec, 0n, startTime + 11000);
    assert.strictEqual(allowedRes.allowed, true);
  });

  await t.test('6. Credit Window boundary: maxCreditWindowUnits blocks unredeemed units above checkpoint', async () => {
    ledger.clear();
    const sessionId = '0xsession6';
    const now = 1000000;

    // Segments delivered one by one: 2, 4, 6, 8, 10
    for (let i = 0; i < 5; i++) {
      const units = BigInt((i + 1) * 2);
      await ledger.checkAndReserve(sessionId, defaultLimits, i, units, `tok${i}`, `sig${i}`, 30, 0n, now);
      await ledger.onDeliveryCompleted(sessionId, `sig${i}`, i);
    }

    // Cumulative units is now 10 (which equals maxCreditWindowUnits = 10)
    // Attempting segment 5 with cumulative units = 12 (> 10 above checkpoint 0) must be rejected
    const resOverflow = await ledger.checkAndReserve(sessionId, defaultLimits, 5, 12n, 'tok5', 'sig5', 30, 0n, now);
    assert.strictEqual(resOverflow.allowed, false);
    assert.match(resOverflow.reason!, /exceed maxCreditWindowUnits/);
  });

  await t.test('7. Checkpoint & Resume: updating settledUnits frees credit window for continued playback', async () => {
    ledger.clear();
    const sessionId = '0xsession7';
    const now = 1000000;

    // Deliver up to 10 units (window full)
    for (let i = 0; i < 5; i++) {
      const units = BigInt((i + 1) * 2);
      await ledger.checkAndReserve(sessionId, defaultLimits, i, units, `tok${i}`, `sig${i}`, 30, 0n, now);
      await ledger.onDeliveryCompleted(sessionId, `sig${i}`, i);
    }

    // Checkpoint settled at 10 units on-chain
    await ledger.onCheckpoint(sessionId, 10n);

    // Now segment 5 with cumulative units = 12 is only 2 units above checkpoint (12 - 10 = 2 <= 10)
    // Continued playback MUST succeed!
    const resContinued = await ledger.checkAndReserve(sessionId, defaultLimits, 5, 12n, 'tok5', 'sig5', 30, 10n, now);
    assert.strictEqual(resContinued.allowed, true);
  });

  await t.test('8. Cap Boundaries: maxUnredeemedAmount, maxBillableUnits, and deposit caps', async () => {
    ledger.clear();
    const sessionId = '0xsession8';
    const now = 1000000;

    const strictLimits: SessionLimits = {
      maxCreditSegments: 5,
      maxCreditWindowUnits: 50n,
      maxUnredeemedAmount: 2000n, // cap is 2000 base units (4 units * 500 = 2000)
      unitPrice: 500n,
      maxBillableUnits: 20n,      // max 20 billable units
      deposit: 10000n,            // deposit = 10000 (max 20 units)
    };

    // 1. maxUnredeemedAmount check: requesting 6 units = 3000 > 2000
    const resAmount = await ledger.checkAndReserve(sessionId, strictLimits, 0, 6n, 't1', 's1', 30, 0n, now);
    assert.strictEqual(resAmount.allowed, false);
    assert.match(resAmount.reason!, /maxUnredeemedAmount/);

    // 2. maxBillableUnits check: requesting 22 units > 20
    const relaxedAmountLimits = { ...strictLimits, maxUnredeemedAmount: 50000n };
    const resBillable = await ledger.checkAndReserve(sessionId, relaxedAmountLimits, 0, 22n, 't2', 's2', 30, 0n, now);
    assert.strictEqual(resBillable.allowed, false);
    assert.match(resBillable.reason!, /maxBillableUnits/);

    // 3. Deposit cap check: total cost exceeding deposit
    const tinyDepositLimits = { ...relaxedAmountLimits, maxBillableUnits: 100n, deposit: 2500n }; // deposit only covers 5 units
    const resDeposit = await ledger.checkAndReserve(sessionId, tinyDepositLimits, 0, 6n, 't3', 's3', 30, 0n, now);
    assert.strictEqual(resDeposit.allowed, false);
    assert.match(resDeposit.reason!, /session deposit/);
  });

  await t.test('9. Concurrency Safety: parallel asynchronous requests are serialized correctly', async () => {
    ledger.clear();
    const sessionId = '0xsession9';
    const now = 1000000;

    // Launch 10 parallel requests for segment 0
    const promises = Array.from({ length: 10 }, (_, i) =>
      ledger.checkAndReserve(
        sessionId,
        defaultLimits,
        0,
        2n,
        `token-${i}`,
        `sig-${i}`,
        30,
        0n,
        now
      )
    );

    const results = await Promise.all(promises);

    // Exactly one should be the original grant, 9 should be idempotent duplicates
    const originals = results.filter((r) => r.allowed && !r.isDuplicate);
    const duplicates = results.filter((r) => r.allowed && r.isDuplicate);

    assert.strictEqual(originals.length, 1);
    assert.strictEqual(duplicates.length, 9);

    // All duplicates must return the original token
    for (const dup of duplicates) {
      assert.strictEqual(dup.existingToken, originals[0].existingToken || 'token-0');
    }

    // In-flight count must strictly be 1
    const stats = ledger.getStats(sessionId, now);
    assert.strictEqual(stats?.inFlightSegments, 1);
  });

  await t.test('10. Bounded Store Size: 1,000 successful deliveries preserve bounded memory and zero active leaks', async () => {
    ledger.clear();
    const sessionId = '0xsession10_bounded';
    const largeLimits: SessionLimits = {
      maxCreditSegments: 10,
      maxCreditWindowUnits: 10000n,
      maxUnredeemedAmount: 5_000_000n,
      unitPrice: 500n,
      maxBillableUnits: 100_000n,
      deposit: 50_000_000n,
    };

    const now = 1000000;

    // Simulate 1,000 sequential segment deliveries
    for (let seg = 0; seg < 1000; seg++) {
      const cumUnits = BigInt((seg + 1) * 2);
      const token = `token-${seg}`;
      const tokenSig = `sig-${seg}`;

      const res = await ledger.checkAndReserve(
        sessionId,
        largeLimits,
        seg,
        cumUnits,
        token,
        tokenSig,
        30,
        0n,
        now
      );
      assert.strictEqual(res.allowed, true, `segment ${seg} should be allowed`);

      // Delivery completes immediately
      await ledger.onDeliveryCompleted(sessionId, tokenSig, seg);
    }

    const finalStats = ledger.getStats(sessionId, now);
    assert.ok(finalStats, 'finalStats exists');
    // Active reservations map MUST be completely cleared (0 active reservations)
    assert.strictEqual(finalStats.activeReservationsCount, 0, 'active reservations must be 0 after completed delivery');
    assert.strictEqual(finalStats.inFlightSegments, 0, 'in-flight segments must be 0');
    // Delivered tokens buffer MUST be strictly capped at 500 (MAX_DELIVERED_TOKENS)
    assert.strictEqual(finalStats.deliveredTokensCount, 500, 'deliveredTokensCount must be capped at 500');
  });

  await t.test('11. Replay & Duplicate Prevention: already delivered token and completed segment are rejected', async () => {
    ledger.clear();
    const sessionId = '0xsession11_replay';
    const now = 1000000;

    const res0 = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'tok0',
      'sig0',
      30,
      0n,
      now
    );
    assert.strictEqual(res0.allowed, true);

    // Complete delivery
    await ledger.onDeliveryCompleted(sessionId, 'sig0', 0);

    // 1. Re-requesting with same tokenSig must be rejected by replay protection
    const replayRes = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      1,
      4n,
      'tok0',
      'sig0',
      30,
      0n,
      now
    );
    assert.strictEqual(replayRes.allowed, false);
    assert.match(replayRes.reason!, /replay rejected/);

    // 2. Requesting segment 0 again must be rejected because it is already delivered
    const segReplayRes = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'tok-new',
      'sig-new',
      30,
      0n,
      now
    );
    assert.strictEqual(segReplayRes.allowed, false);
    assert.match(segReplayRes.reason!, /already delivered/);
  });

  await t.test('13. Expired token replacement: expired reservation is pruned, replacement token allowed for same voucher, delivery finalizes, subsequent retry rejected', async () => {
    ledger.clear();
    const sessionId = '0xsession13';
    const t0 = 1000000;
    const ttlSec = 10;

    // 1. Initial reservation at t0
    const resA = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'tokenA',
      'sigA',
      ttlSec,
      0n,
      t0
    );
    assert.strictEqual(resA.allowed, true);
    assert.strictEqual(resA.isDuplicate, undefined);

    // 2. Duplicate request before expiry (t0 + 5s) -> reuses unexpired token
    const resDup = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'tokenCandidate',
      'sigCandidate',
      ttlSec,
      0n,
      t0 + 5000
    );
    assert.strictEqual(resDup.allowed, true);
    assert.strictEqual(resDup.isDuplicate, true);
    assert.strictEqual(resDup.existingToken, 'tokenA');

    // 3. Advance clock past expiry (t0 + 15s) -> reservation pruned, replacement token allowed
    const t1 = t0 + 15000;
    const resB = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'tokenB',
      'sigB',
      ttlSec,
      0n,
      t1
    );
    assert.strictEqual(resB.allowed, true);
    assert.strictEqual(resB.isDuplicate, undefined);
    assert.notStrictEqual(resB.existingToken, 'tokenA');

    // 4. Complete delivery using tokenB
    await ledger.onDeliveryCompleted(sessionId, 'sigB', 0);

    // 5. Subsequent attempt for same segment must now be rejected as already delivered
    const resAfterDelivery = await ledger.checkAndReserve(
      sessionId,
      defaultLimits,
      0,
      2n,
      'tokenC',
      'sigC',
      ttlSec,
      0n,
      t1 + 1000
    );
    assert.strictEqual(resAfterDelivery.allowed, false);
    assert.match(resAfterDelivery.reason!, /already delivered/);
  });
});

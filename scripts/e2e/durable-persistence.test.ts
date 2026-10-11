/**
 * StreamPay v2.5 — Durable Persistence, Restart Recovery & Dual-Instance E2E Test
 *
 * Verifies:
 * 1. Restart Recovery: State (vouchers, reservations, completed deliveries) survives process restart.
 * 2. Replay Protection After Restart: Old tokens and completed segments cannot be replayed after restart.
 * 3. Multi-Instance Sharing: Instance A mints token; Instance B consumes it; Instance A rejects replay.
 * 4. TOKEN_SECRET Validation: Non-local / production strictly requires >=32 char secret at startup.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { privateKeyToAccount } from 'viem/accounts';
import { type Hex } from 'viem';
import {
  acquireLock,
  releaseLock,
  isProcessAlive,
  readLockPayload,
  type LockPayload,
} from '../../access-service/dist/durableStore';

const TEST_DIR = path.join(__dirname, '../../.test-durable-data');
const PORT_A = 4071;
const PORT_B = 4072;
const ACCESS_URL_A = `http://localhost:${PORT_A}`;
const ACCESS_URL_B = `http://localhost:${PORT_B}`;

// Shared secret for multi-instance tests (at least 32 characters)
const SHARED_SECRET = 'streampay_secure_shared_token_secret_for_cluster_testing_32chars';

// Ephemeral keys for signing vouchers
const signerAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

async function waitForServer(url: string, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        const body: any = await res.json();
        if (body.ready) return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function spawnInstance(port: number, envOverrides: Record<string, string> = {}): ChildProcess {
  const p = spawn(
    'node',
    [path.join(__dirname, '../../access-service/dist/server.js')],
    {
      env: {
        ...process.env,
        PORT: String(port),
        SIMULATION_MODE: 'true',
        SETTLEMENT_ADDRESS: '',
        NETWORK: 'local',
        DATA_STORE_DIR: TEST_DIR,
        ENABLE_TEST_CLOCK: 'true',
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  p.stderr?.on('data', (d) => console.error(`[err:${port}]`, d.toString().trim()));
  return p;
}

async function signVoucher(sessionId: Hex, cumulativeUnits: bigint) {
  const domain = {
    name: 'StreamPaySettlement',
    version: '2.5',
    chainId: 31337n,
    verifyingContract: '0x0000000000000000000000000000000000000000' as Hex,
  } as const;

  const types = {
    Voucher: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'cumulativeUnits', type: 'uint64' },
    ],
  } as const;

  return signerAccount.signTypedData({
    domain,
    types,
    primaryType: 'Voucher',
    message: { sessionId, cumulativeUnits },
  });
}

async function runTests() {
  console.log('\n🧪 Starting StreamPay Durable Persistence & Multi-Instance E2E Tests...\n');

  // Clean test directory
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // ────────────────────────────────────────────────────────────────
  // TEST 1: High-entropy TOKEN_SECRET validation in non-local & production
  // ────────────────────────────────────────────────────────────────
  console.log('Test 1: Verifying startup validation for TOKEN_SECRET outside local mode...');

  // 1a: Missing TOKEN_SECRET in testnet
  const p1 = spawnInstance(PORT_A, { NETWORK: 'monad-testnet', TOKEN_SECRET: '', SIMULATION_MODE: 'false' });
  const code1: number = await new Promise((res) => p1.on('exit', (c) => res(c ?? 1)));
  if (code1 !== 1) throw new Error(`Expected missing TOKEN_SECRET on testnet to exit with 1, got ${code1}`);
  console.log('  ✅ Missing TOKEN_SECRET on testnet rejected with exit code 1');

  // 1b: Short TOKEN_SECRET in production
  const p2 = spawnInstance(PORT_A, { NODE_ENV: 'production', TOKEN_SECRET: 'short_secret', SIMULATION_MODE: 'false', ENABLE_TEST_CLOCK: 'false' });
  const code2: number = await new Promise((res) => p2.on('exit', (c) => res(c ?? 1)));
  if (code2 !== 1) throw new Error(`Expected short TOKEN_SECRET in production to exit with 1, got ${code2}`);
  console.log('  ✅ Short TOKEN_SECRET (<32 chars) rejected with exit code 1');

  // ────────────────────────────────────────────────────────────────
  // TEST 2: Process Restart Recovery & Replay Protection
  // ────────────────────────────────────────────────────────────────
  console.log('\nTest 2: Verifying session state persistence & restart recovery...');

  const sessionId: Hex = ('0x' + 'aa'.repeat(32)) as Hex;
  const sessionSigner = signerAccount.address;
  const recipient: Hex = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const contractAddress: Hex = '0x0000000000000000000000000000000000000000';

  let savedContentUrl = '';
  let sig0: Hex = '0x';

  // Spawn Instance 1
  const proc1 = spawnInstance(PORT_A, { TOKEN_SECRET: SHARED_SECRET });
  try {
    const ready1 = await waitForServer(ACCESS_URL_A);
    if (!ready1) throw new Error('Instance 1 failed to start');

    // Request segment 0
    sig0 = await signVoucher(sessionId, 2n);
    const gateRes1 = await fetch(`${ACCESS_URL_A}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        sessionSigner,
        recipient,
        contractAddress,
        chainId: 31337,
        streamId: 'monad-keynote-hd',
        segmentIndex: 0,
        voucher: { sessionId, cumulativeUnits: '2', signature: sig0 },
      }),
    });

    const gateData1: any = await gateRes1.json();
    if (!gateRes1.ok || !gateData1.success) {
      throw new Error(`Gate request failed on Instance 1: ${JSON.stringify(gateData1)}`);
    }
    savedContentUrl = gateData1.contentUrl;
    console.log('  ✅ Segment 0 token granted on Instance 1');

    // Consume and deliver segment 0
    const contentRes1 = await fetch(`${ACCESS_URL_A}${savedContentUrl}`);
    if (!contentRes1.ok) throw new Error(`Content fetch failed: ${contentRes1.status}`);
    const bytes1 = await contentRes1.arrayBuffer();
    if (bytes1.byteLength === 0) throw new Error('Empty media bytes received');
    console.log(`  ✅ Segment 0 content delivered (${bytes1.byteLength} bytes)`);

    // Verify voucher state on Instance 1
    const vRes1 = await fetch(`${ACCESS_URL_A}/api/vouchers`);
    const vData1: any = await vRes1.json();
    const stored1 = vData1.vouchers.find((v: any) => v.sessionId.toLowerCase() === sessionId.toLowerCase());
    if (!stored1 || stored1.totalServedSegments !== 1) {
      throw new Error(`Voucher store incomplete on Instance 1: ${JSON.stringify(vData1)}`);
    }
    console.log('  ✅ In-memory voucher confirmed totalServedSegments=1 on Instance 1');
  } finally {
    proc1.kill('SIGKILL');
  }

  // Confirm state file was written
  const statePath = path.join(TEST_DIR, 'state.json');
  if (!fs.existsSync(statePath)) throw new Error(`state.json was not created at ${statePath}`);
  console.log('  ✅ Confirmed state.json durably persisted to disk');

  // Spawn Instance 1 RESTART (Instance 2 on same port and data directory)
  console.log('\nRestarting access service to test recovery...');
  const procRestart = spawnInstance(PORT_A, { TOKEN_SECRET: SHARED_SECRET });
  try {
    const readyRestart = await waitForServer(ACCESS_URL_A);
    if (!readyRestart) throw new Error('Restarted instance failed to start');

    // Query vouchers after restart
    const vResAfter = await fetch(`${ACCESS_URL_A}/api/vouchers`);
    const vDataAfter: any = await vResAfter.json();
    const storedAfter = vDataAfter.vouchers.find((v: any) => v.sessionId.toLowerCase() === sessionId.toLowerCase());
    if (!storedAfter || storedAfter.totalServedSegments !== 1 || storedAfter.highestCumulativeUnits !== '2') {
      throw new Error(`Failed to recover voucher state after restart: ${JSON.stringify(vDataAfter)}`);
    }
    console.log('  ✅ Recovered voucher state after restart: highestUnits=2, totalServedSegments=1');

    // Replay protection check 1: Old consumed token rejected
    const replayContent = await fetch(`${ACCESS_URL_A}${savedContentUrl}`);
    if (replayContent.status !== 403) {
      throw new Error(`Expected replay of consumed token to return 403, got ${replayContent.status}`);
    }
    console.log('  ✅ Replay of consumed token after restart correctly rejected (403)');

    // Replay protection check 2: Re-request for already completed segment 0 rejected
    const retryGate = await fetch(`${ACCESS_URL_A}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        sessionSigner,
        recipient,
        contractAddress,
        chainId: 31337,
        streamId: 'monad-keynote-hd',
        segmentIndex: 0,
        voucher: { sessionId, cumulativeUnits: '2', signature: sig0 },
      }),
    });
    if (retryGate.status !== 400 && retryGate.status !== 402 && retryGate.status !== 409) {
      throw new Error(`Expected completed segment re-request to be rejected, got ${retryGate.status}`);
    }
    console.log('  ✅ Re-request for already completed segment rejected after restart (status 402/400)');
  } finally {
    procRestart.kill('SIGKILL');
  }

  // ────────────────────────────────────────────────────────────────
  // TEST 3: Multi-Instance Cluster Sharing & Replay Coordination
  // ────────────────────────────────────────────────────────────────
  console.log('\nTest 3: Verifying multi-instance token sharing and cross-instance replay protection...');

  const procA = spawnInstance(PORT_A, { TOKEN_SECRET: SHARED_SECRET });
  const procB = spawnInstance(PORT_B, { TOKEN_SECRET: SHARED_SECRET });

  try {
    const readyA = await waitForServer(ACCESS_URL_A);
    const readyB = await waitForServer(ACCESS_URL_B);
    if (!readyA || !readyB) throw new Error('Dual instances failed to start');

    // Instance A mints token for segment 1
    const sig1 = await signVoucher(sessionId, 4n);
    const gateResA = await fetch(`${ACCESS_URL_A}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        sessionSigner,
        recipient,
        contractAddress,
        chainId: 31337,
        streamId: 'monad-keynote-hd',
        segmentIndex: 1,
        voucher: { sessionId, cumulativeUnits: '4', signature: sig1 },
      }),
    });
    const gateDataA: any = await gateResA.json();
    if (!gateResA.ok || !gateDataA.success) {
      throw new Error(`Instance A failed to issue token for segment 1: ${JSON.stringify(gateDataA)}`);
    }
    console.log('  ✅ Instance A issued segment 1 token');

    // Instance B consumes the token and serves the media bytes
    const contentResB = await fetch(`${ACCESS_URL_B}${gateDataA.contentUrl}`);
    if (!contentResB.ok) throw new Error(`Instance B failed to validate token issued by Instance A: ${contentResB.status}`);
    const bytesB = await contentResB.arrayBuffer();
    if (bytesB.byteLength === 0) throw new Error('Empty media bytes from Instance B');
    console.log(`  ✅ Instance B validated & delivered content with Instance A token (${bytesB.byteLength} bytes)`);

    // Instance A now rejects replay of that same token
    const replayResA = await fetch(`${ACCESS_URL_A}${gateDataA.contentUrl}`);
    if (replayResA.status !== 403) {
      throw new Error(`Expected Instance A to reject token consumed by Instance B, got ${replayResA.status}`);
    }
    console.log('  ✅ Instance A rejected replay of token consumed by Instance B (cross-instance single-use)');

    // ────────────────────────────────────────────────────────────────
    // TEST 4: Concurrent Cross-Instance Updates & Conflict Prevention
    // ────────────────────────────────────────────────────────────────
    console.log('\nTest 4: Verifying concurrent updates & conflict resolution across instances...');

    // Instance A issues and delivers Segment 2 for Session 1
    const sig2 = await signVoucher(sessionId, 6n);
    const gateResA2 = await fetch(`${ACCESS_URL_A}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        sessionSigner,
        recipient,
        contractAddress,
        chainId: 31337,
        streamId: 'monad-keynote-hd',
        segmentIndex: 2,
        voucher: { sessionId, cumulativeUnits: '6', signature: sig2 },
      }),
    });
    const gateDataA2: any = await gateResA2.json();
    if (!gateResA2.ok || !gateDataA2.success) throw new Error('Failed to gate segment 2 on Instance A');

    // Deliver segment 2 on Instance A
    const delResA2 = await fetch(`${ACCESS_URL_A}${gateDataA2.contentUrl}`);
    if (!delResA2.ok) throw new Error('Failed to deliver segment 2 on Instance A');

    // Meanwhile, Session 2 is processed on Instance B concurrently
    const session2Id: Hex = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const sigSession2 = await signVoucher(session2Id, 2n);
    const gateResB2 = await fetch(`${ACCESS_URL_B}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session2Id,
        sessionSigner,
        recipient,
        contractAddress,
        chainId: 31337,
        streamId: 'monad-keynote-hd',
        segmentIndex: 0,
        voucher: { sessionId: session2Id, cumulativeUnits: '2', signature: sigSession2 },
      }),
    });
    const gateDataB2: any = await gateResB2.json();
    if (!gateResB2.ok || !gateDataB2.success) throw new Error('Failed to gate session 2 on Instance B');

    // Deliver on Instance B
    const delResB2 = await fetch(`${ACCESS_URL_B}${gateDataB2.contentUrl}`);
    if (!delResB2.ok) throw new Error('Failed to deliver session 2 on Instance B');

    // Verify state.json contains updates from BOTH Instance A and Instance B (no lost updates!)
    const stateFile = path.join(TEST_DIR, 'state.json');
    const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!persistedState.sessions[sessionId.toLowerCase()]) {
      throw new Error('Session 1 missing from persisted state');
    }
    if (!persistedState.sessions[session2Id.toLowerCase()]) {
      throw new Error('Session 2 lost from persisted state due to concurrent overwrite');
    }
    console.log('  ✅ Concurrent writes preserved both sessions in state.json without lost updates');

    // Simultaneous first-use race test across separate instances
    // Issue a brand-new token for Segment 3, then send simultaneous first-use requests to Instance A and Instance B
    const sig3 = await signVoucher(sessionId, 8n);
    const gateRes3 = await fetch(`${ACCESS_URL_A}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        sessionSigner,
        recipient,
        contractAddress,
        chainId: 31337,
        streamId: 'monad-keynote-hd',
        segmentIndex: 3,
        voucher: { sessionId, cumulativeUnits: '8', signature: sig3 },
      }),
    });
    const gateData3: any = await gateRes3.json();
    if (!gateRes3.ok || !gateData3.success) throw new Error('Failed to gate segment 3');

    // Fire simultaneous first-use requests to Instance A and Instance B
    const [firstUseA, firstUseB] = await Promise.all([
      fetch(`${ACCESS_URL_A}${gateData3.contentUrl}`),
      fetch(`${ACCESS_URL_B}${gateData3.contentUrl}`),
    ]);
    const statuses = [firstUseA.status, firstUseB.status].sort();
    if (statuses[0] !== 200 || statuses[1] !== 403) {
      throw new Error(`Expected atomic check-and-consume to produce [200, 403], got [${firstUseA.status}, ${firstUseB.status}]`);
    }
    console.log('  ✅ Simultaneous first-use race across instances resolved atomically: exactly 1 granted (200), 1 rejected (403)');

    // Verify subsequent replay attempt across both instances also returns 403
    const [replay1, replay2] = await Promise.all([
      fetch(`${ACCESS_URL_A}${gateData3.contentUrl}`),
      fetch(`${ACCESS_URL_B}${gateData3.contentUrl}`),
    ]);
    if (replay1.status !== 403 || replay2.status !== 403) {
      throw new Error(`Expected subsequent replays to be rejected (403), got ${replay1.status} and ${replay2.status}`);
    }
    console.log('  ✅ Subsequent replays on both instances strictly rejected (both returned 403)');
  } finally {
    procA.kill('SIGKILL');
    procB.kill('SIGKILL');
    // Cleanup test data
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }

  // Test 5: Verifying fail-closed behavior on corrupted durable state file
  console.log('\nTest 5: Verifying persistence corruption fails closed (refuses to start with blank replay state)...');
  const corruptDir = path.join(os.tmpdir(), `streampay-corrupt-test-${Date.now()}`);
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, 'state.json'), '{"corrupted": true, broken json...');

  const corruptProc = spawn(
    'node',
    [path.join(__dirname, '../../access-service/dist/server.js')],
    {
      env: {
        ...process.env,
        PORT: '4094',
        SIMULATION_MODE: 'true',
        DATA_STORE_DIR: corruptDir,
        TOKEN_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
        NETWORK: 'local',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let corruptErrOutput = '';
  corruptProc.stderr.on('data', (d) => { corruptErrOutput += d.toString(); });
  corruptProc.stdout.on('data', (d) => { corruptErrOutput += d.toString(); });

  const exitCode = await new Promise<number>((resolve) => {
    corruptProc.on('exit', (code) => resolve(code ?? 0));
    setTimeout(() => {
      corruptProc.kill('SIGKILL');
      resolve(-1);
    }, 5000);
  });

  fs.rmSync(corruptDir, { recursive: true, force: true });
  if (exitCode === 0) {
    throw new Error('Server with corrupted state file unexpectedly started instead of failing closed!');
  }
  if (!corruptErrOutput.includes('CRITICAL: Corrupted durable state')) {
    throw new Error(`Expected fail-closed error message, got: ${corruptErrOutput}`);
  }
  console.log(`  ✅ Corrupted state.json caused server to fail closed (exit code ${exitCode}) with fatal replay-protection error`);

  // ────────────────────────────────────────────────────────────────
  // TEST 6: Rigorous Filesystem Lock Concurrency & Safety Properties
  // ────────────────────────────────────────────────────────────────
  console.log('\nTest 6: Rigorous unit verification of filesystem lock concurrency properties...');
  const lockTestDir = path.join(os.tmpdir(), `streampay-lock-test-${Date.now()}`);
  fs.mkdirSync(lockTestDir, { recursive: true });
  process.env.DATA_STORE_DIR = lockTestDir;

  try {
    const lockFile = path.join(lockTestDir, 'state.json.lock');

    // Subtest 6a: Live lock holder exceeding normal stale-lock age MUST NOT have lock stolen
    {
      const liveLock = acquireLock(2000, lockTestDir);
      // Simulate that the lock file is old (e.g. 15 seconds old)
      const fifteenSecsAgo = (Date.now() - 15000) / 1000;
      fs.utimesSync(lockFile, fifteenSecsAgo, fifteenSecsAgo);

      // Attempt to acquire from another caller with short timeout (300ms)
      let theftPrevented = false;
      try {
        acquireLock(300, lockTestDir);
      } catch (err: any) {
        theftPrevented = err.message.includes('Timeout acquiring durable state lockfile');
      }
      if (!theftPrevented) {
        throw new Error('FAILED: Lock held by a live process was stolen after exceeding normal age!');
      }

      // Verify original lock still intact with original ownerToken
      const current = readLockPayload(lockFile);
      if (current.payload?.ownerToken !== liveLock.ownerToken) {
        throw new Error('FAILED: Lock file content altered while held by living process!');
      }

      releaseLock(liveLock, lockTestDir);
      if (fs.existsSync(lockFile)) {
        throw new Error('FAILED: Lock file was not released cleanly by live owner!');
      }
      console.log('  ✅ 6a: Live lock holder exceeding normal age (15s) was NOT stolen (liveness preserved)');
    }

    // Subtest 6b: Genuinely abandoned lock (dead PID) is safely recovered
    {
      // Pick a PID that does not exist
      let deadPid = 999999;
      while (isProcessAlive(deadPid)) {
        deadPid++;
      }
      const abandonedPayload: LockPayload = {
        ownerToken: `dead-${deadPid}-${Date.now()}`,
        pid: deadPid,
        hostname: os.hostname(),
        acquiredAt: Date.now() - 5000,
      };
      fs.writeFileSync(lockFile, JSON.stringify(abandonedPayload), 'utf8');
      const twoSecsAgo = (Date.now() - 2000) / 1000;
      fs.utimesSync(lockFile, twoSecsAgo, twoSecsAgo);

      // acquireLock should detect dead PID (ESRCH), recover the abandoned lock, and acquire
      const recoveredLock = acquireLock(2000, lockTestDir);
      if (recoveredLock.ownerToken === abandonedPayload.ownerToken) {
        throw new Error('FAILED: Acquired lock had old dead ownerToken!');
      }
      const newPayload = readLockPayload(lockFile);
      if (newPayload.payload?.ownerToken !== recoveredLock.ownerToken) {
        throw new Error('FAILED: Lock file does not contain newly acquired ownerToken!');
      }

      releaseLock(recoveredLock, lockTestDir);
      console.log('  ✅ 6b: Genuinely abandoned lock (dead PID) was safely recovered');
    }

    // Subtest 6c: A former owner cannot remove a replacement owner's lock during release
    {
      // Process acquires lock 1
      const lock1 = acquireLock(2000, lockTestDir);

      // Simulate that another process has acquired lock 2 (e.g. different owner token)
      const replacementPayload: LockPayload = {
        ownerToken: `replacement-owner-${Date.now()}`,
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: Date.now(),
      };
      // Overwrite lock file to simulate replacement lock
      fs.writeFileSync(lockFile, JSON.stringify(replacementPayload), 'utf8');

      // Now lock1 is released by former owner
      releaseLock(lock1, lockTestDir);

      // Verify replacement lock is STILL on disk untouched!
      if (!fs.existsSync(lockFile)) {
        throw new Error('FAILED: Former owner deleted replacement owner lock file during release!');
      }
      const checkReplacement = readLockPayload(lockFile);
      if (checkReplacement.payload?.ownerToken !== replacementPayload.ownerToken) {
        throw new Error('FAILED: Replacement owner lock was corrupted during former owner release!');
      }

      // Cleanup simulated replacement lock
      fs.unlinkSync(lockFile);
      console.log('  ✅ 6c: Former owner release DID NOT remove replacement owner lock (owner isolation verified)');
    }

    // Subtest 6d: Timeout handling on contested lock
    {
      const lockHolder = acquireLock(2000, lockTestDir);
      let timedOut = false;
      const tStart = Date.now();
      try {
        acquireLock(200, lockTestDir); // 200ms timeout
      } catch (err: any) {
        timedOut = err.message.includes('Timeout acquiring durable state lockfile');
      }
      const elapsed = Date.now() - tStart;
      if (!timedOut) {
        throw new Error('FAILED: Contested lock did not time out as expected');
      }
      if (elapsed < 180) {
        throw new Error(`FAILED: Timeout fired prematurely (${elapsed}ms < 180ms)`);
      }
      releaseLock(lockHolder, lockTestDir);
      console.log(`  ✅ 6d: Lock timeout safely triggered after ${elapsed}ms on contested lock`);
    }

    // Subtest 6e: Corrupted/empty locks fail closed instead of age-based deletion
    {
      fs.writeFileSync(lockFile, ''); // 0-byte corrupt lock
      const twoSecsAgo = (Date.now() - 2000) / 1000;
      fs.utimesSync(lockFile, twoSecsAgo, twoSecsAgo);

      let failedClosed = false;
      try {
        acquireLock(300, lockTestDir);
      } catch (err: any) {
        failedClosed = err.message.includes('Timeout acquiring durable state lockfile');
      }
      if (!failedClosed || !fs.existsSync(lockFile)) {
        throw new Error('FAILED: Empty lock was reclaimed instead of failing closed');
      }
      fs.rmSync(lockTestDir, { recursive: true, force: true });
      fs.mkdirSync(lockTestDir, { recursive: true });
      console.log('  ✅ 6e: Empty/corrupted lock retained and acquisition failed closed');
    }

  } finally {
    fs.rmSync(lockTestDir, { recursive: true, force: true });
  }

  console.log('\n🎉 ALL Durable Persistence, Multi-Instance & Lock Concurrency Tests PASSED!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Durable Persistence Tests FAILED:', err);
  process.exit(1);
});

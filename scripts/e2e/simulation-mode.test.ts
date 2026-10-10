/**
 * Offline / Local Simulation Mode Integration Test
 * Verifies that when running in SIMULATION_MODE (or when no local Anvil/contract is reachable),
 * the access-service and frontend simulation flow operate consistently:
 * - /health returns mode: 'simulation' and activeSettlement: null
 * - Gated segment requests with simulated sessions and vouchers succeed
 * - Encrypted/gated media content is delivered and cryptographically verified
 * - No on-chain validation is attempted (no Anvil required)
 *
 * Usage: npx tsx scripts/e2e/simulation-mode.test.ts
 */

import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { privateKeyToAccount } from 'viem/accounts';
import { type Hex } from 'viem';

const TEST_PORT = 4099;
const ACCESS_URL = `http://127.0.0.1:${TEST_PORT}`;
const MOCK_SIGNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url: string, maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(250);
  }
  return false;
}

async function main() {
  console.log('\n🧪 Starting StreamPay Offline Simulation Mode Test (No Anvil / No Contract)...\n');

  // 1. Spawn access service in explicit SIMULATION_MODE on TEST_PORT
  const serviceProc: ChildProcess = spawn(
    'node',
    [path.join(__dirname, '../../access-service/dist/server.js')],
    {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        SIMULATION_MODE: 'true',
        SETTLEMENT_ADDRESS: '',
        NETWORK: 'local',
        ENABLE_TEST_CLOCK: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  serviceProc.stdout?.on('data', (d) => process.stdout.write(`  [service] ${d}`));
  serviceProc.stderr?.on('data', (d) => process.stderr.write(`  [service-err] ${d}`));

  try {
    const isReady = await waitForServer(ACCESS_URL);
    if (!isReady) throw new Error('Access service failed to start in simulation mode');

    // 2. Verify health endpoint reports simulation mode
    console.log('Step 1: Checking /health reports simulation mode...');
    const healthRes = await fetch(`${ACCESS_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health returned ${healthRes.status}`);
    const health = await healthRes.json();
    if (health.mode !== 'simulation' || health.isSimulation !== true) {
      throw new Error(`Expected mode: 'simulation', got ${JSON.stringify(health)}`);
    }
    if (health.activeSettlement !== null) {
      throw new Error(`Expected activeSettlement to be null in simulation mode, got ${health.activeSettlement}`);
    }
    console.log(`  ✅ /health confirms: mode='${health.mode}', isSimulation=${health.isSimulation}, activeSettlement=null`);

    // 3. Fetch manifest for monad-keynote-hd
    console.log('\nStep 2: Fetching stream manifest...');
    const manifestRes = await fetch(`${ACCESS_URL}/api/manifest/monad-keynote-hd`);
    if (!manifestRes.ok) throw new Error(`Manifest returned ${manifestRes.status}`);
    const manifest = await manifestRes.json();
    console.log(`  ✅ Loaded manifest: streamId=${manifest.streamId}, segments=${manifest.segments.length}`);

    // 4. Construct simulated session and sign EIP-712 voucher
    console.log('\nStep 3: Constructing simulated session & signing off-chain voucher...');
    const simAccount = privateKeyToAccount(MOCK_SIGNER_KEY);
    const simSessionId = ('0x' + 'aa'.repeat(32)) as Hex;
    const simContract = ('0x' + '00'.repeat(19) + '01') as Hex;

    const voucherDomain = {
      name: 'StreamPaySettlement',
      version: '2.5',
      chainId: 31337n,
      verifyingContract: simContract,
    } as const;

    const voucherTypes = {
      Voucher: [
        { name: 'sessionId', type: 'bytes32' },
        { name: 'cumulativeUnits', type: 'uint64' },
      ],
    } as const;

    const simSignature = await simAccount.signTypedData({
      domain: voucherDomain,
      types: voucherTypes,
      primaryType: 'Voucher',
      message: {
        sessionId: simSessionId,
        cumulativeUnits: 2n,
      },
    });
    console.log('  ✅ Simulated EIP-712 voucher signed successfully');

    // 5. Request gated segment 0 token in simulation mode
    console.log('\nStep 4: Requesting segment 0 through simulation gate...');
    const gateRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: simSessionId,
        sessionSigner: simAccount.address,
        contractAddress: simContract,
        streamId: 'monad-keynote-hd',
        segmentIndex: 0,
        voucher: {
          sessionId: simSessionId,
          cumulativeUnits: '2',
          signature: simSignature,
        },
      }),
    });

    if (!gateRes.ok) {
      const errBody = await gateRes.text();
      throw new Error(`Simulation gate rejected request: ${gateRes.status} - ${errBody}`);
    }
    const gateData = await gateRes.json();
    if (!gateData.granted && !gateData.success) {
      throw new Error(`Gate response missing granted/success: ${JSON.stringify(gateData)}`);
    }
    console.log(`  ✅ Simulation access granted: token=${gateData.segmentToken.slice(0, 16)}...`);

    // 6. Fetch content using the granted token and verify media bytes
    console.log('\nStep 5: Fetching media content with simulation token...');
    const contentRes = await fetch(`${ACCESS_URL}${gateData.contentUrl}`);
    if (!contentRes.ok) throw new Error(`Content route returned ${contentRes.status}`);
    const bytes = Buffer.from(await contentRes.arrayBuffer());
    const actualSha = ('0x' + crypto.createHash('sha256').update(bytes).digest('hex')) as Hex;

    const seg0 = manifest.segments[0];
    if (actualSha.toLowerCase() !== seg0.segmentSha256.toLowerCase()) {
      throw new Error(`SHA-256 mismatch in simulation delivery! Expected ${seg0.segmentSha256}, got ${actualSha}`);
    }
    console.log(`  ✅ Verified media bytes delivered in simulation mode (SHA-256: ${actualSha})`);

    // 7. Expired token retry verification under controlled clock in simulation mode
    console.log('\nStep 6: Testing expired-token replacement under controlled clock in simulation mode...');
    const simSignature1 = await simAccount.signTypedData({
      domain: voucherDomain,
      types: voucherTypes,
      primaryType: 'Voucher',
      message: {
        sessionId: simSessionId,
        cumulativeUnits: 4n,
      },
    });

    const baseTimeMs = 1700000000000;
    const testTtlSec = 20;

    // 6.1: Initial token A at baseTimeMs
    const reqA = await fetch(`${ACCESS_URL}/api/access/segment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-simulated-time-ms': baseTimeMs.toString(),
        'x-test-ttl-sec': testTtlSec.toString(),
      },
      body: JSON.stringify({
        sessionId: simSessionId,
        sessionSigner: simAccount.address,
        contractAddress: simContract,
        streamId: 'monad-keynote-hd',
        segmentIndex: 1,
        voucher: {
          sessionId: simSessionId,
          cumulativeUnits: '4',
          signature: simSignature1,
        },
      }),
    });
    if (!reqA.ok) throw new Error(`Gate rejected segment 1 initial request: ${reqA.status}`);
    const dataA = await reqA.json();
    const tokenA = dataA.segmentToken;

    // 6.2: Duplicate request before expiry reuses active token A
    const reqDup = await fetch(`${ACCESS_URL}/api/access/segment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-simulated-time-ms': (baseTimeMs + 5000).toString(),
        'x-test-ttl-sec': testTtlSec.toString(),
      },
      body: JSON.stringify({
        sessionId: simSessionId,
        sessionSigner: simAccount.address,
        contractAddress: simContract,
        streamId: 'monad-keynote-hd',
        segmentIndex: 1,
        voucher: {
          sessionId: simSessionId,
          cumulativeUnits: '4',
          signature: simSignature1,
        },
      }),
    });
    const dataDup = await reqDup.json();
    if (dataDup.segmentToken !== tokenA) {
      throw new Error('Unexpired duplicate request should have reused active token A');
    }
    console.log('  ✅ Unexpired duplicate request correctly returned active token A');

    // 6.3: Advance clock past expiry (baseTimeMs + 25s > 20s TTL)
    const expiredTimeMs = baseTimeMs + 25000;
    const reqB = await fetch(`${ACCESS_URL}/api/access/segment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-simulated-time-ms': expiredTimeMs.toString(),
        'x-test-ttl-sec': testTtlSec.toString(),
      },
      body: JSON.stringify({
        sessionId: simSessionId,
        sessionSigner: simAccount.address,
        contractAddress: simContract,
        streamId: 'monad-keynote-hd',
        segmentIndex: 1,
        voucher: {
          sessionId: simSessionId,
          cumulativeUnits: '4',
          signature: simSignature1,
        },
      }),
    });
    if (!reqB.ok) throw new Error(`Retry after expiry failed: ${reqB.status}`);
    const dataB = await reqB.json();
    const tokenB = dataB.segmentToken;
    if (!tokenB || tokenB === tokenA) {
      throw new Error('Expected replacement token B to differ from expired token A');
    }
    console.log('  ✅ Expired reservation pruned; replacement token B granted (tokenB != tokenA)');

    // 6.4: Expired token A is rejected at /content
    const expContentRes = await fetch(`${ACCESS_URL}/api/access/content/monad-keynote-hd/segment_1.ts?token=${encodeURIComponent(tokenA)}`, {
      headers: { 'x-test-simulated-time-ms': expiredTimeMs.toString() },
    });
    if (expContentRes.status !== 403) {
      throw new Error(`Expected 403 for expired token A, got ${expContentRes.status}`);
    }
    console.log('  ✅ Expired token A strictly rejected with 403 Forbidden');

    // 6.5: Fetch content with replacement token B
    const contentResB = await fetch(`${ACCESS_URL}${dataB.contentUrl}`, {
      headers: { 'x-test-simulated-time-ms': expiredTimeMs.toString() },
    });
    if (!contentResB.ok) throw new Error(`Content route failed with token B: ${contentResB.status}`);
    const bytesB = Buffer.from(await contentResB.arrayBuffer());
    const shaB = ('0x' + crypto.createHash('sha256').update(bytesB).digest('hex')) as Hex;
    const seg1 = manifest.segments[1];
    if (shaB.toLowerCase() !== seg1.segmentSha256.toLowerCase()) {
      throw new Error(`SHA-256 mismatch for segment 1! Expected ${seg1.segmentSha256}, got ${shaB}`);
    }
    console.log(`  ✅ Media bytes delivered and verified with token B (SHA-256: ${shaB})`);

    // 6.6: Subsequent retry for delivered segment must fail
    const reqDelivered = await fetch(`${ACCESS_URL}/api/access/segment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-simulated-time-ms': (expiredTimeMs + 1000).toString(),
        'x-test-ttl-sec': testTtlSec.toString(),
      },
      body: JSON.stringify({
        sessionId: simSessionId,
        sessionSigner: simAccount.address,
        contractAddress: simContract,
        streamId: 'monad-keynote-hd',
        segmentIndex: 1,
        voucher: {
          sessionId: simSessionId,
          cumulativeUnits: '4',
          signature: simSignature1,
        },
      }),
    });
    if (reqDelivered.status !== 400 && reqDelivered.status !== 402) {
      throw new Error(`Expected rejection for already-delivered segment, got ${reqDelivered.status}`);
    }
    console.log('  ✅ Re-request for delivered segment rejected (no duplicate delivery)');

    console.log('\n🎉 Explicit Simulation Mode (Part 1) PASSED!\n');
  } finally {
    serviceProc.kill('SIGTERM');
  }

  // ═════════════════════════════════════════════════════════════════════
  // Part 2: Automatic Fallback Test (configured settlement, dead RPC)
  // ═════════════════════════════════════════════════════════════════════
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('🧪 Part 2: Testing automatic fallback when SETTLEMENT_ADDRESS is set but local RPC is unreachable...');
  const FALLBACK_PORT = 4098;
  const FALLBACK_URL = `http://127.0.0.1:${FALLBACK_PORT}`;

  const fallbackProc: ChildProcess = spawn(
    'node',
    [path.join(__dirname, '../../access-service/dist/server.js')],
    {
      env: {
        ...process.env,
        PORT: String(FALLBACK_PORT),
        NETWORK: 'local',
        RPC_URL: 'http://127.0.0.1:9999', // Dead RPC port
        SETTLEMENT_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        SIMULATION_MODE: '',
        ENABLE_TEST_CLOCK: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  fallbackProc.stdout?.on('data', (d) => process.stdout.write(`  [fallback] ${d}`));
  fallbackProc.stderr?.on('data', (d) => process.stderr.write(`  [fallback-err] ${d}`));

  try {
    const ready = await waitForServer(FALLBACK_URL, 40);
    if (!ready) throw new Error('Fallback server did not start within timeout');

    const healthRes = await fetch(`${FALLBACK_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    const healthData = await healthRes.json();

    if (healthData.mode !== 'simulation' || !healthData.isSimulation || healthData.activeSettlement !== null) {
      throw new Error(`Automatic fallback failed: expected simulation mode with null activeSettlement, got: ${JSON.stringify(healthData)}`);
    }
    console.log('  ✅ Automatic fallback verified: /health reports mode=simulation and activeSettlement=null');

    // Verify simulation gating works in automatic fallback mode
    const simAccount = privateKeyToAccount(MOCK_SIGNER_KEY);
    const voucherDomain = {
      name: 'StreamPaySettlement',
      version: '2.5',
      chainId: 31337,
      verifyingContract: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Hex,
    };
    const voucherTypes = {
      Voucher: [
        { name: 'sessionId', type: 'bytes32' },
        { name: 'cumulativeUnits', type: 'uint64' },
      ],
    };
    const simSessionId = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex;
    const simSig = await simAccount.signTypedData({
      domain: voucherDomain,
      types: voucherTypes,
      primaryType: 'Voucher',
      message: { sessionId: simSessionId, cumulativeUnits: 2n },
    });

    const gateRes = await fetch(`${FALLBACK_URL}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: simSessionId,
        sessionSigner: simAccount.address,
        contractAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        streamId: 'monad-keynote-hd',
        segmentIndex: 0,
        voucher: { sessionId: simSessionId, cumulativeUnits: '2', signature: simSig },
      }),
    });
    if (!gateRes.ok) throw new Error(`Fallback gate request failed: ${gateRes.status}`);
    const gateData = await gateRes.json();
    if (!gateData.granted || !gateData.segmentToken) throw new Error('Fallback gate did not grant access');
    console.log('  ✅ Simulation access granted under automatic fallback mode');
    console.log('\n🎉 Automatic Fallback Test (Part 2) PASSED!\n');
  } finally {
    fallbackProc.kill('SIGTERM');
  }

  // ═════════════════════════════════════════════════════════════════════
  // Part 3: Hard Production Prohibition Test
  // ═════════════════════════════════════════════════════════════════════
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('🧪 Part 3: Testing hard production prohibition for ENABLE_TEST_CLOCK...');
  const prodProc: ChildProcess = spawn(
    'node',
    [path.join(__dirname, '../../access-service/dist/server.js')],
    {
      env: {
        ...process.env,
        PORT: '4097',
        NODE_ENV: 'production',
        ENABLE_TEST_CLOCK: 'true',
        NETWORK: 'local',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let prodStderr = '';
  prodProc.stderr?.on('data', (d) => { prodStderr += d.toString(); });

  const prodExitCode = await new Promise<number | null>((resolve) => {
    prodProc.on('exit', (code) => resolve(code));
    setTimeout(() => {
      prodProc.kill('SIGKILL');
      resolve(-1);
    }, 4000);
  });

  if (prodExitCode !== 1) {
    throw new Error(`Expected production process to exit with code 1, got exit code: ${prodExitCode}`);
  }
  if (!prodStderr.includes('strictly forbidden when NODE_ENV=production')) {
    throw new Error(`Expected production prohibition error in stderr, got: ${prodStderr}`);
  }
  console.log('  ✅ Production prohibition verified: Server refused startup with code 1 and fatal error');
  console.log('\n🎉 ALL Simulation & Hardening Tests PASSED!\n');
}

main().catch((err) => {
  console.error('\n❌ Simulation Mode Test Failed:', err);
  process.exit(1);
});

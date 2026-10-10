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

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(200);
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

    console.log('\n🎉 Simulation Mode End-to-End Test PASSED!\n');
  } finally {
    serviceProc.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('\n❌ Simulation Mode Test Failed:', err);
  process.exit(1);
});

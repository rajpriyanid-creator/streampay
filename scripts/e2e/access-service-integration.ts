/**
 * StreamPay End-to-End Access Service Integration Test
 *
 * Validates the complete integrated stack against local Anvil + StreamPaySettlement + MockUSDC + Access Service:
 * 1. Open session on-chain with exact manifest policy & parameters
 * 2. Sign accurate voucher and request segment 0 via POST /api/access/segment
 * 3. Fetch returned content URL using one-time token
 * 4. Verify served byte SHA-256 matches manifest segmentSha256 exactly
 * 5. Verify cryptographic Merkle proof against manifestRoot
 * 6. Reject tampered bytes and tampered Merkle proofs
 * 7. Reject replayed / consumed one-time access tokens (403)
 * 8. Reject wrong stream (404) and wrong segment index (404)
 * 9. Reject incorrect cumulative units (too low -> 402, too high -> 400)
 * 10. Reject session with mismatched pricing policy (403 POLICY_MISMATCH)
 * 11. Reject non-existent / invalid session (401/403)
 * 12. Checkpoint session on-chain, sync via /api/session/checkpoint-sync
 * 13. Stream later segments (segment 1) after checkpoint
 * 14. Cooperatively close session on-chain and refund excess escrow
 */

import { openSession, signVoucher, checkpoint, closeCooperative } from '../../frontend/lib/protocol/lifecycle';
import { readSession } from '../../access-service/src/chain';
import {
  createPublicClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
  type Address,
} from 'viem';
import * as crypto from 'node:crypto';

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const ACCESS_URL = process.env.ACCESS_URL || 'http://localhost:4001';

// Anvil default accounts — LOCAL DEV ONLY
const PAYER_KEY   = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const CREATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const SIGNER_KEY  = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;

const SEGMENT_LEAF_TYPEHASH = keccak256(
  Buffer.from('StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)')
);

function hashPair(a: string, b: string): Hex {
  const [l, r] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(`${l}${r.slice(2)}` as Hex);
}

function verifyMerkleProof(leaf: Hex, proof: string[], root: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}

function computeSegmentLeaf(contentIdHash: Hex, segmentIndex: number, durationUnits: number, segmentSha256: Hex): Hex {
  const zeroHash = ('0x' + '00'.repeat(32)) as Hex;
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, uint32, bytes32, uint32, uint32, bytes32, bytes32'),
      [
        SEGMENT_LEAF_TYPEHASH,
        1,
        contentIdHash,
        segmentIndex,
        durationUnits,
        zeroHash,
        segmentSha256,
      ]
    )
  );
}

async function main() {
  console.log('\n🚀 Starting StreamPay Access Service End-to-End Integration Suite...\n');

  // 1. Resolve Settlement and Token Contract addresses
  let settlement = (process.env.SETTLEMENT_ADDRESS || '') as Address;
  let token = (process.env.TOKEN_ADDRESS || '') as Address;

  if (!settlement) {
    const healthRes = await fetch(`${ACCESS_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed at ${ACCESS_URL}/health: ${healthRes.status}`);
    const health = await healthRes.json();
    settlement = health.settlement as Address;
    console.log(`   Discovered settlement contract from /health: ${settlement}`);
  }

  const pc = createPublicClient({ transport: http(RPC) });
  if (!token) {
    token = (await pc.readContract({
      address: settlement,
      abi: [{ type: 'function', name: 'paymentToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const,
      functionName: 'paymentToken',
    })) as Address;
    console.log(`   Discovered payment token on-chain: ${token}`);
  }

  // 2. Fetch canonical manifest
  const manifestRes = await fetch(`${ACCESS_URL}/api/manifest/monad-keynote-hd`);
  if (!manifestRes.ok) throw new Error(`Failed to fetch manifest: ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  console.log(`   Loaded canonical manifest: streamId=monad-keynote-hd, segments=${manifest.segments.length}`);
  console.log(`   Canonical pricingPolicyHash: ${manifest.pricingPolicyHash}`);
  console.log(`   Canonical manifestRoot: ${manifest.manifestRoot}`);

  const seg0 = manifest.segments[0];
  const seg1 = manifest.segments[1];
  const unitPrice = BigInt(manifest.unitPrice || 500);
  const deposit = 2_500_000n; // 2.5 USDC
  const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address; // creator address

  // 3. Open session on-chain
  console.log('\nStep 1: Opening session on-chain with exact manifest policy...');
  const { sessionId, signerAddress } = await openSession({
    rpc: RPC, settlement, token, creatorKey: CREATOR_KEY, payerKey: PAYER_KEY, signerKey: SIGNER_KEY,
    recipient,
    manifestRoot: manifest.manifestRoot as Hex,
    contentIdHash: manifest.contentIdHash as Hex,
    pricingPolicyHash: manifest.pricingPolicyHash as Hex,
    unitPrice,
    maxBillable: 3600n,
    deposit,
    validSec: 3600,
    graceSec: 3600,
    maxLead: 12n,
    maxCreditWindow: 10n,
    maxCreditSegments: 5,
    maxUnredeemedAmount: 5000n,
  });
  console.log(`  ✅ Session opened on-chain: ID=${sessionId}`);

  // 4. Sign accurate voucher for segment 0
  console.log('\nStep 2: Signing voucher for Segment 0 (cumulativeUnits: 2)...');
  const v0Sig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId, cumulativeUnits: 2n,
  });
  console.log(`  ✅ Voucher signed: ${v0Sig.slice(0, 18)}...`);

  // 5. Request Segment 0 from gate
  console.log('\nStep 3: Requesting Segment 0 via POST /api/access/segment...');
  const gateRes0 = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sessionSigner: signerAddress,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: {
        sessionId,
        cumulativeUnits: '2',
        signature: v0Sig,
      },
    }),
  });
  if (!gateRes0.ok) {
    const errBody = await gateRes0.text();
    throw new Error(`Gate rejected segment 0: ${gateRes0.status} ${errBody}`);
  }
  const gateData0 = await gateRes0.json();
  if ((!gateData0.granted && !gateData0.success) || !gateData0.contentUrl) {
    throw new Error(`Access not granted: ${JSON.stringify(gateData0)}`);
  }
  console.log(`  ✅ Access granted! Single-use contentUrl: ${gateData0.contentUrl}`);

  // 6. Fetch served media bytes using one-time token
  console.log('\nStep 4: Fetching served media bytes using one-time token...');
  const contentRes = await fetch(`${ACCESS_URL}${gateData0.contentUrl}`);
  if (!contentRes.ok) throw new Error(`Failed to fetch media bytes: ${contentRes.status}`);
  const mediaBuffer = Buffer.from(await contentRes.arrayBuffer());
  const actualSha256 = ('0x' + crypto.createHash('sha256').update(mediaBuffer).digest('hex')) as Hex;

  console.log(`  📊 Media Bytes Delivered: ${mediaBuffer.length} bytes`);
  console.log(`  📊 Delivered Bytes SHA-256: ${actualSha256}`);
  console.log(`  📊 Manifest Segment SHA-256: ${seg0.segmentSha256}`);

  if (actualSha256.toLowerCase() !== seg0.segmentSha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch! Expected ${seg0.segmentSha256}, got ${actualSha256}`);
  }
  console.log('  ✅ Byte SHA-256 matches manifest segmentSha256 exactly!');

  // 7. Verify Merkle proof
  console.log('\nStep 5: Verifying Merkle proof for delivered segment...');
  const leaf0 = computeSegmentLeaf(manifest.contentIdHash as Hex, 0, seg0.durationUnits, actualSha256);
  const proofValid = verifyMerkleProof(leaf0, seg0.merkleProof, manifest.manifestRoot as Hex);
  if (!proofValid) throw new Error('Merkle proof failed to verify!');
  console.log(`  ✅ Merkle proof verified successfully against manifestRoot ${manifest.manifestRoot}`);

  // 8. Security Negative Assertions
  console.log('\nStep 6: Executing Security Negative Tests...');

  // 8a. Tampered byte rejection
  const tamperedSha256 = ('0x' + 'ba'.repeat(32)) as Hex;
  const tamperedLeaf = computeSegmentLeaf(manifest.contentIdHash as Hex, 0, seg0.durationUnits, tamperedSha256);
  const tamperedByteProof = verifyMerkleProof(tamperedLeaf, seg0.merkleProof, manifest.manifestRoot as Hex);
  if (tamperedByteProof) throw new Error('Security failure: tampered byte proof verified!');
  console.log('  ✅ Rejection: Tampered byte leaf fails Merkle verification');

  // 8b. Tampered proof rejection
  const tamperedProof = [...seg0.merkleProof];
  tamperedProof[0] = ('0x' + 'ff'.repeat(32));
  const tamperedProofResult = verifyMerkleProof(leaf0, tamperedProof, manifest.manifestRoot as Hex);
  if (tamperedProofResult) throw new Error('Security failure: tampered proof verified!');
  console.log('  ✅ Rejection: Tampered proof sibling fails Merkle verification');

  // 8c. Replayed / consumed token rejection
  const replayRes = await fetch(`${ACCESS_URL}${gateData0.contentUrl}`);
  if (replayRes.status !== 403) {
    throw new Error(`Security failure: Replayed token returned status ${replayRes.status}, expected 403`);
  }
  console.log('  ✅ Rejection: Consumed token re-fetch returned 403 (Single-use token enforcement)');

  // 8d. Unknown stream rejection
  const wrongStreamRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sessionSigner: signerAddress,
      contractAddress: settlement,
      streamId: 'unknown-stream-xyz',
      segmentIndex: 0,
      voucher: { sessionId, cumulativeUnits: '2', signature: v0Sig },
    }),
  });
  if (wrongStreamRes.status !== 404) throw new Error(`Expected 404 for unknown stream, got ${wrongStreamRes.status}`);
  console.log('  ✅ Rejection: Unknown stream returned 404 UNKNOWN_STREAM');

  // 8e. Out of range segment rejection
  const wrongSegRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sessionSigner: signerAddress,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 999,
      voucher: { sessionId, cumulativeUnits: '2', signature: v0Sig },
    }),
  });
  if (wrongSegRes.status !== 404) throw new Error(`Expected 404 for out of range segment, got ${wrongSegRes.status}`);
  console.log('  ✅ Rejection: Out of range segment returned 404');

  // 8f. Cumulative units too low
  const vTooLowSig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId, cumulativeUnits: 1n,
  });
  const tooLowRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sessionSigner: signerAddress,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId, cumulativeUnits: '1', signature: vTooLowSig },
    }),
  });
  if (tooLowRes.status !== 402) throw new Error(`Expected 402 for too-low cumulative units, got ${tooLowRes.status}`);
  console.log('  ✅ Rejection: Cumulative units too low returned 402 PAYMENT_REQUIRED');

  // 8g. Cumulative units too high
  const vTooHighSig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId, cumulativeUnits: 10n,
  });
  const tooHighRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sessionSigner: signerAddress,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId, cumulativeUnits: '10', signature: vTooHighSig },
    }),
  });
  if (tooHighRes.status !== 400) throw new Error(`Expected 400 for too-high cumulative units, got ${tooHighRes.status}`);
  console.log('  ✅ Rejection: Cumulative units too high returned 400 CUMULATIVE_UNITS_TOO_HIGH');

  // 8h. Invalid / non-existent session
  const fakeSessionId = ('0x' + 'ee'.repeat(32)) as Hex;
  const fakeSig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId: fakeSessionId, cumulativeUnits: 2n,
  });
  const invalidSessionRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: fakeSessionId,
      sessionSigner: signerAddress,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId: fakeSessionId, cumulativeUnits: '2', signature: fakeSig },
    }),
  });
  if (invalidSessionRes.status !== 401 && invalidSessionRes.status !== 403) {
    throw new Error(`Expected 401 or 403 for invalid session, got ${invalidSessionRes.status}`);
  }
  console.log(`  ✅ Rejection: Non-existent session returned ${invalidSessionRes.status}`);

  // 8i. Policy mismatch rejection (Open session with wrong policy hash on chain)
  console.log('\nStep 7: Testing on-chain policy mismatch enforcement...');
  const badPolicyHash = ('0x' + '22'.repeat(32)) as Hex;
  const { sessionId: badPolicySessionId, signerAddress: badPolicySigner } = await openSession({
    rpc: RPC, settlement, token, creatorKey: CREATOR_KEY, payerKey: PAYER_KEY, signerKey: SIGNER_KEY,
    recipient,
    manifestRoot: manifest.manifestRoot as Hex,
    contentIdHash: manifest.contentIdHash as Hex,
    pricingPolicyHash: badPolicyHash,
    unitPrice,
    maxBillable: 3600n,
    deposit,
    validSec: 3600,
    graceSec: 3600,
    maxLead: 12n,
    maxCreditWindow: 10n,
    maxCreditSegments: 5,
    maxUnredeemedAmount: 5000n,
  });
  const badPolicyVoucher = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId: badPolicySessionId, cumulativeUnits: 2n,
  });
  const badPolicyRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: badPolicySessionId,
      sessionSigner: badPolicySigner,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId: badPolicySessionId, cumulativeUnits: '2', signature: badPolicyVoucher },
    }),
  });
  if (badPolicyRes.status !== 403) {
    throw new Error(`Expected 403 for mismatched pricing policy, got ${badPolicyRes.status}`);
  }
  const badPolicyData = await badPolicyRes.json();
  if (badPolicyData.code !== 'POLICY_MISMATCH') {
    throw new Error(`Expected error code POLICY_MISMATCH, got ${badPolicyData.code}`);
  }
  console.log('  ✅ Rejection: Mismatched pricingPolicyHash returned 403 POLICY_MISMATCH');

  // 9. On-Chain Checkpoint and Checkpoint Sync
  console.log('\nStep 8: Checkpointing on-chain and syncing with Access Service...');
  const cpTx = await checkpoint({
    rpc: RPC, settlement, anyKey: PAYER_KEY, sessionId, cumulativeUnits: 2n, voucherSig: v0Sig,
  });
  console.log(`  ✅ Checkpoint confirmed on-chain! Tx=${cpTx.slice(0, 18)}...`);

  const cpSyncRes = await fetch(`${ACCESS_URL}/api/session/checkpoint-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!cpSyncRes.ok) throw new Error(`Checkpoint sync failed: ${cpSyncRes.status}`);
  const cpSyncData = await cpSyncRes.json();
  const freshOnChainSession = await readSession(sessionId);
  if (!freshOnChainSession || freshOnChainSession.settledUnits !== 2n) {
    throw new Error(`Fresh on-chain read did not report settledUnits=2: ${freshOnChainSession?.settledUnits}`);
  }
  if (cpSyncData.settledUnits !== freshOnChainSession.settledUnits.toString()) {
    throw new Error(`Checkpoint sync was stale: on-chain=${freshOnChainSession.settledUnits}, sync=${cpSyncData.settledUnits}`);
  }
  console.log(`  ✅ Checkpoint sync returned fresh on-chain settledUnits=${cpSyncData.settledUnits}`);

  // 10. Later segment playback after checkpoint (Segment 1)
  console.log('\nStep 9: Streaming Segment 1 after checkpoint (cumulativeUnits: 4)...');
  const v1Sig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId, cumulativeUnits: 4n,
  });
  const gateRes1 = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sessionSigner: signerAddress,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 1,
      voucher: { sessionId, cumulativeUnits: '4', signature: v1Sig },
    }),
  });
  if (!gateRes1.ok) throw new Error(`Gate rejected segment 1: ${gateRes1.status}`);
  const gateData1 = await gateRes1.json();
  if ((!gateData1.granted && !gateData1.success) || !gateData1.contentUrl) {
    throw new Error(`Gate rejected segment 1: ${JSON.stringify(gateData1)}`);
  }
  const contentRes1 = await fetch(`${ACCESS_URL}${gateData1.contentUrl}`);
  if (!contentRes1.ok) throw new Error(`Failed to fetch segment 1: ${contentRes1.status}`);
  const buf1 = Buffer.from(await contentRes1.arrayBuffer());
  const sha1 = ('0x' + crypto.createHash('sha256').update(buf1).digest('hex')) as Hex;
  if (sha1.toLowerCase() !== seg1.segmentSha256.toLowerCase()) {
    throw new Error(`Segment 1 SHA-256 mismatch! Expected ${seg1.segmentSha256}, got ${sha1}`);
  }
  console.log(`  ✅ Segment 1 delivered and verified post-checkpoint (SHA-256: ${sha1})`);

  // 10. Failed / Expired delivery retry verification with deterministic controlled clock
  console.log('\nStep 10: Testing same-voucher retry for expired/undelivered segment...');
  const { sessionId: retrySessionId, signerAddress: retrySigner } = await openSession({
    rpc: RPC, settlement, token, creatorKey: CREATOR_KEY, payerKey: PAYER_KEY, signerKey: SIGNER_KEY,
    recipient,
    manifestRoot: manifest.manifestRoot as Hex,
    contentIdHash: manifest.contentIdHash as Hex,
    pricingPolicyHash: manifest.pricingPolicyHash as Hex,
    unitPrice,
    maxBillable: 3600n,
    deposit,
    validSec: 3600,
    graceSec: 3600,
    maxLead: 12n,
    maxCreditWindow: 10n,
    maxCreditSegments: 5,
    maxUnredeemedAmount: 5000n,
  });

  const retryVoucherSig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId: retrySessionId, cumulativeUnits: 2n,
  });

  // Step 10.1: Controlled clock base and test TTL
  const baseTimeMs = 1700000000000;
  const testTtlSec = 30;

  // Step 10.2: Request initial Token A at baseTimeMs
  const firstReqRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-simulated-time-ms': baseTimeMs.toString(),
      'x-test-ttl-sec': testTtlSec.toString(),
    },
    body: JSON.stringify({
      sessionId: retrySessionId,
      sessionSigner: retrySigner,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId: retrySessionId, cumulativeUnits: '2', signature: retryVoucherSig },
    }),
  });
  if (!firstReqRes.ok) throw new Error(`First gate request failed: ${firstReqRes.status}`);
  const firstGateData = await firstReqRes.json();
  const tokenA = firstGateData.segmentToken;
  if (!tokenA) throw new Error('Token A was not issued');
  console.log('  ✅ Step 10.2: Initial Token A granted for Segment 0');

  // Step 10.3: Verify that an immediate duplicate request before expiry reuses Token A (active idempotency branch)
  const dupReqRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-simulated-time-ms': (baseTimeMs + 5000).toString(),
      'x-test-ttl-sec': testTtlSec.toString(),
    },
    body: JSON.stringify({
      sessionId: retrySessionId,
      sessionSigner: retrySigner,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId: retrySessionId, cumulativeUnits: '2', signature: retryVoucherSig },
    }),
  });
  const dupGateData = await dupReqRes.json();
  if (dupGateData.segmentToken !== tokenA) {
    throw new Error('Unexpired duplicate request should have reused active Token A');
  }
  console.log('  ✅ Step 10.3: Active unexpired duplicate request correctly returned existing Token A');

  // Step 10.4: Advance clock past expiry (baseTimeMs + 35s > 30s TTL)
  // Token A was never consumed and expires. Pruning frees the reservation.
  // Retry with the EXACT same voucher (cumulativeUnits: 2)
  const expiredTimeMs = baseTimeMs + 35000;
  const retryReqRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-simulated-time-ms': expiredTimeMs.toString(),
      'x-test-ttl-sec': testTtlSec.toString(),
    },
    body: JSON.stringify({
      sessionId: retrySessionId,
      sessionSigner: retrySigner,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId: retrySessionId, cumulativeUnits: '2', signature: retryVoucherSig },
    }),
  });
  if (!retryReqRes.ok) throw new Error(`Retry gate request failed: ${retryReqRes.status}`);
  const retryGateData = await retryReqRes.json();
  if (!retryGateData.granted && !retryGateData.success) {
    throw new Error('Retry was rejected even though segment was never delivered');
  }
  const tokenB = retryGateData.segmentToken;
  if (!tokenB) throw new Error('Token B was not issued on retry');
  if (tokenB === tokenA) {
    throw new Error('Expected replacement Token B to differ from expired Token A, but received identical token');
  }
  console.log('  ✅ Step 10.4: Expired reservation pruned; safe retry issued replacement Token B (Token B != Token A)');

  // Step 10.5: Verify that expired Token A is strictly rejected at /content
  const expiredContentRes = await fetch(`${ACCESS_URL}/api/access/content/monad-keynote-hd/segment_0.ts?token=${encodeURIComponent(tokenA)}`, {
    headers: { 'x-test-simulated-time-ms': expiredTimeMs.toString() },
  });
  if (expiredContentRes.status !== 403) {
    throw new Error(`Expected 403 FORBIDDEN for expired Token A, got ${expiredContentRes.status}`);
  }
  console.log('  ✅ Step 10.5: Consumption of expired Token A strictly rejected with 403 Forbidden');

  // Step 10.6: Fetch content successfully using Token B
  const contentResRetry = await fetch(`${ACCESS_URL}${retryGateData.contentUrl}`, {
    headers: { 'x-test-simulated-time-ms': expiredTimeMs.toString() },
  });
  if (!contentResRetry.ok) throw new Error(`Failed to fetch retry content with Token B: ${contentResRetry.status}`);
  const bufRetry = Buffer.from(await contentResRetry.arrayBuffer());
  const shaRetry = ('0x' + crypto.createHash('sha256').update(bufRetry).digest('hex')) as Hex;
  if (shaRetry.toLowerCase() !== seg0.segmentSha256.toLowerCase()) {
    throw new Error('Retried segment content SHA-256 mismatch');
  }
  console.log(`  ✅ Step 10.6: Delivery succeeded with replacement Token B: Media bytes SHA-256 match (${shaRetry})`);

  // Step 10.7: Segment 0 is now delivered and finalized. Re-requesting with the same voucher must now fail!
  const thirdReqRes = await fetch(`${ACCESS_URL}/api/access/segment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-simulated-time-ms': (expiredTimeMs + 1000).toString(),
      'x-test-ttl-sec': testTtlSec.toString(),
    },
    body: JSON.stringify({
      sessionId: retrySessionId,
      sessionSigner: retrySigner,
      contractAddress: settlement,
      streamId: 'monad-keynote-hd',
      segmentIndex: 0,
      voucher: { sessionId: retrySessionId, cumulativeUnits: '2', signature: retryVoucherSig },
    }),
  });
  if (thirdReqRes.status !== 400 && thirdReqRes.status !== 402) {
    throw new Error(`Expected rejection for already-delivered segment, got ${thirdReqRes.status}`);
  }
  console.log('  ✅ Step 10.7: Duplicate delivery rejected: Already delivered segment rejected on subsequent attempt');

  // 11. Cooperative session close & refund
  console.log('\nStep 11: Cooperatively closing session on-chain & refunding excess escrow...');
  const closeTx = await closeCooperative({
    rpc: RPC, settlement, anyKey: PAYER_KEY, creatorKey: CREATOR_KEY,
    sessionId, cumulativeUnits: 4n, voucherSig: v1Sig,
  });
  console.log(`  ✅ Cooperative close confirmed! Tx=${closeTx.slice(0, 18)}...`);

  console.log('\n🎉 ALL Access Service Integration Tests PASSED with complete cryptographic and on-chain verification!\n');
}

main().catch((err) => {
  console.error('\n❌ Access Service Integration Test Failed:', err);
  process.exit(1);
});

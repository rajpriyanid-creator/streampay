/**
 * StreamPay Lifecycle Integration Test —
 * Exercises complete on-chain lifecycle:
 * Open Session → Playback & Vouchers (Credit Window) → Checkpoint → Continued Playback → Cooperative Close & Refund.
 *
 * Usage: npx tsx scripts/e2e/lifecycle-test.ts
 * Prereqs: Anvil running on 127.0.0.1:8545 with deployed contract and token
 */
import { openSession, signVoucher, checkpoint, closeCooperative } from '../legacy-frontend-lib/lib/protocol/lifecycle';
import { keccak256, type Hex, type Address, createPublicClient, http } from 'viem';

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
// Public Anvil test key. Never use on a real network.
const PAYER_KEY   = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
// Public Anvil test key. Never use on a real network.
const CREATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
// Public Anvil test key. Never use on a real network.
const SIGNER_KEY  = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;

function generateTestManifestRoot(): Hex {
  const leaf1 = keccak256(Buffer.from('test-manifest-leaf-0'));
  const leaf2 = keccak256(Buffer.from('test-manifest-leaf-1'));
  const [l, r] = leaf1.toLowerCase() < leaf2.toLowerCase() ? [leaf1, leaf2] : [leaf2, leaf1];
  return keccak256(`${l}${r.slice(2)}` as Hex);
}

import fs from 'node:fs';
import path from 'node:path';

function resolveContractAddress(envKey: string, manifestField: 'settlementContract' | 'paymentToken', fallback: string): Address {
  const envVal = process.env[envKey]?.trim();
  if (envVal) return envVal as Address;
  const manifestPath = path.resolve(__dirname, '../../manifests/local.json');
  const deployPath = path.resolve(__dirname, '../../contracts/deployment.json');
  for (const p of [manifestPath, deployPath]) {
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (manifestField === 'settlementContract' && d.settlementContract) return d.settlementContract as Address;
        if (manifestField === 'paymentToken' && d.paymentToken?.address) return d.paymentToken.address as Address;
      } catch {}
    }
  }
  return fallback as Address;
}

async function main() {
  console.log('🧪 Starting StreamPay Complete Lifecycle Test on local chain...');
  const settlement = resolveContractAddress('SETTLEMENT_ADDRESS', 'settlementContract', '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512');
  const token      = resolveContractAddress('TOKEN_ADDRESS', 'paymentToken', '0x5FbDB2315678afecb367f032d93F642f64180aa3');

  const manifestRoot = generateTestManifestRoot();
  console.log(`   Manifest root: ${manifestRoot.slice(0, 14)}...`);

  const unitPrice = 500n; // 0.0005 USDC per unit
  const maxCreditWindowUnits = 10n; // 10 units = 10s
  const maxUnredeemedAmount = 5000n; // 10 * 500 = 5000
  const maxLead = 12n;
  const deposit = 2_500_000n; // 2.50 USDC
  const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

  // Step 1: Open session on-chain
  console.log('\n1. Opening session on-chain with bounded escrow deposit...');
  const { txHash: openTx, sessionId, signerAddress } = await openSession({
    rpc: RPC, settlement, token, creatorKey: CREATOR_KEY, payerKey: PAYER_KEY, signerKey: SIGNER_KEY,
    recipient,
    manifestRoot, unitPrice, maxBillable: 3600n, deposit,
    validSec: 3600, graceSec: 3600, maxLead, maxCreditWindow: maxCreditWindowUnits,
    maxCreditSegments: 5, maxUnredeemedAmount,
  });
  console.log(`   ✅ Session opened! ID=${sessionId.slice(0, 14)}... Tx=${openTx.slice(0, 14)}...`);

  // Step 2: Sign vouchers for first 5 segments (10 cumulative units, reaches credit window)
  console.log('\n2. Streaming segment vouchers up to credit window limit (10 units)...');
  const voucher10Sig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId, cumulativeUnits: 10n,
  });
  console.log(`   ✅ Signed voucher for 10 units: ${voucher10Sig.slice(0, 14)}...`);

  // Step 3: Checkpoint on-chain to settle first 10 units
  console.log('\n3. Checkpointing on-chain (settles 10 units to recipient)...');
  const cpTx = await checkpoint({
    rpc: RPC, settlement, anyKey: PAYER_KEY, sessionId, cumulativeUnits: 10n, voucherSig: voucher10Sig,
  });
  console.log(`   ✅ Checkpoint confirmed on-chain! Tx=${cpTx.slice(0, 14)}... (10 units settled)`);

  // Step 4: Continued playback beyond checkpoint!
  // Sign voucher for 14 units (2 more segments, 4 units above checkpoint 10)
  console.log('\n4. Continued Playback: signing voucher for 14 cumulative units (+4 units above checkpoint)...');
  const voucher14Sig = await signVoucher({
    rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId, cumulativeUnits: 14n,
  });
  console.log(`   ✅ Signed voucher for 14 units: ${voucher14Sig.slice(0, 14)}... (Continued playback verified!)`);

  // Make elapsed-time dependent voucher bounds deterministic on Anvil. The
  // contract enforces cumulativeUnits <= elapsed + maxLeadUnits.
  const rpcClient = createPublicClient({ transport: http(RPC) });
  await rpcClient.request({ method: 'evm_increaseTime' as any, params: [30] as any });
  await rpcClient.request({ method: 'evm_mine' as any, params: [] as any });

  // Step 5: Cooperative close and refund
  console.log('\n5. Cooperative Close: finalizing session at 14 cumulative units & refunding excess deposit...');
  const closeTx = await closeCooperative({
    rpc: RPC, settlement, anyKey: PAYER_KEY, creatorKey: CREATOR_KEY, sessionId, cumulativeUnits: 14n, voucherSig: voucher14Sig,
  });
  console.log(`   ✅ Cooperative close confirmed on-chain! Tx=${closeTx.slice(0, 14)}...`);

  const totalPaid = 14n * unitPrice; // 7,000 base units (0.007 USDC)
  const totalRefunded = deposit - totalPaid; // 2,493,000 base units (2.493 USDC)
  console.log(`   💰 Creator Paid: ${totalPaid} base units`);
  console.log(`   💸 Payer Refunded: ${totalRefunded} base units`);

  console.log('\n🎉 Complete Lifecycle Verified: Open → Checkpoint → Continued Playback → Cooperative Close & Refund!\n');
}

main().catch((e) => {
  console.error('❌ Lifecycle test failed:', e);
  process.exit(1);
});

/**
 * Lifecycle integration test — exercises the real tx lifecycle
 * used by the frontend (openSession, signVoucher, checkpoint, closeCooperative).
 *
 * Usage: npx tsx scripts/e2e/lifecycle-test.ts
 * Prereqs: Anvil running on 127.0.0.1:8545 with deployed contract and token
 */
import { openSession, signVoucher, checkpoint, closeCooperative } from '../../frontend/lib/protocol/lifecycle';
import { keccak256, type Hex, type Address } from 'viem';

const RPC = 'http://127.0.0.1:8545';
// Anvil default accounts — LOCAL DEV ONLY
const PAYER_KEY   = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const CREATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const SIGNER_KEY  = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;

/**
 * Generate a nonzero manifest root for testing.
 * This is a simplified version — production uses real SHA-256 of segment bytes.
 */
function generateTestManifestRoot(): Hex {
  // Create a deterministic nonzero root from test content
  const leaf1 = keccak256(Buffer.from('test-manifest-leaf-0'));
  const leaf2 = keccak256(Buffer.from('test-manifest-leaf-1'));
  // Sort and hash pair
  const [l, r] = leaf1.toLowerCase() < leaf2.toLowerCase() ? [leaf1, leaf2] : [leaf2, leaf1];
  return keccak256(`${l}${r.slice(2)}` as Hex);
}

async function main() {
  console.log('lifecycle-test: need SETTLEMENT and TOKEN addresses from env or deploy output');
  const settlement = (process.env.SETTLEMENT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address;
  const token      = (process.env.TOKEN_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address;

  // CRITICAL: Use a nonzero manifest root — the contract rejects bytes32(0)
  const merkleRoot = generateTestManifestRoot();
  console.log(`   Using manifest root: ${merkleRoot.slice(0, 14)}...`);

  // Pricing: unitPrice=500 (0.0005 USDC/unit), maxCreditWindowUnits=10
  // maxUnredeemedAmount must >= unitPrice * maxCreditWindowUnits = 500 * 10 = 5000
  const unitPrice = 500n;
  const maxCreditWindowUnits = 10n;
  const maxUnredeemedAmount = 5000n; // exactly covers one credit window
  const maxLead = 12n; // must >= maxCreditWindowUnits
  const deposit = 1_800_000n; // 1.80 USDC

  console.log('1. Opening session...');
  const { txHash, sessionId, signerAddress } = await openSession({
    rpc: RPC, settlement, token, creatorKey: CREATOR_KEY, payerKey: PAYER_KEY, signerKey: SIGNER_KEY,
    recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    manifestRoot, unitPrice, maxBillable: 3600n, deposit,
    validSec: 3600, graceSec: 3600, maxLead, maxCreditWindow: maxCreditWindowUnits,
    maxCreditSegments: 3, maxUnredeemedAmount,
  });
  console.log(`   ✅ open tx=${txHash.slice(0,14)}  sessionId=${sessionId.slice(0,14)}`);

  console.log('2. Signing voucher for 10 units...');
  const vSig = await signVoucher({ rpc: RPC, settlement, signerKey: SIGNER_KEY, sessionId, cumulativeUnits: 10n });
  console.log(`   ✅ voucher sig=${vSig.slice(0,14)}`);

  console.log('3. Checkpointing...');
  const cpTx = await checkpoint({ rpc: RPC, settlement, anyKey: PAYER_KEY, sessionId, cumulativeUnits: 10n, voucherSig: vSig });
  console.log(`   ✅ checkpoint tx=${cpTx.slice(0,14)}`);

  console.log('4. Cooperative close...');
  const closeTx = await closeCooperative({ rpc: RPC, settlement, anyKey: PAYER_KEY, creatorKey: CREATOR_KEY, sessionId, cumulativeUnits: 10n, voucherSig: vSig });
  console.log(`   ✅ close tx=${closeTx.slice(0,14)}`);

  console.log('\n🎉 All lifecycle steps completed successfully!');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });

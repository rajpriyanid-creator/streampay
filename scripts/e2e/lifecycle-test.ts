/**
 * Lifecycle integration test — exercises the real tx lifecycle
 * used by the frontend (openSession, signVoucher, checkpoint, closeCooperative).
 *
 * Usage: npx tsx scripts/e2e/lifecycle-test.ts
 * Prereqs: Anvil running on 127.0.0.1:8545 with deployed contract
 */
import { openSession, signVoucher, checkpoint, closeCooperative } from '../../frontend/lib/protocol/lifecycle';
import type { Hex, Address } from 'viem';

const RPC = 'http://127.0.0.1:8545';
// Anvil default accounts
const PAYER_KEY   = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const CREATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const SIGNER_KEY  = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;

async function main() {
  console.log('lifecycle-test: need SETTLEMENT and TOKEN addresses from env or deploy output');
  const settlement = (process.env.SETTLEMENT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address;
  const token      = (process.env.TOKEN_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address;
  const merkleRoot = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

  console.log('1. Opening session...');
  const { txHash, sessionId, signerAddress } = await openSession({
    rpc: RPC, settlement, token, creatorKey: CREATOR_KEY, payerKey: PAYER_KEY, signerKey: SIGNER_KEY,
    recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    manifestRoot: merkleRoot, unitPrice: 500n, maxBillable: 3600n, deposit: 1_800_000n,
    validSec: 3600, graceSec: 3600, maxLead: 12n, maxCreditWindow: 12n,
    maxCreditSegments: 3, maxUnredeemedAmount: 30_000n,
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

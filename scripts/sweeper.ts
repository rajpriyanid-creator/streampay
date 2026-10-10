/**
 * StreamPay v2.5 — Checkpointing, Close Watcher & Redemption Sweeper Worker
 *
 * Automated service that:
 * 1. Queries latest active vouchers from access-service (/api/vouchers).
 * 2. Monitors on-chain session state via StreamPaySettlement contract.
 * 3. Auto-checkpoints pending vouchers if un-settled.
 * 4. Defends against unilateral close requests by submitting latest voucher before challengeEndsAt.
 * 5. Finalizes expired or challenge-completed sessions.
 *
 * Usage: npx tsx scripts/sweeper.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const ACCESS_SERVICE_URL = process.env.ACCESS_SERVICE_URL || 'http://localhost:4001';
const SETTLEMENT_ADDRESS = (process.env.SETTLEMENT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address;
const RELAYER_KEY = (process.env.RELAYER_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex; // Anvil account #0

const publicClient = createPublicClient({ transport: http(RPC_URL) });
const account = privateKeyToAccount(RELAYER_KEY);
const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

const SESSION_STATUS = { NONE: 0, OPEN: 1, CLOSE_REQUESTED: 2, CLOSED: 3 } as const;

const settlementAbi = [
  {
    type: 'function', name: 'getSession', stateMutability: 'view',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'payer', type: 'address' }, { name: 'sessionSigner', type: 'address' }, { name: 'recipient', type: 'address' },
      { name: 'offerDigest', type: 'bytes32' }, { name: 'contentIdHash', type: 'bytes32' }, { name: 'pricingPolicyHash', type: 'bytes32' },
      { name: 'manifestRoot', type: 'bytes32' }, { name: 'initialDeposit', type: 'uint256' }, { name: 'unitPrice', type: 'uint256' },
      { name: 'maxUnredeemedAmount', type: 'uint256' }, { name: 'settledAmount', type: 'uint256' }, { name: 'settledUnits', type: 'uint64' },
      { name: 'maxBillableUnits', type: 'uint64' }, { name: 'maxCreditWindowUnits', type: 'uint64' }, { name: 'maxLeadUnits', type: 'uint64' },
      { name: 'openedAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' }, { name: 'offerExpiresAt', type: 'uint64' },
      { name: 'redemptionGraceSeconds', type: 'uint64' }, { name: 'redemptionDeadline', type: 'uint64' },
      { name: 'closeRequestedAt', type: 'uint64' }, { name: 'challengeEndsAt', type: 'uint64' },
      { name: 'maxCreditSegments', type: 'uint8' }, { name: 'status', type: 'uint8' },
    ]}],
  },
  {
    type: 'function', name: 'checkpoint', stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'voucher', type: 'tuple', components: [
        { name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' },
      ]},
      { name: 'voucherSig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'finalizeAfterChallenge', stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'finalizeExpired', stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [],
  },
] as const;

export interface SweeperStats {
  checkedSessions: number;
  checkpointsSubmitted: number;
  finalizationsExecuted: number;
  errorsEncountered: number;
}

export async function runSweeperCycle(): Promise<SweeperStats> {
  const stats: SweeperStats = {
    checkedSessions: 0,
    checkpointsSubmitted: 0,
    finalizationsExecuted: 0,
    errorsEncountered: 0,
  };

  try {
    const res = await fetch(`${ACCESS_SERVICE_URL}/api/vouchers`);
    if (!res.ok) {
      console.log(`[Sweeper] Access service returned status ${res.status}`);
      return stats;
    }

    const { vouchers } = (await res.json()) as { vouchers: any[] };
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return stats;
    }

    stats.checkedSessions = vouchers.length;

    for (const item of vouchers) {
      try {
        const sessionId = item.sessionId as Hex;
        const latestVoucherRes = await fetch(`${ACCESS_SERVICE_URL}/api/session/latest-voucher/${sessionId}`);
        if (!latestVoucherRes.ok) continue;

        const sessionData = await latestVoucherRes.json();
        const lastVoucher = sessionData.lastVoucher;

        if (!lastVoucher || !lastVoucher.signature) continue;

        // Read session state directly from contract
        const onChainSession = (await publicClient.readContract({
          address: SETTLEMENT_ADDRESS,
          abi: settlementAbi,
          functionName: 'getSession',
          args: [sessionId],
        })) as any;

        const status = Number(onChainSession.status);
        const settledUnits = BigInt(onChainSession.settledUnits);
        const voucherUnits = BigInt(lastVoucher.cumulativeUnits);
        const challengeEndsAt = BigInt(onChainSession.challengeEndsAt);
        const redemptionDeadline = BigInt(onChainSession.redemptionDeadline);
        const now = BigInt(Math.floor(Date.now() / 1000));

        // 1. OPEN session with un-checkpointed higher voucher -> Checkpoint
        if (status === SESSION_STATUS.OPEN && voucherUnits > settledUnits && now < redemptionDeadline) {
          console.log(`[Sweeper] Checkpointing session ${sessionId.slice(0, 10)}... (${voucherUnits} units)`);
          const txHash = await walletClient.writeContract({
            address: SETTLEMENT_ADDRESS,
            abi: settlementAbi,
            functionName: 'checkpoint',
            args: [sessionId, { sessionId, cumulativeUnits: voucherUnits }, lastVoucher.signature as Hex],
            chain: null,
          });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          stats.checkpointsSubmitted++;
          console.log(`[Sweeper] ✅ Checkpoint tx confirmed: ${txHash.slice(0, 12)}...`);
        }

        // 2. CLOSE_REQUESTED session with un-checkpointed voucher -> Submit counter-voucher before challengeEndsAt
        if (status === SESSION_STATUS.CLOSE_REQUESTED && voucherUnits > settledUnits && now < challengeEndsAt) {
          console.log(`[Sweeper] Defending challenge for session ${sessionId.slice(0, 10)}... (${voucherUnits} units)`);
          const txHash = await walletClient.writeContract({
            address: SETTLEMENT_ADDRESS,
            abi: settlementAbi,
            functionName: 'checkpoint',
            args: [sessionId, { sessionId, cumulativeUnits: voucherUnits }, lastVoucher.signature as Hex],
            chain: null,
          });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          stats.checkpointsSubmitted++;
          console.log(`[Sweeper] ✅ Challenge defense tx confirmed: ${txHash.slice(0, 12)}...`);
        }

        // 3. CLOSE_REQUESTED session past challengeEndsAt -> Finalize After Challenge
        if (status === SESSION_STATUS.CLOSE_REQUESTED && now >= challengeEndsAt) {
          console.log(`[Sweeper] Finalizing challenge for session ${sessionId.slice(0, 10)}...`);
          const txHash = await walletClient.writeContract({
            address: SETTLEMENT_ADDRESS,
            abi: settlementAbi,
            functionName: 'finalizeAfterChallenge',
            args: [sessionId],
            chain: null,
          });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          stats.finalizationsExecuted++;
          console.log(`[Sweeper] ✅ Finalize challenge tx confirmed: ${txHash.slice(0, 12)}...`);
        }

        // 4. OPEN session past redemptionDeadline -> Finalize Expired
        if (status === SESSION_STATUS.OPEN && now >= redemptionDeadline) {
          console.log(`[Sweeper] Finalizing expired session ${sessionId.slice(0, 10)}...`);
          const txHash = await walletClient.writeContract({
            address: SETTLEMENT_ADDRESS,
            abi: settlementAbi,
            functionName: 'finalizeExpired',
            args: [sessionId],
            chain: null,
          });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          stats.finalizationsExecuted++;
          console.log(`[Sweeper] ✅ Finalize expired tx confirmed: ${txHash.slice(0, 12)}...`);
        }
      } catch (err: any) {
        stats.errorsEncountered++;
        console.error(`[Sweeper] Error processing session: ${err.message}`);
      }
    }
  } catch (err: any) {
    stats.errorsEncountered++;
    console.error(`[Sweeper] Sweeper run error: ${err.message}`);
  }

  return stats;
}

// Execute single cycle if run directly via CLI
if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.endsWith('sweeper.ts'))) {
  console.log('🔄 StreamPay Sweeper Worker starting single sweep cycle...');
  runSweeperCycle().then((stats) => {
    console.log('✅ Sweeper cycle finished:', stats);
  });
}

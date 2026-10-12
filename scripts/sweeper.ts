/**
 * StreamPay v2.5 — Checkpointing, Close Watcher & Redemption Sweeper Worker
 *
 * Continuous automated service that:
 * 1. Queries latest active vouchers from access-service (/api/vouchers) with admin auth.
 * 2. Monitors on-chain session state via StreamPaySettlement contract.
 * 3. Auto-checkpoints pending vouchers if un-settled.
 * 4. Defends against unilateral close requests by submitting latest voucher before challengeEndsAt.
 * 5. Finalizes expired or challenge-completed sessions.
 *
 * Configuration:
 *   RPC_URL           - Chain RPC endpoint (required for non-local)
 *   SETTLEMENT_ADDRESS - Contract address (required for non-local)
 *   RELAYER_KEY        - Private key for submitting transactions (required for non-local)
 *   ACCESS_SERVICE_URL - Access service base URL
 *   ADMIN_TOKEN        - Admin token for accessing voucher endpoints
 *   SWEEP_INTERVAL_MS  - Milliseconds between sweep cycles (default: 30000)
 *   NETWORK            - 'local' or 'testnet'
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

// ─── Configuration ────────────────────────────────────────────────

const NETWORK = process.env.NETWORK || 'local';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const ACCESS_SERVICE_URL = process.env.ACCESS_SERVICE_URL || 'http://localhost:4001';
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS || 30000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// Public Anvil test key. Never use on a real network.
const KNOWN_ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function getRelayerKey(): Hex {
  const key = process.env.RELAYER_KEY || KNOWN_ANVIL_KEY;

  // SECURITY: Refuse to use known dev key on non-local networks
  if (NETWORK !== 'local' && key === KNOWN_ANVIL_KEY) {
    console.error('⛔ FATAL: Cannot use known Anvil dev key on non-local network.');
    console.error('   Set RELAYER_KEY to a dedicated relayer private key.');
    process.exit(1);
  }

  return key as Hex;
}

function getSettlementAddress(): Address {
  const addr = process.env.SETTLEMENT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';

  // Warn if using default local address on non-local network
  if (NETWORK !== 'local' && addr === '0x5FbDB2315678afecb367f032d93F642f64180aa3') {
    console.error('⛔ FATAL: Cannot use default Anvil contract address on non-local network.');
    console.error('   Set SETTLEMENT_ADDRESS to the deployed contract address.');
    process.exit(1);
  }

  return addr as Address;
}

const RELAYER_KEY = getRelayerKey();
const SETTLEMENT_ADDRESS = getSettlementAddress();

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

// Track processed sessions to avoid duplicate submissions
const processedCheckpoints = new Set<string>();
const processedFinalizations = new Set<string>();

/**
 * Verify chain ID and contract code before any transactions.
 */
async function verifyChainAndContract(): Promise<boolean> {
  try {
    const chainId = await publicClient.getChainId();
    const expectedChainId = NETWORK === 'local' ? 31337 : 10143;
    if (chainId !== expectedChainId) {
      console.error(`⛔ Chain ID mismatch: expected ${expectedChainId}, got ${chainId}`);
      return false;
    }

    const code = await publicClient.getCode({ address: SETTLEMENT_ADDRESS });
    if (!code || code === '0x') {
      console.error(`⛔ No contract code at ${SETTLEMENT_ADDRESS} on chain ${chainId}`);
      return false;
    }

    console.log(`✅ Verified contract at ${SETTLEMENT_ADDRESS} on chain ${chainId}`);
    return true;
  } catch (err: any) {
    console.error(`⛔ Chain verification failed: ${err.message}`);
    return false;
  }
}

export async function runSweeperCycle(): Promise<SweeperStats> {
  const stats: SweeperStats = {
    checkedSessions: 0,
    checkpointsSubmitted: 0,
    finalizationsExecuted: 0,
    errorsEncountered: 0,
  };

  try {
    const headers: Record<string, string> = {};
    if (ADMIN_TOKEN) {
      headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
    }

    const res = await fetch(`${ACCESS_SERVICE_URL}/api/vouchers`, { headers });
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

        const voucherHeaders: Record<string, string> = {};
        if (ADMIN_TOKEN) voucherHeaders['Authorization'] = `Bearer ${ADMIN_TOKEN}`;

        const latestVoucherRes = await fetch(
          `${ACCESS_SERVICE_URL}/api/session/latest-voucher/${sessionId}`,
          { headers: voucherHeaders }
        );
        if (!latestVoucherRes.ok) continue;

        const sessionData = await latestVoucherRes.json();
        // Only a voucher attached to a completed delivery is settlement
        // eligible. Issuance/reservation alone must never trigger payment.
        const lastVoucher = sessionData.lastDeliveredVoucher;

        if (!lastVoucher || !lastVoucher.signature) continue;

        // Read fresh on-chain state before any action
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

        const cpKey = `${sessionId}-${voucherUnits}`;

        // 1. OPEN session with un-checkpointed higher voucher -> Checkpoint
        if (status === SESSION_STATUS.OPEN && voucherUnits > settledUnits && now < redemptionDeadline) {
          if (!processedCheckpoints.has(cpKey)) {
            console.log(`[Sweeper] Checkpointing session ${sessionId.slice(0, 10)}... (${voucherUnits} units)`);
            try {
              const txHash = await walletClient.writeContract({
                address: SETTLEMENT_ADDRESS,
                abi: settlementAbi,
                functionName: 'checkpoint',
                args: [sessionId, { sessionId, cumulativeUnits: voucherUnits }, lastVoucher.signature as Hex],
                chain: null,
              });
              const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
              if (receipt.status !== 'success') throw new Error(`Checkpoint reverted: ${txHash}`);
              processedCheckpoints.add(cpKey);
              stats.checkpointsSubmitted++;
              console.log(`[Sweeper] ✅ Checkpoint tx confirmed: ${txHash.slice(0, 12)}...`);
            } catch (txErr: any) {
              // Failed, reverted, timed-out, and ambiguous submissions remain
              // retryable. A later sweep re-reads chain state before retrying.
              console.warn(`[Sweeper] Checkpoint tx failed; retaining for retry: ${txErr.message}`);
            }
          }
        }

        // 2. CLOSE_REQUESTED with un-checkpointed voucher -> Defend challenge BEFORE challengeEndsAt
        if (status === SESSION_STATUS.CLOSE_REQUESTED && voucherUnits > settledUnits && now < challengeEndsAt) {
          if (!processedCheckpoints.has(cpKey)) {
            console.log(`[Sweeper] Defending challenge for session ${sessionId.slice(0, 10)}... (${voucherUnits} units)`);
            try {
              const txHash = await walletClient.writeContract({
                address: SETTLEMENT_ADDRESS,
                abi: settlementAbi,
                functionName: 'checkpoint',
                args: [sessionId, { sessionId, cumulativeUnits: voucherUnits }, lastVoucher.signature as Hex],
                chain: null,
              });
              const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
              if (receipt.status !== 'success') throw new Error(`Challenge defense reverted: ${txHash}`);
              processedCheckpoints.add(cpKey);
              stats.checkpointsSubmitted++;
              console.log(`[Sweeper] ✅ Challenge defense tx confirmed: ${txHash.slice(0, 12)}...`);
            } catch (txErr: any) {
              console.warn(`[Sweeper] Challenge defense failed; retaining for retry: ${txErr.message}`);
            }
          }
        }

        // 3. CLOSE_REQUESTED past challengeEndsAt -> Finalize After Challenge
        if (status === SESSION_STATUS.CLOSE_REQUESTED && now >= challengeEndsAt) {
          const fKey = `finalize-${sessionId}`;
          if (!processedFinalizations.has(fKey)) {
            console.log(`[Sweeper] Finalizing challenge for session ${sessionId.slice(0, 10)}...`);
            try {
              const txHash = await walletClient.writeContract({
                address: SETTLEMENT_ADDRESS,
                abi: settlementAbi,
                functionName: 'finalizeAfterChallenge',
                args: [sessionId],
                chain: null,
              });
              const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
              if (receipt.status !== 'success') throw new Error(`Challenge finalization reverted: ${txHash}`);
              processedFinalizations.add(fKey);
              stats.finalizationsExecuted++;
              console.log(`[Sweeper] ✅ Finalize challenge tx confirmed: ${txHash.slice(0, 12)}...`);
            } catch (txErr: any) {
              console.warn(`[Sweeper] Finalize challenge failed; retaining for retry: ${txErr.message}`);
            }
          }
        }

        // 4. OPEN session past redemptionDeadline -> Finalize Expired
        if (status === SESSION_STATUS.OPEN && now >= redemptionDeadline) {
          const fKey = `expire-${sessionId}`;
          if (!processedFinalizations.has(fKey)) {
            console.log(`[Sweeper] Finalizing expired session ${sessionId.slice(0, 10)}...`);
            try {
              const txHash = await walletClient.writeContract({
                address: SETTLEMENT_ADDRESS,
                abi: settlementAbi,
                functionName: 'finalizeExpired',
                args: [sessionId],
                chain: null,
              });
              const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
              if (receipt.status !== 'success') throw new Error(`Expiry finalization reverted: ${txHash}`);
              processedFinalizations.add(fKey);
              stats.finalizationsExecuted++;
              console.log(`[Sweeper] ✅ Finalize expired tx confirmed: ${txHash.slice(0, 12)}...`);
            } catch (txErr: any) {
              console.warn(`[Sweeper] Finalize expired failed; retaining for retry: ${txErr.message}`);
            }
          }
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

// ─── Continuous Loop with Graceful Shutdown ─────────────────────

let running = true;

async function sweepLoop() {
  console.log(`🔄 StreamPay Sweeper Worker starting continuous operation...`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   RPC: ${RPC_URL}`);
  console.log(`   Settlement: ${SETTLEMENT_ADDRESS}`);
  console.log(`   Relayer: ${account.address}`);
  console.log(`   Interval: ${SWEEP_INTERVAL_MS}ms`);

  // Verify chain and contract before starting
  const verified = await verifyChainAndContract();
  if (!verified) {
    console.error('⛔ Pre-flight verification failed. Exiting.');
    process.exit(1);
  }

  while (running) {
    try {
      const stats = await runSweeperCycle();
      const ts = new Date().toISOString();
      console.log(`[${ts}] Sweep complete: checked=${stats.checkedSessions} checkpoints=${stats.checkpointsSubmitted} finalizations=${stats.finalizationsExecuted} errors=${stats.errorsEncountered}`);
    } catch (err: any) {
      console.error(`[Sweeper] Unhandled cycle error: ${err.message}`);
    }

    // Wait with exponential backoff on errors, normal interval otherwise
    await new Promise((resolve) => setTimeout(resolve, SWEEP_INTERVAL_MS));
  }

  console.log('🛑 Sweeper shutting down gracefully.');
}

// Graceful shutdown handlers
process.on('SIGINT', () => { running = false; console.log('\nReceived SIGINT, shutting down...'); });
process.on('SIGTERM', () => { running = false; console.log('\nReceived SIGTERM, shutting down...'); });

// Execute if run directly via CLI
if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.endsWith('sweeper.ts'))) {
  sweepLoop();
}

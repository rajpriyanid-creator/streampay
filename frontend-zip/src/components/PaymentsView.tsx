/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Receipt, ShieldCheck, ExternalLink, RefreshCw, Lock, CheckCircle2, Banknote, RotateCcw } from 'lucide-react';
import { StreamSessionState, WalletState } from '../lib/protocol/sessionManager';
import { fetchLiveEnvioTelemetry, EnvioTelemetry } from '../lib/envioClient';

interface PaymentsViewProps {
  session: StreamSessionState;
  wallet: WalletState;
  onCheckpoint: () => void;
  onCloseSession: () => void;
  onClaimRefund: () => void;
  onRefundSession?: () => void;
  onRequestUnilateralClose?: () => void;
  onFinalizeChallenge?: () => void;
  onRefreshClaimable: () => void;
  onOpenSession?: () => void;
  onSignCreatorClose?: () => void;
  creatorCloseSigned?: boolean;
  onResetDemoSession?: () => void;
}

export const PaymentsView: React.FC<PaymentsViewProps> = ({
  session,
  wallet,
  onCheckpoint,
  onCloseSession,
  onClaimRefund,
  onRefundSession,
  onRequestUnilateralClose,
  onFinalizeChallenge,
  onRefreshClaimable,
  onOpenSession,
  onSignCreatorClose,
  creatorCloseSigned,
  onResetDemoSession,
}) => {
  const [minutes, setMinutes] = useState('10');
  const [envioTelemetry, setEnvioTelemetry] = useState<EnvioTelemetry | null>(null);
  const [isRefreshingEnvio, setIsRefreshingEnvio] = useState(false);
  const [challengeRemaining, setChallengeRemaining] = useState<number>(0);
  const ratePerSecond = 0.0005;

  useEffect(() => {
    if (session.status !== 'close_requested') return;
    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const ends = session.challengeEndsAt || 0;
      setChallengeRemaining(Math.max(0, ends - now));
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [session.status, session.challengeEndsAt]);

  const refreshEnvio = useCallback(async () => {
    setIsRefreshingEnvio(true);
    try {
      const data = await fetchLiveEnvioTelemetry();
      setEnvioTelemetry(data);
    } finally {
      setIsRefreshingEnvio(false);
    }
  }, []);

  useEffect(() => {
    onRefreshClaimable();
    void refreshEnvio();
  }, [onRefreshClaimable, refreshEnvio]);

  const pendingUnits = Math.max(0, session.cumulativeUnits - session.settledUnits);
  const depositNum = Number(session.initialDepositUSDC) || 0;
  const billedNum = Number(session.unredeemedUSDC) || 0;
  const computedRefund = Math.max(0, depositNum - billedNum).toFixed(6);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#1f1912] gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[#d89a4e]" />
            <span>Payments & Vouchers Ledger</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Real-time micropayment state, EIP-712 signed vouchers, and settlement channel status.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {session.status === 'inactive' && onOpenSession && (
            <button
              onClick={onOpenSession}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#d89a4e] to-[#b3752c] text-black text-xs font-bold shadow-lg hover:brightness-110 transition-all cursor-pointer"
            >
              Open Payment Session
            </button>
          )}

          {session.status === 'closed' && (
            <>
              {Number(session.claimableUSDC) > 0 && (
                <button
                  onClick={onClaimRefund}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-colors"
                >
                  <Banknote className="w-3.5 h-3.5" />
                  <span>Claim Refund ({session.claimableUSDC} USDC)</span>
                </button>
              )}
              {onOpenSession && (
                <button
                  onClick={onOpenSession}
                  className="px-4 py-2 rounded-xl bg-[#241a12] hover:bg-[#302217] border border-[#523d24] text-[#e8b56f] text-xs font-semibold cursor-pointer transition-colors"
                >
                  New Payment Session
                </button>
              )}
            </>
          )}

          {session.status === 'active' && (
            <>
              <button
                onClick={onCheckpoint}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                  pendingUnits > 0
                    ? 'bg-[#2b1f13] hover:bg-[#382818] border border-[#7d5628] text-[#e8b56f] shadow-[0_0_12px_rgba(216,154,78,0.2)]'
                    : 'bg-[#18130e] hover:bg-[#201912] border border-[#2b2116] text-neutral-400'
                }`}
                title={pendingUnits > 0 ? `${pendingUnits} units waiting for checkpoint settlement` : 'Settlement units up to date'}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pendingUnits > 0 ? 'text-[#d89a4e]' : ''}`} />
                <span>
                  {pendingUnits > 0 ? `Checkpoint (${pendingUnits} pending)` : `Checkpointed (${session.settledUnits}u)`}
                </span>
              </button>

              {!session.isSimulated && !creatorCloseSigned && onSignCreatorClose && (
                <button
                  onClick={onSignCreatorClose}
                  className="px-3 py-1.5 rounded-xl bg-[#1d1610] hover:bg-[#271d15] border border-[#523d24] text-[#e8b56f] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  title="Step 1: Sign Creator Close Ack before cooperative settlement"
                >
                  <span>Sign Creator Close Ack</span>
                </button>
              )}

              {/* Prominent Dedicated Refund Escrow Button */}
              <button
                onClick={onRefundSession || onCloseSession}
                className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all"
                title="Refund remaining unspent escrow deposit and close session"
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>Refund Escrow ({computedRefund} USDC)</span>
              </button>

              <button
                onClick={onCloseSession}
                className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors"
                title="Settle remaining balance and close payment channel cooperatively"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Cooperative Close</span>
              </button>

              {onRequestUnilateralClose && (
                <button
                  onClick={onRequestUnilateralClose}
                  className="px-3.5 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 text-red-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  title="Unilateral exit: Reclaims remaining escrow on Monad without requiring creator or voucher signatures"
                >
                  <span>Unilateral Exit</span>
                </button>
              )}
            </>
          )}

          {session.status === 'close_requested' && (
            <button
              onClick={onFinalizeChallenge || onRefundSession}
              disabled={challengeRemaining > 0}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all ${
                challengeRemaining > 0
                  ? 'bg-neutral-800 border border-neutral-700 text-neutral-400 cursor-not-allowed opacity-80'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.4)]'
              }`}
              title={challengeRemaining > 0 ? `Challenge period unlocking in ${Math.floor(challengeRemaining / 60)}m ${challengeRemaining % 60}s` : 'Finalize and claim remaining escrow'}
            >
              <Banknote className="w-4 h-4" />
              <span>
                {challengeRemaining > 0
                  ? `Unlocking in ${Math.floor(challengeRemaining / 60)}m ${challengeRemaining % 60}s...`
                  : 'Finalize Escrow Refund'}
              </span>
            </button>
          )}
          <button
            onClick={onResetDemoSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-850 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-700 transition shadow-sm"
            title="Clear cached session state and generate a fresh signer key for recording demos"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Reset Demo State</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5">
        <div className="p-3.5 sm:p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Session Status</div>
          <div className="text-base sm:text-lg font-bold text-white mt-1 capitalize flex items-center gap-2 truncate">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                session.status === 'active' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : session.status === 'closed' ? 'bg-amber-400' : 'bg-neutral-500'
              }`}
            />
            <span>{session.status}</span>
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Cumulative Units Billed</div>
          <div className="text-base sm:text-lg font-bold text-[#e8b56f] font-mono mt-1 truncate">
            {session.cumulativeUnits} units
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Total Billed USDC</div>
          <div className="text-base sm:text-lg font-bold text-white font-mono mt-1 truncate">
            {session.unredeemedUSDC} USDC
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Settled On-Chain Units</div>
          <div className="text-base sm:text-lg font-bold text-neutral-200 font-mono mt-1 truncate">
            {session.settledUnits} units
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Refund Allocation</div>
          <div className="text-base sm:text-lg font-bold text-emerald-300 font-mono mt-1 truncate">
            {session.refundUSDC !== '0' ? session.refundUSDC : computedRefund} USDC
          </div>
          <div className="text-[10px] text-neutral-400 mt-1 truncate font-medium">
            {session.refundStatus === 'credited' ? 'Credited to wallet' : session.refundStatus === 'claimed' ? 'Claimed' : session.refundStatus === 'claimable' ? 'Claimable' : session.status === 'active' ? 'Available to refund' : session.refundStatus}
          </div>
        </div>
      </div>

      {/* Escrow Deposit & Refund Ledger Banner */}
      <div className="p-4 rounded-2xl bg-[#13100c] border border-[#241d16] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#1b150f]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Settlement Escrow & Refund Management
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefreshClaimable}
              className="px-2.5 py-1 rounded-lg text-xs bg-[#1a140e] hover:bg-[#251c14] border border-[#3b2a1a] text-[#e8b56f] flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Refund Status</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-2.5 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Initial Escrow Deposit</div>
            <div className="font-mono text-white text-sm font-bold mt-0.5">{session.initialDepositUSDC || '0.0000'} USDC</div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Current Billed Streaming</div>
            <div className="font-mono text-[#e8b56f] text-sm font-bold mt-0.5">{session.unredeemedUSDC} USDC</div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Refund Allocation</div>
            <div className="font-mono text-emerald-300 text-sm font-bold mt-0.5">
              {session.refundUSDC !== '0' ? session.refundUSDC : computedRefund} USDC
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Refund Status</div>
            <div className="text-sm font-bold mt-0.5 font-mono capitalize text-neutral-200">
              {session.refundStatus === 'credited' ? (
                <span className="text-emerald-400">Credited to Wallet</span>
              ) : session.refundStatus === 'claimed' ? (
                <span className="text-emerald-400">Claimed</span>
              ) : session.refundStatus === 'claimable' ? (
                <span className="text-amber-400">Claimable Now</span>
              ) : session.status === 'active' ? (
                <span className="text-emerald-300">Ready to Refund</span>
              ) : (
                session.refundStatus
              )}
            </div>
          </div>
        </div>

        {/* Case 1: Session is Active -> Offer direct Refund of unspent escrow */}
        {session.status === 'active' && (
          <div className="mt-3 p-4 rounded-xl border border-emerald-900/60 bg-[#0c1611] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-200">
                  Unspent Escrow Refund Option Available
                </span>
              </div>
              <p className="text-[11px] text-neutral-300 mt-1 max-w-xl">
                You currently have <span className="font-mono text-emerald-300 font-bold">{computedRefund} USDC</span> in unspent escrow. You can refund this balance back to your wallet at any time by closing the session.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onRefundSession || onCloseSession}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black text-xs font-bold flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer transition-all whitespace-nowrap"
              >
                <Banknote className="w-4 h-4" />
                <span>Refund Remaining Escrow ({computedRefund} USDC)</span>
              </button>
            </div>
          </div>
        )}

        {/* Case 1b: Session is in Close Requested / Challenge Window */}
        {session.status === 'close_requested' && (
          <div className="mt-3 p-4 rounded-xl border border-amber-900/70 bg-amber-950/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-200">
                  Unilateral Close Challenge Active on Monad
                </span>
                {challengeRemaining > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-900/50 border border-amber-700/50 text-[11px] font-mono font-bold text-amber-300">
                    ⏱ {Math.floor(challengeRemaining / 60)}:{(challengeRemaining % 60).toString().padStart(2, '0')} remaining
                  </span>
                )}
              </div>
              <p className="text-[11px] text-neutral-300 mt-1 max-w-xl">
                {challengeRemaining > 0
                  ? `Your unilateral close request is confirmed on Monad Testnet. The contract enforces a 15-minute challenge period to prevent double-spending. The remaining ${session.refundUSDC !== '0' ? session.refundUSDC : computedRefund} USDC refund will unlock at ${session.challengeEndsAt ? new Date(session.challengeEndsAt * 1000).toLocaleTimeString() : '7:55 AM'}.`
                  : `Challenge window has elapsed! Click Finalize Refund below to transfer your full ${session.refundUSDC !== '0' ? session.refundUSDC : computedRefund} USDC directly into your wallet.`}
              </p>
            </div>
            <button
              onClick={onFinalizeChallenge || onRefundSession}
              disabled={challengeRemaining > 0}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all whitespace-nowrap ${
                challengeRemaining > 0
                  ? 'bg-neutral-800 border border-neutral-700 text-neutral-400 cursor-not-allowed opacity-80'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.4)]'
              }`}
            >
              <Banknote className="w-4 h-4" />
              <span>
                {challengeRemaining > 0
                  ? `Unlocking in ${Math.floor(challengeRemaining / 60)}m ${challengeRemaining % 60}s...`
                  : 'Finalize & Claim Refund (5.0 USDC)'}
              </span>
            </button>
          </div>
        )}

        {/* Case 2: Session is Closed and has claimable tokens */}
        {Number(session.claimableUSDC) > 0 && (
          <div className="mt-3 p-4 rounded-xl border border-amber-900/70 bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-200">
                  Claimable Escrow Refund Ready
                </span>
              </div>
              <div className="text-[11px] text-amber-300/80 mt-1">
                <span className="font-mono text-white font-bold">{session.claimableUSDC} USDC</span> is available in the settlement contract claimable balance. Click to withdraw directly to your wallet.
              </div>
            </div>
            <button
              onClick={onClaimRefund}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-bold shadow-md cursor-pointer transition-colors whitespace-nowrap"
            >
              Claim Escrow Refund ({session.claimableUSDC} USDC)
            </button>
          </div>
        )}

        {/* Case 3: Session is Closed and refund was successfully credited or claimed */}
        {session.status === 'closed' && (session.refundStatus === 'credited' || session.refundStatus === 'claimed') && Number(session.refundUSDC) > 0 && (
          <div className="mt-3 p-4 rounded-xl border border-emerald-900/60 bg-emerald-950/20 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-200">
                  Escrow Refund Successfully Completed
                </div>
                <div className="text-[11px] text-neutral-300 mt-0.5">
                  Full refund of <span className="font-mono text-emerald-300 font-bold">{session.refundUSDC} USDC</span> was deposited directly into your wallet.
                </div>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/70 border border-emerald-800/50 text-[11px] font-mono text-emerald-300 font-semibold whitespace-nowrap">
              {session.refundStatus === 'credited' ? 'Credited to Wallet' : 'Claimed'}
            </span>
          </div>
        )}

        {/* Case 4: Session Closed with zero refund */}
        {session.status === 'closed' && Number(session.refundUSDC) === 0 && Number(session.claimableUSDC) === 0 && (
          <div className="mt-3 p-3 rounded-xl bg-[#0b0907] border border-[#1e1710] text-[11px] text-neutral-400">
            Session settled in full (100% of escrow consumed by streaming). No remaining refund balance.
          </div>
        )}
      </div>

      {/* Contract & Token Specs */}
      <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] space-y-2 text-xs">
        <div className="flex justify-between items-center py-1 border-b border-[#1b150f]">
          <span className="text-neutral-400">Settlement Contract:</span>
          <span className="font-mono text-neutral-200">{session.contractAddress}</span>
        </div>
        <div className="flex justify-between items-center py-1 border-b border-[#1b150f]">
          <span className="text-neutral-400">Payment Token (USDC):</span>
          <span className="font-mono text-[#e8b56f]">{session.paymentToken}</span>
        </div>
        <div className="flex justify-between items-center py-1">
          <span className="text-neutral-400">Last Transaction Hash:</span>
          <span className="font-mono text-neutral-300">
            {session.lastTxHash ? (
              <span className="flex items-center gap-1">
                <span>{session.lastTxHash.slice(0, 16)}...{session.lastTxHash.slice(-8)}</span>
                {wallet.network === 'testnet' && (
                  <a
                    href={`https://testnet.monadscan.com/tx/${session.lastTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#d89a4e] hover:underline"
                  >
                    <ExternalLink className="w-3 h-3 inline" />
                  </a>
                )}
              </span>
            ) : (
              'None'
            )}
          </span>
        </div>
      </div>

      {/* Envio HyperIndex & Infrastructure Panel */}
      <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] space-y-3 text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-[#1b150f]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-bold text-white uppercase tracking-wider text-[11px]">
              Envio HyperIndex & HyperSync Live Telemetry
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshEnvio}
              disabled={isRefreshingEnvio}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1d1711] hover:bg-[#281f17] border border-[#3d2e1f] text-[#e8b56f] flex items-center gap-1 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshingEnvio ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/50 border border-cyan-800/40 text-cyan-300">
              Monad Testnet (10143) · Block {envioTelemetry ? envioTelemetry.currentBlock.toString() : '70464119+'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-neutral-300">
          <div>
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Indexer Architecture</div>
            <div className="font-semibold text-white mt-0.5">Envio HyperIndex v2.5</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              Syncing from block {envioTelemetry ? envioTelemetry.startBlock.toString() : '70464119'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Indexed Target</div>
            <div className="font-mono text-xs text-[#e8b56f] mt-0.5 truncate">
              {session.contractAddress || '0x3E016fa87f7149971F65Df413b667C5355c5B060'}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">Settlement & channel escrows</div>
          </div>
          <div>
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Indexed Events</div>
            <div className="text-xs text-neutral-200 mt-0.5">
              {envioTelemetry ? `${envioTelemetry.eventsCount} events indexed` : 'Querying on-chain…'}
            </div>
            <div className="text-[11px] text-emerald-400 mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              <span>Live on Monad Testnet</span>
            </div>
          </div>
        </div>

        {envioTelemetry && envioTelemetry.events.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#1a140e] space-y-1.5">
            <div className="text-[10px] uppercase font-semibold text-neutral-500">Live Indexed Event Stream:</div>
            {envioTelemetry.events.map((evt) => (
              <div key={evt.id} className="flex items-center justify-between p-2 rounded bg-[#0b0907] border border-[#1e1710] text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-cyan-300 font-mono">{evt.eventName}</span>
                  <span className="text-neutral-400">{evt.summary}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500 font-mono text-[10px]">Block #{evt.blockNumber.toString()}</span>
                  {evt.transactionHash && (
                    <a
                      href={`https://testnet.monadscan.com/tx/${evt.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#e8b56f] hover:underline font-mono text-[10px] flex items-center gap-0.5"
                    >
                      <span>{evt.transactionHash.slice(0, 8)}...</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* Vouchers & Verification History Table */}
      <div className="rounded-2xl bg-[#13100c] border border-[#241d16] overflow-hidden">
        <div className="p-4 border-b border-[#1f1812] flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Signed Vouchers & Verified Segments</h3>
          <span className="text-xs text-neutral-400">
            {session.verificationLogs.length} verified requests
          </span>
        </div>

        {session.verificationLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">
            No vouchers signed yet. Open a session and play video segments to generate vouchers!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#0b0907] text-neutral-400 font-semibold uppercase tracking-wider text-[10px] border-b border-[#1f1812]">
                <tr>
                  <th className="p-3">Time</th>
                  <th className="p-3">Segment</th>
                  <th className="p-3">Cumulative</th>
                  <th className="p-3">Access Token</th>
                  <th className="p-3">SHA-256</th>
                  <th className="p-3">Merkle Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b150f]">
                {session.verificationLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#18130e]">
                    <td className="p-3 font-mono text-neutral-400">{log.timestamp}</td>
                    <td className="p-3 font-semibold text-white">Segment {log.segmentIndex}</td>
                    <td className="p-3 font-mono text-[#e8b56f]">{log.cumulativeUnits} units</td>
                    <td className="p-3 font-mono text-neutral-300">
                      {log.token.slice(0, 14)}...
                    </td>
                    <td className="p-3 font-mono text-emerald-400">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Valid</span>
                      </span>
                    </td>
                    <td className="p-3 font-mono text-emerald-400">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Verified ({log.proofLength} levels)</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-[#13100c] border border-[#241d16] overflow-hidden">
        <div className="p-4 border-b border-[#1f1812]"><h3 className="text-sm font-bold text-white">Session history</h3></div>
        {session.events.length === 0 ? <div className="p-6 text-xs text-neutral-500">No session events yet.</div> : <div className="divide-y divide-[#1b150f]">{session.events.map((event) => <div key={event.id} className="p-3 flex items-center justify-between gap-3 text-xs"><div><div className="text-white font-semibold">{event.type}</div><div className="text-neutral-500">{event.timestamp}{event.detail ? ` · ${event.detail}` : ''}</div></div>{event.txHash ? <a className="text-[#e8b56f] hover:underline font-mono" href={`https://testnet.monadscan.com/tx/${event.txHash}`} target="_blank" rel="noreferrer">{event.txHash.slice(0, 10)}... ↗</a> : null}</div>)}</div>}
      </div>
    </div>
  );
};

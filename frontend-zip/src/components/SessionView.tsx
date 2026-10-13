/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { KeyRound, Shield, RefreshCw, Lock, ExternalLink, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { StreamSessionState, WalletState } from '../lib/protocol/sessionManager';

interface SessionViewProps {
  session: StreamSessionState;
  wallet: WalletState;
  onOpenSession: () => void;
  onCheckpoint: () => void;
  onCloseSession: () => void;
  onClaimRefund: () => void;
  onRefreshClaimable: () => void;
}

export const SessionView: React.FC<SessionViewProps> = ({
  session,
  wallet,
  onOpenSession,
  onCheckpoint,
  onCloseSession,
  onClaimRefund,
  onRefreshClaimable,
}) => {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#1f1912] gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#d89a4e]" />
            <span>Streaming Payment Session</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            State channel session status, signed EIP-712 vouchers, and cooperative settlement controls.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {session.status === 'inactive' && (
            <button
              onClick={onOpenSession}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#d89a4e] to-[#b3752c] text-black text-xs font-bold shadow-lg hover:brightness-110 transition-all cursor-pointer"
            >
              Open Payment Session
            </button>
          )}

          {session.status === 'active' && (
            <>
              <button
                onClick={onCheckpoint}
                className="px-3.5 py-1.5 rounded-xl bg-[#241a12] hover:bg-[#302217] border border-[#523d24] text-[#e8b56f] text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Checkpoint Session</span>
              </button>
              <button
                onClick={onCloseSession}
                className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Close Session</span>
              </button>
            </>
          )}

          {session.status === 'closed' && (
            <button
              onClick={onOpenSession}
              className="px-4 py-2 rounded-xl bg-[#241a12] hover:bg-[#302217] border border-[#523d24] text-[#e8b56f] text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors"
            >
              <span>New Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Status & Key Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Session State</div>
          <div className="text-lg font-bold text-white mt-1 capitalize flex items-center gap-2 truncate">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                session.status === 'active'
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : session.status === 'closed'
                  ? 'bg-amber-400'
                  : 'bg-neutral-500'
              }`}
            />
            <span>{session.status}</span>
          </div>
          <div className="text-[11px] text-neutral-500 mt-1 truncate">
            {session.isSimulated ? 'Simulation Mode' : 'On-Chain Monad'}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Initial Deposit</div>
          <div className="text-lg font-bold text-white font-mono mt-1 truncate">
            {session.initialDepositUSDC} <span className="text-xs text-[#d89a4e]">USDC</span>
          </div>
          <div className="text-[11px] text-neutral-500 mt-1 truncate">
            Locked in Settlement Escrow
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Cumulative Units</div>
          <div className="text-lg font-bold text-[#e8b56f] font-mono mt-1 truncate">
            {session.cumulativeUnits} <span className="text-xs text-neutral-400">units</span>
          </div>
          <div className="text-[11px] text-neutral-500 mt-1 truncate">
            Settled: {session.settledUnits} units
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] min-w-0">
          <div className="text-xs font-medium text-neutral-400 truncate">Billed Amount</div>
          <div className="text-lg font-bold text-white font-mono mt-1 truncate">
            {session.unredeemedUSDC} <span className="text-xs text-[#d89a4e]">USDC</span>
          </div>
          <div className="text-[11px] text-emerald-400 mt-1 truncate">
            Refund: {session.refundUSDC} USDC ({session.refundStatus})
          </div>
        </div>
      </div>

      {/* Claimable Refund Alert (if available) */}
      {Number(session.claimableUSDC) > 0 && (
        <div className="p-4 rounded-2xl border border-emerald-900/60 bg-emerald-950/20 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-emerald-200">Claimable Refund Available</div>
            <div className="text-xs text-emerald-300/70 mt-0.5">
              {session.claimableUSDC} USDC is ready to withdraw from the settlement smart contract.
            </div>
          </div>
          <button
            onClick={onClaimRefund}
            className="px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-black text-xs font-bold cursor-pointer transition-colors shadow-sm"
          >
            Claim Refund
          </button>
        </div>
      )}

      {/* Channel Parties & Identifiers */}
      <div className="p-5 rounded-2xl bg-[#13100c] border border-[#241d16] space-y-3 text-xs">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 pb-2 border-b border-[#1b150f]">
          <Shield className="w-4 h-4 text-[#d89a4e]" />
          <span>Channel Cryptographic Identifiers</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-neutral-300">
          <div className="p-3 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Payer Account</div>
            <div className="font-mono text-xs text-white mt-1 truncate">{session.payer || wallet.address || 'Not connected'}</div>
          </div>

          <div className="p-3 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Session Signer (Ephemeral Key)</div>
            <div className="font-mono text-xs text-[#e8b56f] mt-1 truncate">{session.sessionSigner || 'Not initialized'}</div>
          </div>

          <div className="p-3 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Settlement Contract</div>
            <div className="font-mono text-xs text-white mt-1 truncate">
              {session.contractAddress || '0x3E016fa87f7149971F65Df413b667C5355c5B060'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#0b0907] border border-[#1e1710]">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold">Last On-Chain Transaction</div>
            <div className="font-mono text-xs text-neutral-300 mt-1 truncate">
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
            </div>
          </div>
        </div>
      </div>

      {/* Verification Logs & Vouchers Table */}
      <div className="rounded-2xl bg-[#13100c] border border-[#241d16] overflow-hidden">
        <div className="p-4 border-b border-[#1f1812] flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#d89a4e]" />
            <span>Signed Vouchers & Verified Segments Log</span>
          </h3>
          <span className="text-xs text-neutral-400">
            {session.verificationLogs.length} verified segment deliveries
          </span>
        </div>

        {session.verificationLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">
            No segment vouchers signed yet. Start playback on the stream to generate verifiable EIP-712 micropayment vouchers.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0e0b08] text-neutral-400 font-semibold border-b border-[#1b150f]">
                <tr>
                  <th className="p-3">Segment</th>
                  <th className="p-3">SHA-256 Check</th>
                  <th className="p-3">Merkle Proof</th>
                  <th className="p-3">Cumulative Units</th>
                  <th className="p-3">Voucher Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b150f] text-neutral-300">
                {session.verificationLogs.map((log, idx) => (
                  <tr key={idx} className="hover:bg-[#16120e]">
                    <td className="p-3 font-semibold text-white">Segment {log.segmentIndex}</td>
                    <td className="p-3">
                      <span className="text-emerald-400 flex items-center gap-1 font-mono text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Valid</span>
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-emerald-400 flex items-center gap-1 font-mono text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Verified</span>
                      </span>
                    </td>
                    <td className="p-3 font-mono text-[#e8b56f]">{log.cumulativeUnits} units</td>
                    <td className="p-3 text-neutral-400">Signed & Accepted</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Session Events Stream */}
      {session.events.length > 0 && (
        <div className="rounded-2xl bg-[#13100c] border border-[#241d16] p-4 space-y-3">
          <h3 className="text-sm font-bold text-white">Session Lifecycle Events</h3>
          <div className="space-y-2">
            {session.events.map((evt) => (
              <div
                key={evt.id}
                className="p-2.5 rounded-xl bg-[#0b0907] border border-[#1e1710] flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#d89a4e]" />
                  <span className="font-semibold text-white">{evt.type}</span>
                  {evt.detail && <span className="text-neutral-400">· {evt.detail}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-neutral-500 font-mono">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  {evt.txHash && wallet.network === 'testnet' && (
                    <a
                      href={`https://testnet.monadscan.com/tx/${evt.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#d89a4e] hover:underline flex items-center gap-1 font-mono text-[11px]"
                    >
                      <span>Tx</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

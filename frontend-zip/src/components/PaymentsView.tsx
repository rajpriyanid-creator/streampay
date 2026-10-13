/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Receipt, ShieldCheck, ExternalLink, RefreshCw, Lock, CheckCircle2 } from 'lucide-react';
import { StreamSessionState, WalletState } from '../lib/protocol/sessionManager';
import { fetchLiveEnvioTelemetry, EnvioTelemetry } from '../lib/envioClient';

interface PaymentsViewProps {
  session: StreamSessionState;
  wallet: WalletState;
  onCheckpoint: () => void;
  onCloseSession: () => void;
  onClaimRefund: () => void;
  onRefreshClaimable: () => void;
}

export const PaymentsView: React.FC<PaymentsViewProps> = ({
  session,
  wallet,
  onCheckpoint,
  onCloseSession,
  onClaimRefund,
  onRefreshClaimable,
}) => {
  const [minutes, setMinutes] = useState('10');
  const [envioTelemetry, setEnvioTelemetry] = useState<EnvioTelemetry | null>(null);
  const [isRefreshingEnvio, setIsRefreshingEnvio] = useState(false);
  const ratePerSecond = 0.0005;

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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[#1f1912]">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[#d89a4e]" />
            <span>Payments & Vouchers Ledger</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Real-time micropayment state, EIP-712 signed vouchers, and settlement channel status.
          </p>
        </div>

        {session.status === 'active' && (
          <div className="flex items-center gap-2">
            <button
              onClick={onCheckpoint}
              className="px-3.5 py-1.5 rounded-xl bg-[#241a12] hover:bg-[#302217] border border-[#523d24] text-[#e8b56f] text-xs font-semibold flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Checkpoint</span>
            </button>
            <button
              onClick={onCloseSession}
              className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-semibold flex items-center gap-2"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Close Session</span>
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Session Status</div>
          <div className="text-lg font-bold text-white mt-1 capitalize flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                session.status === 'active' ? 'bg-emerald-400' : 'bg-neutral-500'
              }`}
            />
            <span>{session.status}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Cumulative Units Billed</div>
          <div className="text-lg font-bold text-[#e8b56f] font-mono mt-1">
            {session.cumulativeUnits} units
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Total Billed USDC</div>
          <div className="text-lg font-bold text-white font-mono mt-1">
            {session.unredeemedUSDC} USDC
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Settled On-Chain Units</div>
          <div className="text-lg font-bold text-neutral-200 font-mono mt-1">
            {session.settledUnits} units
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Refund Allocation</div>
          <div className="text-lg font-bold text-emerald-300 font-mono mt-1">{session.refundUSDC} USDC</div>
          <div className="text-[10px] text-neutral-500 mt-1">{session.refundStatus}</div>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs text-neutral-400 mb-1">Cost calculator</div>
          <label className="text-xs text-neutral-500">Minutes watched</label>
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} type="number" min="0" className="block mt-1 w-28 rounded-lg bg-[#080705] border border-[#3b2a1a] px-2 py-1 text-sm text-white" />
        </div>
        <div className="text-sm text-neutral-300">StreamPay: <strong className="text-[#e8b56f]">{(Math.max(0, Number(minutes) || 0) * 60 * ratePerSecond).toFixed(4)} USDC</strong></div>
        <div className="text-sm text-neutral-500">Subscription example: <strong className="text-neutral-300">$22.99/month</strong></div>
      </div>

      {Number(session.claimableUSDC) > 0 && (
        <div className="p-4 rounded-xl border border-emerald-900/60 bg-emerald-950/20 flex items-center justify-between gap-4">
          <div><div className="text-sm font-semibold text-emerald-200">Claimable refund</div><div className="text-xs text-emerald-300/70">{session.claimableUSDC} USDC is held by the settlement contract.</div></div>
          <button onClick={onClaimRefund} className="px-4 py-2 rounded-lg bg-emerald-400 text-black text-xs font-bold">Claim refund</button>
        </div>
      )}

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

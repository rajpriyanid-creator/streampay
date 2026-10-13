/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  Lock,
  ArrowRight,
  Copy,
  Check,
  Binary,
  Layers,
  Coins,
  AlertTriangle
} from 'lucide-react';
import { SegmentManifest, StreamManifest } from '../lib/protocol/manifest';
import { StreamSessionState, WalletState } from '../lib/protocol/sessionManager';

interface OpenSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  manifest: StreamManifest;
  wallet: WalletState;
  onConfirmOpen: (deposit: string) => Promise<void>;
}

export const OpenSessionModal: React.FC<OpenSessionModalProps> = ({
  isOpen,
  onClose,
  manifest,
  wallet,
  onConfirmOpen,
}) => {
  const [deposit, setDeposit] = useState('0.0500');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await onConfirmOpen(deposit);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open session');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-[#13100c] border border-[#382b1d] rounded-2xl shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#251b11] border border-[#43311f] flex items-center justify-center text-[#d89a4e]">
            <Coins className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Open Payment Session</h3>
            <p className="text-xs text-neutral-400">Stream: {manifest.title}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-800/40 text-red-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
              Initial Deposit (USDC)
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.001"
                min="0.005"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0806] border border-[#261e16] text-white text-sm font-mono focus:border-[#d89a4e] focus:outline-none"
                required
              />
              <span className="absolute right-3.5 top-2.5 text-xs font-bold text-[#d89a4e]">
                USDC
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">
              Supports ~{Math.floor(Number(deposit) / Number(manifest.unitPriceUSDC))} segments at {manifest.unitPriceUSDC} USDC/segment
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[#0b0907] border border-[#201912] space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-neutral-400">Payer Wallet:</span>
              <span className="font-mono text-neutral-200">
                {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Network:</span>
              <span className="text-neutral-200 capitalize">
                {wallet.network === 'testnet' ? 'Monad Testnet (10143)' : 'Local Anvil (31337)'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">EIP-712 Contract:</span>
              <span className="font-mono text-neutral-200">StreamPaySettlement v2.5</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#d99b4d] to-[#be833a] hover:from-[#e2a85e] hover:to-[#cd9146] text-black font-bold text-xs shadow-lg transition-all active:scale-98 disabled:opacity-50"
          >
            {isLoading ? 'Signing & Opening Session...' : 'Sign & Open Session'}
          </button>
        </form>
      </div>
    </div>
  );
};

interface ProofInspectorModalProps {
  segment: SegmentManifest | null;
  manifest: StreamManifest | null;
  onClose: () => void;
}

export const ProofInspectorModal: React.FC<ProofInspectorModalProps> = ({
  segment,
  manifest,
  onClose,
}) => {
  const [copied, setCopied] = useState<string | null>(null);

  if (!segment || !manifest) return null;

  const copyText = (val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-[#13100c] border border-[#382b1d] rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-[#231a12] mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e]">
              <Binary className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Cryptographic Proof Inspector</h3>
              <p className="text-xs text-neutral-400">
                Segment {segment.segmentIndex} · {segment.durationUnits} sec · {segment.byteLength} bytes
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Status Badge */}
          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Merkle Proof Verified mathematically against Manifest Root</span>
          </div>

          {/* Segment SHA-256 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-neutral-300">Segment Binary SHA-256</span>
              <button
                onClick={() => copyText(segment.segmentSha256, 'sha')}
                className="text-neutral-400 hover:text-white flex items-center gap-1 text-[11px]"
              >
                {copied === 'sha' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied === 'sha' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="p-2.5 rounded-lg bg-[#0a0806] border border-[#201912] font-mono text-[11px] text-neutral-200 break-all">
              {segment.segmentSha256}
            </div>
          </div>

          {/* Content & Rendition Hashes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="font-semibold text-neutral-300 block mb-1">Content ID Hash</span>
              <div className="p-2 rounded-lg bg-[#0a0806] border border-[#201912] font-mono text-[10px] text-neutral-300 truncate">
                {segment.contentIdHash}
              </div>
            </div>
            <div>
              <span className="font-semibold text-neutral-300 block mb-1">Rendition ID Hash</span>
              <div className="p-2 rounded-lg bg-[#0a0806] border border-[#201912] font-mono text-[10px] text-neutral-300 truncate">
                {segment.renditionIdHash}
              </div>
            </div>
          </div>

          {/* Merkle Proof Siblings */}
          <div>
            <span className="font-semibold text-neutral-300 block mb-1">
              Merkle Proof Sibling Nodes ({segment.merkleProof.length} levels)
            </span>
            <div className="space-y-1.5">
              {segment.merkleProof.map((proofHash, i) => (
                <div
                  key={i}
                  className="p-2 rounded-lg bg-[#0a0806] border border-[#201912] font-mono text-[10px] text-neutral-300 flex items-center justify-between"
                >
                  <span className="text-[#d89a4e] mr-2">Level {i}:</span>
                  <span className="truncate">{proofHash}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Manifest Root */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-neutral-300">Verified Manifest Root</span>
              <button
                onClick={() => copyText(manifest.manifestRoot, 'root')}
                className="text-neutral-400 hover:text-white flex items-center gap-1 text-[11px]"
              >
                {copied === 'root' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied === 'root' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="p-2.5 rounded-lg bg-[#0a0806] border border-[#201912] font-mono text-[11px] text-[#e8b56f] break-all">
              {manifest.manifestRoot}
            </div>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-[#231a12] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#241a12] hover:bg-[#2d2116] border border-[#433120] text-neutral-200 text-xs font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Wallet,
  Copy,
  Check,
  CreditCard,
  Lock,
  RefreshCw,
} from 'lucide-react';
import {
  WalletState,
  StreamSessionState,
} from '../lib/protocol/sessionManager';
import { HealthResponse } from '../lib/protocol/accessClient';

interface RightSidebarProps {
  wallet: WalletState;
  session: StreamSessionState;
  health: HealthResponse | null;
  onOpenSession: () => void;
  onCheckpointSession: () => void;
  onCloseSession: () => void;
  creatorAddress: string;
  onCreatorAddressChange: (value: string) => void;
  onSignCreatorOffer: () => void;
  onSignCreatorClose: () => void;
  onUseActiveCreator: () => void;
  onResetCreator: () => void;
  creatorOfferSigned: boolean;
  creatorCloseSigned: boolean;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  wallet,
  session,
  health,
  onOpenSession,
  onCheckpointSession,
  onCloseSession,
  creatorAddress,
  onCreatorAddressChange,
  onSignCreatorOffer,
  onSignCreatorClose,
  onUseActiveCreator,
  onResetCreator,
  creatorOfferSigned,
  creatorCloseSigned,
}) => {
  const [copied, setCopied] = useState(false);

  const truncatedAddress = wallet.address
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : 'Not Connected';

  const handleCopy = () => {
    if (!wallet.address) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isStep1Done = wallet.isConnected;
  const isStep2Done = session.status === 'active' || session.status === 'closed';
  const isStep3Done = session.cumulativeUnits > 0;
  const isStep4Done = session.verificationLogs.length > 0;
  const isStep5Done = session.status === 'closed';

  return (
    <aside className="w-[280px] xl:w-[310px] shrink-0 border-l border-[#1a150f] bg-[#0c0a08] p-3.5 sm:p-4 flex flex-col gap-3.5 select-none min-h-[calc(100vh-64px)]">
      {/* 1. Wallet & Network Card */}
      <div className="p-4 rounded-2xl bg-[#13100c] border border-[#241d16] shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white tracking-tight">
            Wallet & Network
          </h3>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-[11px] font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Connected</span>
          </div>
        </div>

        {/* Address Box matching screenshot */}
        <div className="p-2.5 rounded-xl bg-[#0b0907] border border-[#201912] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-[#241910] border border-[#3b2a1a] flex items-center justify-center text-[#d89a4e]">
              <Wallet className="w-3.5 h-3.5" />
            </div>
            <span className="font-mono text-xs font-semibold text-neutral-200">
              {truncatedAddress}
            </span>
          </div>

          <button
            onClick={handleCopy}
            className="p-1 text-[#8a7f72] hover:text-white transition-colors cursor-pointer"
            title="Copy address"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Details Rows */}
        <div className="space-y-1.5 pt-0.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#8a7f72] font-medium">Chain ID</span>
            <span className="font-mono text-neutral-200 font-medium">
              {wallet.chainId === 10143 ? '10143 (Testnet)' : '31337 (Local)'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8a7f72] font-medium">Network</span>
            <span className="font-mono text-neutral-200 font-medium">
              {wallet.network === 'testnet' ? 'Monad Testnet' : 'local (Anvil)'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Backend Status Card */}
      <div className="p-4 rounded-2xl bg-[#13100c] border border-[#241d16] shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white tracking-tight">
            Backend Status
          </h3>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-[11px] font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Online</span>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#8a7f72] font-medium">Service</span>
            <span className="text-neutral-200 font-medium">
              {health?.service || 'StreamPay Access Service'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8a7f72] font-medium">Mode</span>
            <span className="text-neutral-200 font-medium capitalize">
              {health?.mode || 'Simulation'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8a7f72] font-medium">Chain ID</span>
            <span className="font-mono text-neutral-200 font-medium">
              {health?.chainId || wallet.chainId}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8a7f72] font-medium">Available Streams</span>
            <span className="font-mono text-neutral-200 font-medium">
              {health?.availableStreams?.length || 2}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Payment Session Card */}
      <div className="p-4 rounded-2xl bg-[#13100c] border border-[#241d16] shadow-sm space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white tracking-tight">
            Payment Session
          </h3>
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
              session.status === 'active'
                ? 'bg-emerald-950/40 border border-emerald-800/40 text-emerald-400'
                : 'bg-neutral-800/40 border border-neutral-700/40 text-[#8a7f72]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                session.status === 'active'
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-neutral-500'
              }`}
            />
            <span>{session.status === 'active' ? 'Active' : 'Not Active'}</span>
          </div>
        </div>

        <p className="text-xs text-[#8a7f72]">
          {session.status === 'active' ? (
            <span className="font-mono text-neutral-300">
              Units: <strong className="text-[#e8b56f]">{session.cumulativeUnits}</strong> · Paid:{' '}
              <strong className="text-[#e8b56f]">{session.unredeemedUSDC} USDC</strong>
            </span>
          ) : (
            'Open a session to start streaming'
          )}
        </p>

        {/* CTA Button */}
        {session.status === 'inactive' || session.status === 'opening' || session.status === 'closed' ? (
          <button
            onClick={onOpenSession}
            disabled={session.status === 'opening'}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#d99b4d] to-[#be833a] hover:from-[#e2a85e] hover:to-[#cd9146] text-black font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(217,155,77,0.25)] transition-all active:scale-98 cursor-pointer disabled:opacity-50"
          >
            <CreditCard className="w-4 h-4 fill-black/20" />
            <span>{session.status === 'opening' ? 'Opening Session...' : 'Open Payment Session'}</span>
          </button>
        ) : (
          <div className="space-y-2">
            <button
              onClick={onCheckpointSession}
              disabled={session.status === 'checkpointing'}
              className="w-full py-2.5 px-4 rounded-xl bg-[#241a12] hover:bg-[#2d2116] border border-[#523d24] text-[#e8b56f] font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${session.status === 'checkpointing' ? 'animate-spin' : ''}`} />
              <span>{session.status === 'checkpointing' ? 'Checkpointing...' : 'Checkpoint Session'}</span>
            </button>
            <button
              onClick={onCloseSession}
              disabled={session.status === 'closing'}
              className="w-full py-2.5 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{session.status === 'closing' ? 'Closing...' : 'Close Session Cooperatively'}</span>
            </button>
          </div>
        )}

        {/* 5-Step Stepper */}
        <div className="pt-2 space-y-3.5">
          {/* Step 1 */}
          <div className="flex items-start gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                isStep1Done
                  ? 'bg-[#d89a4e] text-black shadow-[0_0_8px_rgba(216,154,78,0.5)]'
                  : 'bg-[#1e1710] text-[#786b5c] border border-[#2d2217]'
              }`}
            >
              1
            </div>
            <div>
              <div
                className={`text-xs font-semibold ${
                  isStep1Done ? 'text-white' : 'text-[#8a7f72]'
                }`}
              >
                Connect Wallet
              </div>
              <div className="text-[11px] text-[#8a7f72] mt-0.5">
                Connect your wallet to continue
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-start gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                isStep2Done
                  ? 'bg-[#d89a4e] text-black shadow-[0_0_8px_rgba(216,154,78,0.5)]'
                  : 'bg-[#1e1710] text-[#786b5c] border border-[#2d2217]'
              }`}
            >
              2
            </div>
            <div>
              <div
                className={`text-xs font-semibold ${
                  isStep2Done ? 'text-white' : 'text-[#8a7f72]'
                }`}
              >
                Open Session
              </div>
              <div className="text-[11px] text-[#8a7f72] mt-0.5">
                Create a payment session
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex items-start gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                isStep3Done
                  ? 'bg-[#d89a4e] text-black shadow-[0_0_8px_rgba(216,154,78,0.5)]'
                  : 'bg-[#1e1710] text-[#786b5c] border border-[#2d2217]'
              }`}
            >
              3
            </div>
            <div>
              <div
                className={`text-xs font-semibold ${
                  isStep3Done ? 'text-white' : 'text-[#8a7f72]'
                }`}
              >
                Request Segment
              </div>
              <div className="text-[11px] text-[#8a7f72] mt-0.5">
                Get signed voucher
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex items-start gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                isStep4Done
                  ? 'bg-[#d89a4e] text-black shadow-[0_0_8px_rgba(216,154,78,0.5)]'
                  : 'bg-[#1e1710] text-[#786b5c] border border-[#2d2217]'
              }`}
            >
              4
            </div>
            <div>
              <div
                className={`text-xs font-semibold ${
                  isStep4Done ? 'text-white' : 'text-[#8a7f72]'
                }`}
              >
                Download & Verify
              </div>
              <div className="text-[11px] text-[#8a7f72] mt-0.5">
                Stream and verify segment
              </div>
            </div>
          </div>

          {/* Step 5 */}
          <div className="flex items-start gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                isStep5Done
                  ? 'bg-[#d89a4e] text-black shadow-[0_0_8px_rgba(216,154,78,0.5)]'
                  : 'bg-[#1e1710] text-[#786b5c] border border-[#2d2217]'
              }`}
            >
              5
            </div>
            <div>
              <div
                className={`text-xs font-semibold ${
                  isStep5Done ? 'text-white' : 'text-[#8a7f72]'
                }`}
              >
                Close Session
              </div>
              <div className="text-[11px] text-[#8a7f72] mt-0.5">
                Settle and close cooperatively
              </div>
            </div>
          </div>
        </div>
      </div>

      {wallet.network === 'testnet' && (
        <div className="p-4 rounded-2xl bg-[#13100c] border border-[#241d16] shadow-sm space-y-3">
          <div>
            <h3 className="text-sm font-bold text-white">Creator authorization</h3>
            <p className="text-[11px] text-[#8a7f72] mt-1">Use a second Rabby account. The Creator signs the offer before the Payer opens the session.</p>
          </div>
          <input value={creatorAddress} onChange={(e) => onCreatorAddressChange(e.target.value)} placeholder="Creator 0x address" className="w-full px-3 py-2 rounded-lg bg-[#0a0806] border border-[#261e16] text-white text-xs font-mono" disabled={creatorOfferSigned} />
          <button onClick={onUseActiveCreator} disabled={creatorOfferSigned} className="w-full py-2 rounded-lg bg-[#1b1510] border border-[#3b2a1a] text-neutral-300 text-xs disabled:opacity-50">Use active Rabby account as Creator</button>
          <button onClick={onSignCreatorOffer} disabled={creatorOfferSigned || !creatorAddress} className="w-full py-2 rounded-lg bg-[#241a12] border border-[#523d24] text-[#e8b56f] text-xs font-semibold disabled:opacity-50">{creatorOfferSigned ? 'Offer signed by Creator' : 'Sign Content Offer'}</button>
          {creatorOfferSigned && <button onClick={onResetCreator} className="w-full py-2 rounded-lg bg-red-950/30 border border-red-800/40 text-red-300 text-xs font-semibold">Reset Creator Authorization</button>}
          {session.status === 'active' && <button onClick={onSignCreatorClose} disabled={creatorCloseSigned} className="w-full py-2 rounded-lg bg-[#241a12] border border-[#523d24] text-[#e8b56f] text-xs font-semibold disabled:opacity-50">{creatorCloseSigned ? 'Close authorization signed' : 'Sign Close Authorization'}</button>}
        </div>
      )}
    </aside>
  );
};

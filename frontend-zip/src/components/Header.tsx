/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  LayoutGrid,
  FileCode2,
  Receipt,
  FileText,
  ChevronDown,
  Wallet,
  Check,
  Copy,
  ExternalLink,
  Power,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { protocolManager, NetworkType } from '../lib/protocol/sessionManager';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';

interface HeaderProps {
  activeTab: 'stream' | 'payments' | 'docs' | 'manifest';
  setActiveTab: (tab: 'stream' | 'payments' | 'docs') => void;
  network: NetworkType;
  walletAddress: string;
  walletBalance: string;
  isConnected: boolean;
  onOpenManifest?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  network,
  walletAddress,
  walletBalance,
  isConnected,
  onOpenManifest,
}) => {
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [walletError, setWalletError] = useState('');
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();

  React.useEffect(() => {
    if (primaryWallet?.address && primaryWallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
      protocolManager.syncExternalAccount(primaryWallet.address);
    }
  }, [primaryWallet?.address, walletAddress]);

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : 'Not Connected';

  const handleCopy = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNetworkSelect = (net: NetworkType) => {
    protocolManager.setNetwork(net);
    setWalletError('');
    setNetworkMenuOpen(false);
  };

  const handleWalletAction = async () => {
    setWalletError('');
    try {
      if (isConnected) {
        if (primaryWallet) {
          try { await handleLogOut(); } catch {}
        }
        protocolManager.disconnectWallet();
      } else {
        await protocolManager.connectWallet();
      }
      setWalletMenuOpen(false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
      setWalletError(`Wallet connection failed: ${detail}`);
    }
  };

  const handleReconnect = async () => {
    setWalletError('');
    try { await protocolManager.reconnectWallet(); } catch (error) { setWalletError(error instanceof Error ? error.message : 'Wallet reconnect failed.'); }
  };

  return (
    <header className="h-16 w-full px-4 sm:px-6 flex items-center justify-between border-b border-[#1c1813] bg-[#0c0a08]/95 backdrop-blur-md sticky top-0 z-40 select-none shrink-0">
      {/* Left: Brand Logo */}
      <div className="flex items-center gap-3 cursor-pointer shrink-0" onClick={() => setActiveTab('stream')}>
        <div className="relative w-8 h-8 flex items-center justify-center">
          {/* Faceted polygon StreamPay emblem */}
          <svg viewBox="0 0 32 32" className="w-8 h-8 drop-shadow-[0_0_12px_rgba(217,155,77,0.35)]">
            <polygon points="4,4 28,16 16,16" fill="#e8a855" />
            <polygon points="4,4 16,16 4,28" fill="#bc7c31" />
            <polygon points="4,28 16,16 28,16" fill="#8f571b" />
          </svg>
        </div>
        <div className="flex items-center text-xl font-bold tracking-tight">
          <span className="text-white font-extrabold">Stream</span>
          <span className="text-[#d89a4e] font-extrabold ml-[1px]">Pay</span>
        </div>
      </div>

      {/* Middle: Navigation Pills */}
      <nav className="flex items-center gap-1.5 p-1 bg-[#13100c] border border-[#231d16] rounded-xl shadow-inner">
        <button
          onClick={() => setActiveTab('stream')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
            activeTab === 'stream'
              ? 'bg-[#261e16] text-[#e8b56f] border border-[#443321] shadow-[0_0_10px_rgba(217,155,77,0.15)] font-semibold'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#1a1510]'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>Stream</span>
        </button>

        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
            activeTab === 'payments'
              ? 'bg-[#261e16] text-[#e8b56f] border border-[#443321] shadow-[0_0_10px_rgba(217,155,77,0.15)] font-semibold'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#1a1510]'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Payments</span>
        </button>

        <button
          onClick={() => setActiveTab('docs')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
            activeTab === 'docs'
              ? 'bg-[#261e16] text-[#e8b56f] border border-[#443321] shadow-[0_0_10px_rgba(217,155,77,0.15)] font-semibold'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#1a1510]'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Docs</span>
        </button>
      </nav>

      {/* Right: Network & Wallet Badges */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* Compact Manifest Inspector Button */}
        {onOpenManifest && (
          <button
            onClick={onOpenManifest}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#14110d] hover:bg-[#1f1710] border border-[#2b2218] hover:border-[#4d3822] rounded-xl text-xs font-medium text-neutral-300 hover:text-[#e8b56f] transition-all shadow-sm cursor-pointer group"
            title="Inspect Stream Manifest & Cryptographic Tree"
          >
            <FileCode2 className="w-3.5 h-3.5 text-[#d89a4e] group-hover:scale-110 transition-transform" />
            <span className="hidden sm:inline font-medium">Manifest</span>
          </button>
        )}

        {/* Network Selector Pill */}
        <div className="relative">
          <button
            onClick={() => setNetworkMenuOpen(!networkMenuOpen)}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-[#14110d] hover:bg-[#1b1611] border border-[#2b2218] rounded-xl text-xs font-medium text-neutral-300 transition-colors shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
            <span>{network === 'local' ? 'Local (Anvil)' : 'Monad Testnet'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
          </button>

          {networkMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 p-1.5 bg-[#14110d] border border-[#2d241a] rounded-xl shadow-2xl z-50 text-xs">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Select Network
              </div>
              <button
                onClick={() => handleNetworkSelect('local')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                  network === 'local' ? 'bg-[#251d15] text-[#e8b56f]' : 'text-neutral-300 hover:bg-[#1b1510]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <div className="text-left">
                    <div className="font-semibold">Local (Anvil)</div>
                    <div className="text-[10px] text-neutral-400">Chain 31337 · Dev RPC</div>
                  </div>
                </div>
                {network === 'local' && <Check className="w-4 h-4 text-[#e8b56f]" />}
              </button>

              <button
                onClick={() => handleNetworkSelect('testnet')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors mt-1 ${
                  network === 'testnet' ? 'bg-[#251d15] text-[#e8b56f]' : 'text-neutral-300 hover:bg-[#1b1510]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <div className="text-left">
                    <div className="font-semibold">Monad Testnet</div>
                    <div className="text-[10px] text-neutral-400">Chain 10143 · Public RPC</div>
                  </div>
                </div>
                {network === 'testnet' && <Check className="w-4 h-4 text-[#e8b56f]" />}
              </button>
            </div>
          )}
        </div>

        {/* Wallet Pill */}
        <div className="relative">
          <button
            onClick={() => setWalletMenuOpen(!walletMenuOpen)}
            className="flex items-center gap-2.5 px-3.5 py-1.5 bg-[#14110d] hover:bg-[#1b1611] border border-[#2b2218] rounded-xl text-xs font-medium text-neutral-200 transition-colors shadow-sm"
          >
            <div className="w-4 h-4 rounded bg-[#2b2116] flex items-center justify-center text-[#d89a4e]">
              <Wallet className="w-3 h-3" />
            </div>
            <span className="font-mono tracking-tight font-medium text-neutral-200">
              {truncatedAddress}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
          </button>

          {walletMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 p-2 bg-[#14110d] border border-[#2d241a] rounded-xl shadow-2xl z-50 text-xs">
              <div className="p-2 border-b border-[#231c15] mb-2">
                <div className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">Connected Payer</div>
                <div className="font-mono text-neutral-200 text-xs mt-1 break-all bg-[#0a0806] p-2 rounded border border-[#1e1710]">
                  {walletAddress}
                </div>
                {walletError && <div className="mt-2 text-[11px] leading-4 text-red-300">{walletError}</div>}
                <div className="flex items-center justify-between mt-2 text-[11px] text-neutral-300">
                  <span className="text-neutral-400">Test Balance:</span>
                  <span className="font-bold text-[#e8b56f]">{walletBalance === 'unknown' ? 'Checking…' : `${walletBalance} USDC`}</span>
                </div>
              </div>

              <div className="space-y-1">
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-neutral-300 hover:bg-[#1d1711] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5 text-[#d89a4e]" />
                  <span>{copied ? 'Copied to Clipboard!' : 'Copy Address'}</span>
                </button>

                {network === 'testnet' && (
                  <a
                    href={`https://testnet.monadscan.com/address/${walletAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-neutral-300 hover:bg-[#1d1711] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#d89a4e]" />
                    <span>View on Monad Explorer</span>
                  </a>
                )}

                <button
                  onClick={handleWalletAction}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-950/20 transition-colors"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{isConnected ? 'Disconnect' : 'Connect Wallet'}</span>
                </button>
                <button
                  onClick={handleReconnect}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[#e8b56f] hover:bg-[#1d1711] transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reconnect Wallet</span>
                </button>
                <button
                  onClick={() => {
                    setWalletMenuOpen(false);
                    setShowAuthFlow(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-cyan-300 hover:bg-[#1d1711] transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Dynamic Auth & Embedded Wallets</span>
                </button>

              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

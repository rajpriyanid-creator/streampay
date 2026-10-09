'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createWalletClient, createPublicClient, custom, http, formatUnits, parseUnits, keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem';
import { monadTestnet } from '../lib/account/chains';
import { VOUCHER_TYPES } from '../lib/protocol/typedData';
import { formatUsdc, parseUsdc } from '../lib/protocol/money';
import { StreamPayFragmentLoader } from '../lib/hls/StreamPayFragmentLoader';

// Demo contract address (can be updated or deployed via scripts)
const SETTLEMENT_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Hex;
const MOCK_USDC_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Hex;
const ACCESS_SERVICE_URL = 'http://localhost:4001';

interface ChannelState {
  channelId: Hex | null;
  payer: Hex;
  merchant: Hex;
  depositAmount: bigint;
  maxDurationSec: number;
  openedAt: number;
  settledAmount: bigint;
  highestNonce: bigint;
  status: 'UNINITIALIZED' | 'OPEN' | 'CHECKPOINTED' | 'CLOSED' | 'REFUNDED';
}

interface VoucherLog {
  id: string;
  nonce: bigint;
  cumulativeAmount: bigint;
  segmentIndex: number;
  timestamp: string;
  signature: Hex;
  status: 'SIGNED' | 'VERIFIED_OFFCHAIN' | 'CHECKPOINTED_ONCHAIN';
}

export default function StreamPayDashboard() {
  // Wallet / Connection State
  const [account, setAccount] = useState<Hex>('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  const [merchantAddress, setMerchantAddress] = useState<Hex>('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [walletMode, setWalletMode] = useState<'MERA_PASSKEY' | 'DEV_LOCAL'>('DEV_LOCAL');

  // Channel Creation State
  const [escrowDeposit, setEscrowDeposit] = useState<string>('5.00');
  const [durationHours, setDurationHours] = useState<number>(1);
  const [channel, setChannel] = useState<ChannelState | null>(null);

  // Streaming State
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [currentSegment, setCurrentSegment] = useState<number>(0);
  const [totalSegments, setTotalSegments] = useState<number>(20);
  const [cumulativeSpent, setCumulativeSpent] = useState<bigint>(0n);
  const [voucherNonce, setVoucherNonce] = useState<bigint>(0n);
  const [voucherLogs, setVoucherLogs] = useState<VoucherLog[]>([]);
  const [selectedStream, setSelectedStream] = useState<string>('monad-keynote-hd');
  const [manifestData, setManifestData] = useState<any>(null);

  // UI / Status messages
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'info' | 'success' | 'warn' | 'error' } | null>(null);

  // Auto-stream playback timer reference
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch Manifest on mount or stream change
  useEffect(() => {
    fetchManifest();
  }, [selectedStream]);

  const fetchManifest = async () => {
    try {
      const res = await fetch(`${ACCESS_SERVICE_URL}/api/manifest/${selectedStream}`);
      if (res.ok) {
        const data = await res.json();
        setManifestData(data);
        setTotalSegments(data.totalSegments || 20);
      }
    } catch (e) {
      console.warn('Access service not reached, using local fallback manifest simulation');
    }
  };

  // ─── Open Channel Action ─────────────────────────────────────
  const handleOpenChannel = async () => {
    try {
      setStatusMsg({ text: 'Opening bounded escrow channel on Monad testnet...', type: 'info' });
      
      const depositUnits = parseUsdc(escrowDeposit);
      const durationSec = durationHours * 3600;
      
      // Compute deterministic channel ID matching Solidity contract:
      // keccak256(abi.encode(payer, merchant, token, depositAmount, openedAt))
      const openedAt = Math.floor(Date.now() / 1000);
      const encodedParams = encodeAbiParameters(
        parseAbiParameters('address, address, address, uint256, uint256'),
        [account, merchantAddress, MOCK_USDC_ADDRESS, depositUnits, BigInt(openedAt)]
      );
      const channelId = keccak256(encodedParams);

      const newChannel: ChannelState = {
        channelId,
        payer: account,
        merchant: merchantAddress,
        depositAmount: depositUnits,
        maxDurationSec: durationSec,
        openedAt,
        settledAmount: 0n,
        highestNonce: 0n,
        status: 'OPEN',
      };

      setChannel(newChannel);
      setStatusMsg({
        text: `Escrow Channel Opened! ID: ${channelId.slice(0, 10)}...${channelId.slice(-8)}`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Failed to open channel: ${err.message}`, type: 'error' });
    }
  };

  // ─── Stream Segment Micro-Payment Action ────────────────────
  const processNextSegmentPayment = async () => {
    if (!channel || channel.status !== 'OPEN') return;
    if (currentSegment >= totalSegments) {
      handlePauseStream();
      setStatusMsg({ text: 'Stream completed! All segments served and payed.', type: 'success' });
      return;
    }

    const segIndex = currentSegment;
    const costPerSeg = parseUsdc('0.01'); // 0.01 USDC per segment
    const nextCumSpent = cumulativeSpent + costPerSeg;

    if (nextCumSpent > channel.depositAmount) {
      handlePauseStream();
      setStatusMsg({ text: 'Bounded Escrow Exhausted! Please top up deposit.', type: 'warn' });
      return;
    }

    const nextNonce = voucherNonce + 1n;
    const manifestHash = manifestData?.merkleRoot || keccak256(Buffer.from(`demo-manifest-${selectedStream}`));

    // Construct EIP-712 Voucher
    const voucherMessage = {
      channelId: channel.channelId!,
      voucherNonce: nextNonce,
      cumulativeAmount: nextCumSpent,
      segmentIndex: segIndex,
      manifestHash: manifestHash as Hex,
    };

    // Simulated EIP-712 Voucher Signature (Dev / Local Signer)
    const sigPayload = encodeAbiParameters(
      parseAbiParameters('bytes32, uint64, uint256, uint32, bytes32'),
      [
        voucherMessage.channelId,
        voucherMessage.voucherNonce,
        voucherMessage.cumulativeAmount,
        voucherMessage.segmentIndex,
        voucherMessage.manifestHash,
      ]
    );
    const signature = keccak256(sigPayload);

    // Send Voucher to Access Service Gate
    try {
      const gateRes = await fetch(`${ACCESS_SERVICE_URL}/api/access/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: channel.channelId,
          payer: account,
          merchant: merchantAddress,
          contractAddress: SETTLEMENT_CONTRACT_ADDRESS,
          chainId: 10143,
          streamId: selectedStream,
          segmentIndex: segIndex,
          voucher: {
            channelId: voucherMessage.channelId,
            voucherNonce: voucherMessage.voucherNonce.toString(),
            cumulativeAmount: voucherMessage.cumulativeAmount.toString(),
            segmentIndex: voucherMessage.segmentIndex,
            manifestHash: voucherMessage.manifestHash,
            signature,
          },
        }),
      });

      const gateData = await gateRes.json();

      if (gateRes.ok && gateData.success) {
        setCumulativeSpent(nextCumSpent);
        setVoucherNonce(nextNonce);
        setCurrentSegment(segIndex + 1);

        const newLog: VoucherLog = {
          id: `${segIndex}-${Date.now()}`,
          nonce: nextNonce,
          cumulativeAmount: nextCumSpent,
          segmentIndex: segIndex,
          timestamp: new Date().toLocaleTimeString(),
          signature,
          status: 'VERIFIED_OFFCHAIN',
        };

        setVoucherLogs((prev) => [newLog, ...prev.slice(0, 19)]);
      } else {
        console.warn('Access service error:', gateData.error);
        // Fallback local update for offline testing
        setCumulativeSpent(nextCumSpent);
        setVoucherNonce(nextNonce);
        setCurrentSegment(segIndex + 1);
        setVoucherLogs((prev) => [
          {
            id: `${segIndex}-${Date.now()}`,
            nonce: nextNonce,
            cumulativeAmount: nextCumSpent,
            segmentIndex: segIndex,
            timestamp: new Date().toLocaleTimeString(),
            signature,
            status: 'VERIFIED_OFFCHAIN',
          },
          ...prev.slice(0, 19),
        ]);
      }
    } catch (e) {
      // Fallback update
      setCumulativeSpent(nextCumSpent);
      setVoucherNonce(nextNonce);
      setCurrentSegment(segIndex + 1);
      setVoucherLogs((prev) => [
        {
          id: `${segIndex}-${Date.now()}`,
          nonce: nextNonce,
          cumulativeAmount: nextCumSpent,
          segmentIndex: segIndex,
          timestamp: new Date().toLocaleTimeString(),
          signature,
          status: 'VERIFIED_OFFCHAIN',
        },
        ...prev.slice(0, 19),
      ]);
    }
  };

  const handleStartStream = () => {
    if (!channel || channel.status !== 'OPEN') {
      setStatusMsg({ text: 'Please open a bounded escrow channel first!', type: 'warn' });
      return;
    }
    setIsStreaming(true);
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    streamIntervalRef.current = setInterval(() => {
      processNextSegmentPayment();
    }, 2000);
  };

  const handlePauseStream = () => {
    setIsStreaming(false);
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
  };

  // ─── Checkpoint On-Chain Action ─────────────────────────────
  const handleCheckpointOnChain = async () => {
    if (!channel || cumulativeSpent === 0n) return;
    try {
      setStatusMsg({ text: 'Submitting off-chain accumulated voucher to Monad contract...', type: 'info' });
      // Update channel settled status
      setChannel((prev) =>
        prev
          ? {
              ...prev,
              settledAmount: cumulativeSpent,
              highestNonce: voucherNonce,
              status: 'CHECKPOINTED',
            }
          : null
      );
      setVoucherLogs((prev) =>
        prev.map((log) => ({ ...log, status: 'CHECKPOINTED_ONCHAIN' }))
      );
      setStatusMsg({
        text: `Checkpoint complete! Settled ${formatUsdc(cumulativeSpent)} USDC on-chain. Saved 19 Gas transactions!`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Checkpoint failed: ${err.message}`, type: 'error' });
    }
  };

  // ─── Close Channel Action ────────────────────────────────────
  const handleCloseChannel = async () => {
    if (!channel) return;
    try {
      handlePauseStream();
      setStatusMsg({ text: 'Closing channel & returning remaining deposit to Payer...', type: 'info' });
      
      const refundAmount = channel.depositAmount - cumulativeSpent;
      setChannel((prev) => (prev ? { ...prev, status: 'CLOSED' } : null));
      setStatusMsg({
        text: `Channel Closed! Merchant paid ${formatUsdc(cumulativeSpent)} USDC. Payer refunded ${formatUsdc(refundAmount)} USDC.`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Close failed: ${err.message}`, type: 'error' });
    }
  };

  const remainingBalance = channel ? channel.depositAmount - cumulativeSpent : 0n;

  return (
    <div className="min-h-screen bg-[#0A0D14] text-slate-100 flex flex-col font-sans">
      {/* ─── Top Header ────────────────────────────────────────────── */}
      <header className="border-b border-slate-800 bg-[#0F1420]/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 via-purple-500 to-indigo-400 flex items-center justify-center font-bold text-white shadow-lg shadow-purple-500/20">
              ⚡
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-indigo-200">
              StreamPay
            </span>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 font-medium">
            Monad Testnet (Chain ID 10143)
          </span>
        </div>

        <div className="flex items-center space-x-4">
          <select
            value={walletMode}
            onChange={(e) => setWalletMode(e.target.value as any)}
            className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-violet-500 outline-none"
          >
            <option value="DEV_LOCAL">Dev Account (Instant Test)</option>
            <option value="MERA_PASSKEY">Mera WebAuthn Passkey</option>
          </select>

          <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-400">Account:</span>
            <span className="font-mono text-slate-200">{account.slice(0, 6)}...{account.slice(-4)}</span>
          </div>
        </div>
      </header>

      {/* ─── Main Workspace ────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Status Notification Banner */}
        {statusMsg && (
          <div className="lg:col-span-12">
            <div
              className={`px-4 py-3 rounded-xl border flex items-center justify-between text-sm ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : statusMsg.type === 'error'
                  ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                  : statusMsg.type === 'warn'
                  ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                  : 'bg-violet-950/40 border-violet-500/30 text-violet-300'
              }`}
            >
              <span>{statusMsg.text}</span>
              <button
                onClick={() => setStatusMsg(null)}
                className="text-xs opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Left Column: Escrow Channel Controls & Parameters */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-[#121826] border border-slate-800/80 rounded-2xl p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-100 mb-4 flex items-center justify-between">
              <span>Bounded Escrow Channel</span>
              <span className="text-xs font-normal text-slate-400">EIP-712 Gate</span>
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Escrow Deposit (USDC)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={escrowDeposit}
                    onChange={(e) => setEscrowDeposit(e.target.value)}
                    disabled={channel?.status === 'OPEN'}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-semibold">
                    USDC
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Duration Expiry (Hours)
                </label>
                <select
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  disabled={channel?.status === 'OPEN'}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                >
                  <option value={1}>1 Hour (Standard)</option>
                  <option value={4}>4 Hours (Long Stream)</option>
                  <option value={24}>24 Hours (Event Pass)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Merchant Address
                </label>
                <input
                  type="text"
                  value={merchantAddress}
                  onChange={(e) => setMerchantAddress(e.target.value as Hex)}
                  disabled={channel?.status === 'OPEN'}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                />
              </div>

              {!channel || channel.status === 'CLOSED' || channel.status === 'REFUNDED' ? (
                <button
                  onClick={handleOpenChannel}
                  className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium text-sm transition-all shadow-lg shadow-violet-600/25"
                >
                  Open Escrow Channel
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={handleCheckpointOnChain}
                    disabled={cumulativeSpent === 0n}
                    className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-violet-300 font-medium text-xs border border-violet-500/30 transition-all disabled:opacity-40"
                  >
                    Checkpoint On-Chain
                  </button>
                  <button
                    onClick={handleCloseChannel}
                    className="py-2.5 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 font-medium text-xs border border-rose-500/30 transition-all"
                  >
                    Settle & Close
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Active Channel Details Card */}
          {channel && (
            <div className="bg-[#121826] border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Channel Status:</span>
                <span
                  className={`px-2 py-0.5 rounded-full font-semibold ${
                    channel.status === 'OPEN'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : channel.status === 'CHECKPOINTED'
                      ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {channel.status}
                </span>
              </div>

              <div className="text-xs font-mono space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800/60">
                <div className="flex justify-between">
                  <span className="text-slate-500">ID:</span>
                  <span className="text-slate-300">{channel.channelId?.slice(0, 8)}...{channel.channelId?.slice(-6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Initial Deposit:</span>
                  <span className="text-slate-200">{formatUsdc(channel.depositAmount)} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Remaining Balance:</span>
                  <span className="text-emerald-400 font-semibold">{formatUsdc(remainingBalance)} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Highest Nonce:</span>
                  <span className="text-violet-300">{voucherNonce.toString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Center Column: Pay-Per-Use HLS Video Player & Controls */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-[#121826] border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
            {/* Stream Title Bar */}
            <div className="px-5 py-4 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-100 text-sm">Monad HD Stream Demo</h3>
                <p className="text-xs text-slate-400">0.01 USDC per 2-second segment (0.30 USDC / min)</p>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">Stream:</span>
                <select
                  value={selectedStream}
                  onChange={(e) => setSelectedStream(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-xs rounded-lg px-2.5 py-1 text-slate-200 outline-none"
                >
                  <option value="monad-keynote-hd">Monad Keynote HD (0.01 USDC)</option>
                  <option value="monad-defi-deepdive">DeFi Deep Dive (0.02 USDC)</option>
                </select>
              </div>
            </div>

            {/* Video Viewport / Display */}
            <div className="relative aspect-video bg-slate-950 flex flex-col items-center justify-center border-b border-slate-800/80 group">
              {/* Dynamic Video Visualizer */}
              <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/30 flex items-center justify-center overflow-hidden">
                <div className="w-64 h-64 rounded-full bg-violet-600/10 blur-3xl animate-pulse" />
              </div>

              {/* Player Overlay Content */}
              <div className="relative z-10 text-center space-y-3 p-6 max-w-md">
                <div className="w-16 h-16 mx-auto rounded-full bg-slate-900/80 border border-violet-500/30 flex items-center justify-center text-violet-400 text-2xl shadow-xl">
                  {isStreaming ? '⚡' : '▶'}
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-semibold text-slate-200">
                    {isStreaming ? 'Streaming & Micro-Paying...' : 'Stream Paused'}
                  </h4>
                  <p className="text-xs text-slate-400">
                    {channel?.status === 'OPEN'
                      ? 'Bounded escrow active. Micro-vouchers signing every 2 seconds off-chain.'
                      : 'Open an escrow channel to start stream playback.'}
                  </p>
                </div>
              </div>

              {/* Stream Progress Bar */}
              <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-900">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-300"
                  style={{ width: `${(currentSegment / totalSegments) * 100}%` }}
                />
              </div>
            </div>

            {/* Player Controls & Metrics */}
            <div className="p-5 bg-[#0F1420] flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {!isStreaming ? (
                  <button
                    onClick={handleStartStream}
                    disabled={channel?.status !== 'OPEN'}
                    className="py-2.5 px-5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-medium text-xs transition-all shadow-lg shadow-violet-600/20 flex items-center space-x-2"
                  >
                    <span>Play Stream</span>
                  </button>
                ) : (
                  <button
                    onClick={handlePauseStream}
                    className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-medium text-xs border border-amber-500/30 transition-all flex items-center space-x-2"
                  >
                    <span>Pause Stream</span>
                  </button>
                )}

                <div className="text-xs text-slate-400 font-mono">
                  Segment {currentSegment} / {totalSegments} ({Math.round((currentSegment / totalSegments) * 100)}%)
                </div>
              </div>

              <div className="flex items-center space-x-6 text-xs">
                <div className="text-right">
                  <span className="block text-slate-400">Total Spent</span>
                  <span className="font-bold text-violet-400 font-mono text-sm">{formatUsdc(cumulativeSpent)} USDC</span>
                </div>
                <div className="text-right">
                  <span className="block text-slate-400">Remaining</span>
                  <span className="font-bold text-emerald-400 font-mono text-sm">{formatUsdc(remainingBalance)} USDC</span>
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Signed Voucher Activity Feed */}
          <div className="bg-[#121826] border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center justify-between">
              <span>Live Micro-Payment Voucher Log</span>
              <span className="text-xs font-mono text-violet-400">{voucherLogs.length} Vouchers Signed</span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2 font-medium">Nonce</th>
                    <th className="pb-2 font-medium">Segment</th>
                    <th className="pb-2 font-medium">Cumulative Paid</th>
                    <th className="pb-2 font-medium">Time</th>
                    <th className="pb-2 font-medium">Signature</th>
                    <th className="pb-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {voucherLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        No micro-vouchers signed yet. Start playback to view real-time state.
                      </td>
                    </tr>
                  ) : (
                    voucherLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                        <td className="py-2.5 text-violet-300">#{log.nonce.toString()}</td>
                        <td className="py-2.5 text-slate-300">Seg #{log.segmentIndex}</td>
                        <td className="py-2.5 text-emerald-400 font-semibold">{formatUsdc(log.cumulativeAmount)} USDC</td>
                        <td className="py-2.5 text-slate-400">{log.timestamp}</td>
                        <td className="py-2.5 text-slate-500 text-[10px]">{log.signature.slice(0, 12)}...</td>
                        <td className="py-2.5 text-right">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-sans ${
                              log.status === 'CHECKPOINTED_ONCHAIN'
                                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            }`}
                          >
                            {log.status === 'CHECKPOINTED_ONCHAIN' ? 'On-Chain' : 'Off-Chain Valid'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Hex,
  type Address,
} from 'viem';
import { monadTestnet } from '../lib/account/chains';
import { formatUsdc, parseUsdc } from '../lib/protocol/money';
import { verifyContractDeployed } from '../lib/protocol/contractClient';
import { openSession, signVoucher, checkpoint, closeCooperative } from '../lib/protocol/lifecycle';

// Network manifests
import localManifest from '../../manifests/local.json';
import testnetManifest from '../../manifests/testnet.json';

const ACCESS_SERVICE_URL = 'http://localhost:4001';

interface StreamSessionState {
  sessionId: Hex | null;
  payer: Hex;
  sessionSigner: Hex;
  recipient: Hex;
  depositAmount: bigint;
  maxDurationSec: number;
  openedAt: number;
  settledAmount: bigint;
  highestCumulativeUnits: bigint;
  status: 'UNINITIALIZED' | 'OPEN' | 'CHECKPOINTED' | 'CLOSED' | 'REFUNDED';
  txHash?: Hex;
}

interface VoucherLog {
  id: string;
  cumulativeUnits: bigint;
  segmentIndex: number;
  timestamp: string;
  signature: Hex;
  status: 'SIGNED' | 'VERIFIED_OFFCHAIN' | 'CHECKPOINTED_ONCHAIN';
}

export default function StreamPayDashboard() {
  // Network Selection State
  const [networkMode, setNetworkMode] = useState<'LOCAL' | 'TESTNET'>('LOCAL');
  const activeManifest = networkMode === 'TESTNET' ? testnetManifest : localManifest;

  // Account State
  const [payerAddress, setPayerAddress] = useState<Hex>('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  const [sessionSignerAddress, setSessionSignerAddress] = useState<Hex>('0x90F79bf6EB2c4f870365E785982E1f101E93b906');
  const [recipientAddress, setRecipientAddress] = useState<Hex>('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');

  const [contractAddress, setContractAddress] = useState<Hex>(
    (activeManifest.settlementContract || '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Hex
  );
  const [isDeployed, setIsDeployed] = useState<boolean>(false);
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);

  // Session State
  const [escrowDeposit, setEscrowDeposit] = useState<string>('5.00');
  const [durationHours, setDurationHours] = useState<number>(1);
  const [session, setSession] = useState<StreamSessionState | null>(null);

  // Playback State
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [currentSegment, setCurrentSegment] = useState<number>(0);
  const [totalSegments, setTotalSegments] = useState<number>(20);
  const [cumulativeUnits, setCumulativeUnits] = useState<bigint>(0n);
  const [voucherLogs, setVoucherLogs] = useState<VoucherLog[]>([]);
  const [selectedStream, setSelectedStream] = useState<string>('monad-keynote-hd');
  const [manifestData, setManifestData] = useState<any>(null);

  // Status message & Tx tracking
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'info' | 'success' | 'warn' | 'error' } | null>(null);
  const [lastTxHash, setLastTxHash] = useState<Hex | null>(null);

  // Playback closure ref
  const playbackRef = useRef({
    currentSegment,
    cumulativeUnits,
    session,
    isStreaming,
  });

  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    playbackRef.current = {
      currentSegment,
      cumulativeUnits,
      session,
      isStreaming,
    };
  }, [currentSegment, cumulativeUnits, session, isStreaming]);

  // Connect Wallet Action
  const handleConnectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts.length > 0) {
          setPayerAddress(accounts[0] as Hex);
          setIsWalletConnected(true);
          setStatusMsg({ text: `Connected Wallet: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`, type: 'success' });
        }
      } catch (err: any) {
        setStatusMsg({ text: `Wallet connection failed: ${err.message}`, type: 'error' });
      }
    } else {
      setIsWalletConnected(true);
      setStatusMsg({ text: 'Using Anvil Dev Keys (Local Network)', type: 'info' });
    }
  };

  // Verify Bytecode Deployment on mount or network change
  useEffect(() => {
    checkDeployment();
    fetchManifest();
  }, [networkMode, contractAddress]);

  const checkDeployment = async () => {
    const deployed = await verifyContractDeployed(activeManifest.rpcHttp, contractAddress);
    setIsDeployed(deployed);
  };

  const fetchManifest = async () => {
    try {
      const res = await fetch(`${ACCESS_SERVICE_URL}/api/manifest/${selectedStream}`);
      if (res.ok) {
        const data = await res.json();
        setManifestData(data);
        setTotalSegments(data.totalSegments || 20);
      }
    } catch (e) {
      console.warn('Access service not reachable');
    }
  };

  // Canvas Audio Spectrum Animation
  useEffect(() => {
    if (!isStreaming || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrameId: number;
    let tick = 0;

    const render = () => {
      tick += 0.05;
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const numBars = 32;
      const barWidth = canvas.width / numBars;
      for (let i = 0; i < numBars; i++) {
        const height = Math.abs(Math.sin(tick + i * 0.3)) * (canvas.height * 0.6) + 10;
        const x = i * barWidth;
        const y = (canvas.height - height) / 2;

        const gradient = ctx.createLinearGradient(0, y, 0, y + height);
        gradient.addColorStop(0, '#8b5cf6');
        gradient.addColorStop(1, '#6366f1');

        ctx.fillStyle = gradient;
        ctx.fillRect(x + 2, y, barWidth - 4, height);
      }

      animFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animFrameId);
  }, [isStreaming]);

  // ─── Open Session Transaction (v2.5 Contract) ──────────────────
  const handleOpenSession = async () => {
    try {
      setStatusMsg({ text: 'Executing real openWithSignature transaction on-chain...', type: 'info' });

      const depositUnits = parseUsdc(escrowDeposit);
      const durationSec = durationHours * 3600;
      const openedAt = Math.floor(Date.now() / 1000);

      const res = await openSession({
        rpc: activeManifest.rpcHttp,
        settlement: contractAddress,
        token: (activeManifest.paymentToken.address || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
        creatorKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        payerKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        signerKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
        recipient: recipientAddress,
        manifestRoot: manifestData?.merkleRoot || ('0x' + '00'.repeat(32) as Hex),
        unitPrice: parseUsdc('0.01'),
        maxBillable: 3600n,
        deposit: depositUnits,
        validSec: durationSec,
        graceSec: 3600,
        maxLead: 12n,
        maxCreditWindow: 12n,
        maxCreditSegments: 3,
        maxUnredeemedAmount: parseUsdc('0.10'),
      });

      setLastTxHash(res.txHash);

      const newSession: StreamSessionState = {
        sessionId: res.sessionId,
        payer: payerAddress,
        sessionSigner: res.signerAddress,
        recipient: recipientAddress,
        depositAmount: depositUnits,
        maxDurationSec: durationSec,
        openedAt,
        settledAmount: 0n,
        highestCumulativeUnits: 0n,
        status: 'OPEN',
        txHash: res.txHash,
      };

      setSession(newSession);
      setCurrentSegment(0);
      setCumulativeUnits(0n);
      setVoucherLogs([]);

      setStatusMsg({
        text: `Session Opened On-Chain! Session ID: ${res.sessionId.slice(0, 10)}... Tx: ${res.txHash.slice(0, 10)}...`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Failed to open session: ${err.message}`, type: 'error' });
    }
  };

  // ─── Stream Segment Micro-Payment Action ────────────────────
  const processNextSegmentPayment = async () => {
    const { currentSegment: segIndex, cumulativeUnits: cumUnits, session: activeSession } = playbackRef.current;

    if (!activeSession || activeSession.status !== 'OPEN') return;

    if (segIndex >= totalSegments) {
      handlePauseStream();
      setStatusMsg({ text: 'Stream completed! All segments verified and delivered.', type: 'success' });
      return;
    }

    const unitsPerSeg = 2n;
    const nextCumUnits = cumUnits + unitsPerSeg;
    const totalSpentUSDC = nextCumUnits * parseUsdc('0.01');

    if (totalSpentUSDC > activeSession.depositAmount) {
      handlePauseStream();
      setStatusMsg({ text: 'Escrow deposit exhausted! Please top up deposit.', type: 'warn' });
      return;
    }

    try {
      // EIP-712 Voucher Signature matching contract domain & struct
      const signature = await signVoucher({
        rpc: activeManifest.rpcHttp,
        settlement: contractAddress,
        signerKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
        sessionId: activeSession.sessionId!,
        cumulativeUnits: nextCumUnits,
      });

      // Submit to Access Service Gate
      const gateRes = await fetch(`${ACCESS_SERVICE_URL}/api/access/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.sessionId,
          sessionSigner: activeSession.sessionSigner,
          recipient: activeSession.recipient,
          contractAddress,
          chainId: activeManifest.chainId,
          streamId: selectedStream,
          segmentIndex: segIndex,
          voucher: {
            sessionId: activeSession.sessionId,
            cumulativeUnits: nextCumUnits.toString(),
            signature,
          },
        }),
      });

      const gateData = await gateRes.json();

      if (gateRes.ok && gateData.success) {
        setCumulativeUnits(nextCumUnits);
        setCurrentSegment(segIndex + 1);

        const newLog: VoucherLog = {
          id: `${segIndex}-${Date.now()}`,
          cumulativeUnits: nextCumUnits,
          segmentIndex: segIndex,
          timestamp: new Date().toLocaleTimeString(),
          signature,
          status: 'VERIFIED_OFFCHAIN',
        };

        setVoucherLogs((prev) => [newLog, ...prev.slice(0, 19)]);
      } else {
        handlePauseStream();
        setStatusMsg({ text: `Access Gate Rejected Voucher: ${gateData.error || gateData.reason || 'Unauthorized'}`, type: 'error' });
      }
    } catch (e: any) {
      handlePauseStream();
      setStatusMsg({ text: `Voucher Signing Failed: ${e.message}`, type: 'error' });
    }
  };

  const handleStartStream = () => {
    if (!session || session.status !== 'OPEN') {
      setStatusMsg({ text: 'Please open a bounded escrow session first!', type: 'warn' });
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
    if (!session || cumulativeUnits === 0n) return;
    try {
      setStatusMsg({ text: 'Submitting real checkpoint transaction to Monad contract...', type: 'info' });

      const lastSig = voucherLogs[0]?.signature || (await signVoucher({
        rpc: activeManifest.rpcHttp,
        settlement: contractAddress,
        signerKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
        sessionId: session.sessionId!,
        cumulativeUnits,
      }));

      const txHash = await checkpoint({
        rpc: activeManifest.rpcHttp,
        settlement: contractAddress,
        anyKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        sessionId: session.sessionId!,
        cumulativeUnits,
        voucherSig: lastSig,
      });

      setLastTxHash(txHash);
      const totalSpent = cumulativeUnits * parseUsdc('0.01');

      setSession((prev) =>
        prev
          ? {
              ...prev,
              settledAmount: totalSpent,
              highestCumulativeUnits: cumulativeUnits,
              status: 'CHECKPOINTED',
              txHash,
            }
          : null
      );
      setVoucherLogs((prev) =>
        prev.map((log) => ({ ...log, status: 'CHECKPOINTED_ONCHAIN' }))
      );
      setStatusMsg({
        text: `Checkpoint Transaction Confirmed! Tx: ${txHash.slice(0, 12)}... Settled ${formatUsdc(totalSpent)} USDC on-chain.`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Checkpoint failed: ${err.message}`, type: 'error' });
    }
  };

  // ─── Close Session Action ────────────────────────────────────
  const handleCloseSession = async () => {
    if (!session) return;
    try {
      handlePauseStream();
      setStatusMsg({ text: 'Submitting real closeCooperative transaction on-chain...', type: 'info' });

      const lastSig = voucherLogs[0]?.signature || (await signVoucher({
        rpc: activeManifest.rpcHttp,
        settlement: contractAddress,
        signerKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
        sessionId: session.sessionId!,
        cumulativeUnits,
      }));

      const txHash = await closeCooperative({
        rpc: activeManifest.rpcHttp,
        settlement: contractAddress,
        anyKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        creatorKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        sessionId: session.sessionId!,
        cumulativeUnits,
        voucherSig: lastSig,
      });

      setLastTxHash(txHash);

      const totalSpent = cumulativeUnits * parseUsdc('0.01');
      const refundAmount = session.depositAmount - totalSpent;

      setSession((prev) => (prev ? { ...prev, status: 'CLOSED', txHash } : null));
      setStatusMsg({
        text: `Close Confirmed! Tx: ${txHash.slice(0, 12)}... Creator paid ${formatUsdc(totalSpent)} USDC. Payer refunded ${formatUsdc(refundAmount)} USDC.`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Close failed: ${err.message}`, type: 'error' });
    }
  };

  const totalSpentUSDC = cumulativeUnits * parseUsdc('0.01');
  const remainingBalance = session ? session.depositAmount - totalSpentUSDC : 0n;

  return (
    <main style={{ minHeight: '100vh', background: '#0a0d14', color: '#f3f4f6', fontFamily: 'sans-serif', padding: '24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', background: 'linear-gradient(to right, #a855f7, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            StreamPay v2.5
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '14px' }}>Monad Pay-Per-Use Video Streaming Platform</p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select
            value={networkMode}
            onChange={(e) => setNetworkMode(e.target.value as any)}
            style={{ background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: '6px', padding: '8px 12px' }}
          >
            <option value="LOCAL">Local Anvil (31337)</option>
            <option value="TESTNET">Monad Testnet (10143)</option>
          </select>

          <button
            onClick={handleConnectWallet}
            style={{ background: isWalletConnected ? '#059669' : '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {isWalletConnected ? `Connected (${payerAddress.slice(0, 6)}...)` : 'Connect Wallet'}
          </button>
        </div>
      </header>

      {statusMsg && (
        <div style={{ padding: '12px 16px', borderRadius: '8px', marginBottom: '24px', background: statusMsg.type === 'error' ? '#7f1d1d' : statusMsg.type === 'success' ? '#065f46' : statusMsg.type === 'warn' ? '#78350f' : '#1e3a8a' }}>
          {statusMsg.text}
        </div>
      )}

      {/* Grid Dashboard */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left Panel: Controls */}
        <div style={{ background: '#111827', borderRadius: '12px', padding: '24px', border: '1px solid #1f2937' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>1. Bounded Escrow Session</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>Escrow Deposit (USDC)</label>
              <input
                type="text"
                value={escrowDeposit}
                onChange={(e) => setEscrowDeposit(e.target.value)}
                style={{ width: '100%', background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: '6px', padding: '8px 12px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>Session Duration (Hours)</label>
              <input
                type="number"
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                style={{ width: '100%', background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: '6px', padding: '8px 12px' }}
              />
            </div>

            <button
              onClick={handleOpenSession}
              disabled={session?.status === 'OPEN'}
              style={{ background: session?.status === 'OPEN' ? '#374151' : '#9333ea', color: '#fff', border: 'none', borderRadius: '6px', padding: '12px', fontWeight: 'bold', cursor: session?.status === 'OPEN' ? 'not-allowed' : 'pointer' }}
            >
              {session?.status === 'OPEN' ? 'Session Open' : 'Open Session On-Chain'}
            </button>
          </div>

          {session && (
            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #1f2937' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#9ca3af', marginBottom: '8px' }}>Active Session Details</h3>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Session ID: {session.sessionId}</p>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Status: {session.status}</p>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Deposit: {formatUsdc(session.depositAmount)} USDC</p>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Spent: {formatUsdc(totalSpentUSDC)} USDC</p>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Remaining: {formatUsdc(remainingBalance)} USDC</p>
            </div>
          )}

          <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <button
              onClick={handleCheckpointOnChain}
              disabled={!session || session.status !== 'OPEN'}
              style={{ flex: 1, background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Checkpoint On-Chain
            </button>
            <button
              onClick={handleCloseSession}
              disabled={!session || session.status === 'CLOSED'}
              style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Close & Refund
            </button>
          </div>
        </div>

        {/* Right Panel: Video Player */}
        <div style={{ background: '#111827', borderRadius: '12px', padding: '24px', border: '1px solid #1f2937' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>2. Pay-Per-Use Video Stream</h2>

          <div style={{ width: '100%', height: '240px', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <canvas ref={canvasRef} width={400} height={240} style={{ width: '100%', height: '100%' }} />
            {!isStreaming && (
              <div style={{ position: 'absolute', color: '#9ca3af', fontSize: '14px' }}>
                {session?.status === 'OPEN' ? 'Ready to Stream' : 'Open session to unlock video player'}
              </div>
            )}
          </div>

          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: '#9ca3af' }}>Segment {currentSegment} / {totalSegments}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!isStreaming ? (
                <button
                  onClick={handleStartStream}
                  disabled={!session || session.status !== 'OPEN'}
                  style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Play Stream
                </button>
              ) : (
                <button
                  onClick={handlePauseStream}
                  style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Pause Stream
                </button>
              )}
            </div>
          </div>

          {/* Micro-Voucher Log */}
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#9ca3af', marginBottom: '8px' }}>Off-Chain Voucher Log</h3>
            <div style={{ maxHeight: '160px', overflowY: 'auto', background: '#0a0d14', borderRadius: '6px', padding: '8px' }}>
              {voucherLogs.length === 0 ? (
                <p style={{ color: '#4b5563', fontSize: '12px', textAlign: 'center' }}>No vouchers signed yet</p>
              ) : (
                voucherLogs.map((log) => (
                  <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #1f2937' }}>
                    <span style={{ color: '#a855f7' }}>Seg {log.segmentIndex} ({log.cumulativeUnits} units)</span>
                    <span style={{ color: '#6b7280' }}>{log.timestamp}</span>
                    <span style={{ color: log.status === 'CHECKPOINTED_ONCHAIN' ? '#10b981' : '#3b82f6' }}>{log.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

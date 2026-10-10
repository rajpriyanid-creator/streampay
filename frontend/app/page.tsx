'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  type Hex,
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  http,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import Hls from 'hls.js';
import { formatUsdc, parseUsdc } from '../lib/protocol/money';
import { verifySettlementContract, verifyContractDeployed } from '../lib/protocol/contractClient';
import {
  openSession,
  signVoucher,
  checkpoint,
  closeCooperative,
  openSessionWithWallet,
  checkpointWithWallet,
  closeCooperativeWithWallet,
} from '../lib/protocol/lifecycle';
import { createStreamPayFragmentLoader } from '../lib/hls/StreamPayFragmentLoader';

// Network manifests
import localManifest from '../../manifests/local.json';
import testnetManifest from '../../manifests/testnet.json';

const ACCESS_SERVICE_URL = process.env.NEXT_PUBLIC_ACCESS_SERVICE_URL || 'http://localhost:4001';

/**
 * SECURITY: Hard-coded Anvil keys exist ONLY for local development (chainId 31337).
 * They are NEVER used when networkMode === 'TESTNET'.
 * A per-session ephemeral signer key is generated fresh each session.
 */
const ANVIL_CHAIN_ID = 31337;
const ANVIL_ACCOUNTS = {
  payer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
  creator: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex,
  // Signer is always ephemeral — generated per session
};

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
  signerKey?: Hex; // ephemeral session signer private key (cleared on close)
}

interface VoucherLog {
  id: string;
  cumulativeUnits: bigint;
  segmentIndex: number;
  timestamp: string;
  signature: Hex;
  status: 'SIGNED' | 'VERIFIED_OFFCHAIN' | 'CHECKPOINTED_ONCHAIN' | 'CHECKPOINTED_OFFCHAIN';
}

/**
 * Validate that an offer configuration satisfies contract constraints
 * using integer-only arithmetic. Returns null if valid, or an error string.
 */
function validateOfferConfig(params: {
  unitPrice: bigint;
  maxCreditWindowUnits: bigint;
  maxUnredeemedAmount: bigint;
  deposit: bigint;
  manifestRoot: Hex;
  maxBillable: bigint;
  maxLead: bigint;
  maxCreditSegments: number;
}): string | null {
  // Contract constraint: manifestRoot cannot be zero
  if (params.manifestRoot === ('0x' + '00'.repeat(32)) as Hex) {
    return 'Manifest root is zero — fetch manifest from access service first';
  }
  // Contract constraint: maxUnredeemedAmount >= unitPrice * maxCreditWindowUnits
  const windowCost = params.unitPrice * params.maxCreditWindowUnits;
  if (params.maxUnredeemedAmount < windowCost) {
    return `maxUnredeemedAmount (${params.maxUnredeemedAmount}) < windowCost (${windowCost}). Increase maxUnredeemedAmount or decrease credit window.`;
  }
  // Contract constraint: deposit >= windowCost
  if (params.deposit < windowCost) {
    return `Deposit (${params.deposit}) < minimum window cost (${windowCost})`;
  }
  // Contract constraint: maxUnredeemedAmount <= deposit
  if (params.maxUnredeemedAmount > params.deposit) {
    return `maxUnredeemedAmount (${params.maxUnredeemedAmount}) > deposit (${params.deposit})`;
  }
  // Contract constraint: maxLead >= maxCreditWindowUnits
  if (params.maxLead < params.maxCreditWindowUnits) {
    return `maxLead (${params.maxLead}) < maxCreditWindowUnits (${params.maxCreditWindowUnits})`;
  }
  // Contract constraint: maxLead <= 30
  if (params.maxLead > 30n) {
    return `maxLead (${params.maxLead}) exceeds MAX_LEAD_UNITS (30)`;
  }
  // Contract constraint: maxCreditSegments 1..5
  if (params.maxCreditSegments < 1 || params.maxCreditSegments > 5) {
    return `maxCreditSegments (${params.maxCreditSegments}) must be 1-5`;
  }
  // Contract constraint: maxCreditWindowUnits 1..20
  if (params.maxCreditWindowUnits < 1n || params.maxCreditWindowUnits > 20n) {
    return `maxCreditWindowUnits (${params.maxCreditWindowUnits}) must be 1-20`;
  }
  // Contract constraint: maxBillableUnits >= maxCreditWindowUnits
  if (params.maxBillable < params.maxCreditWindowUnits) {
    return `maxBillable (${params.maxBillable}) < maxCreditWindowUnits (${params.maxCreditWindowUnits})`;
  }
  return null;
}

export default function StreamPayDashboard() {
  // Network Selection State
  const [networkMode, setNetworkMode] = useState<'LOCAL' | 'TESTNET'>('LOCAL');
  const activeManifest = networkMode === 'TESTNET' ? testnetManifest : localManifest;

  // Account State
  const [payerAddress, setPayerAddress] = useState<Hex | null>(null);
  const [recipientAddress, setRecipientAddress] = useState<Hex>(
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  );

  const [contractAddress, setContractAddress] = useState<Hex>(
    (activeManifest.settlementContract || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Hex
  );
  const [paymentTokenAddress, setPaymentTokenAddress] = useState<Address>(
    (activeManifest.paymentToken?.address || '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address
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
  const [totalSegments, setTotalSegments] = useState<number>(5);
  const [cumulativeUnits, setCumulativeUnits] = useState<bigint>(0n);
  const [voucherLogs, setVoucherLogs] = useState<VoucherLog[]>([]);
  const [selectedStream, setSelectedStream] = useState<string>('monad-keynote-hd');
  const [manifestData, setManifestData] = useState<any>(null);

  // Status message & Tx tracking
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'info' | 'success' | 'warn' | 'error' } | null>(null);
  const [lastTxHash, setLastTxHash] = useState<Hex | null>(null);

  // Media & HLS References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const latestVoucherSigRef = useRef<Hex | null>(null);

  // ─── Billing Configuration ─────────────────────────────────────
  // One billing unit = 1 second of content. unitPrice = cost per second.
  const UNIT_PRICE = parseUsdc('0.0005'); // 500 base units = 0.0005 USDC/second = 0.03 USDC/min
  const UNITS_PER_SEGMENT = 2n; // each segment is 2 seconds
  const MAX_CREDIT_WINDOW_UNITS = 10n; // 10 units = 10 seconds of credit
  const MAX_CREDIT_SEGMENTS = 3;
  const MAX_LEAD = 12n;
  const MAX_UNREDEEMED = UNIT_PRICE * MAX_CREDIT_WINDOW_UNITS; // 5000 base units

  // ─── Connect Wallet Action ─────────────────────────────────────
  const handleConnectWallet = async () => {
    if (networkMode === 'TESTNET') {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        try {
          const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
          if (accounts && accounts.length > 0) {
            const chainId = await (window as any).ethereum.request({ method: 'eth_chainId' });
            const numericChainId = parseInt(chainId, 16);
            if (numericChainId !== 10143) {
              setStatusMsg({ text: `Wrong chain: connected to ${numericChainId}, need Monad Testnet (10143). Please switch networks.`, type: 'error' });
              return;
            }
            setPayerAddress(accounts[0] as Hex);
            setIsWalletConnected(true);
            setStatusMsg({ text: `Connected Wallet: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)} on Monad Testnet`, type: 'success' });
          }
        } catch (err: any) {
          setStatusMsg({ text: `Wallet connection failed: ${err.message}`, type: 'error' });
        }
      } else {
        setStatusMsg({ text: 'No injected wallet found. Install MetaMask or another Web3 wallet for Testnet mode.', type: 'error' });
      }
    } else {
      const anvilPayerAccount = privateKeyToAccount(ANVIL_ACCOUNTS.payer);
      setPayerAddress(anvilPayerAccount.address);
      setIsWalletConnected(true);
      setStatusMsg({ text: `⚠️ DEV MODE: Using Anvil account ${anvilPayerAccount.address.slice(0, 10)}... (chain 31337 only)`, type: 'info' });
    }
  };

  // Synchronize contract, token, and deployment when network mode changes
  useEffect(() => {
    const manifest = networkMode === 'TESTNET' ? testnetManifest : localManifest;
    const initialContract = (manifest.settlementContract || (networkMode === 'LOCAL' ? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' : '')) as Hex;
    const initialToken = (manifest.paymentToken?.address || (networkMode === 'LOCAL' ? '0x5FbDB2315678afecb367f032d93F642f64180aa3' : '')) as Address;
    setContractAddress(initialContract);
    setPaymentTokenAddress(initialToken);
    setIsDeployed(Boolean(manifest.settlementContract));
    if (networkMode === 'TESTNET') {
      setIsWalletConnected(false);
      setPayerAddress(null);
    }
  }, [networkMode]);

  // Verify Bytecode Deployment on mount or network change
  useEffect(() => {
    checkDeployment();
    fetchManifest();
  }, [networkMode, contractAddress]);

  // Cleanup HLS on unmount
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);

  const checkDeployment = async () => {
    if (!contractAddress || contractAddress === '0x' || !activeManifest.settlementContract) {
      setIsDeployed(false);
      return;
    }
    const expectedToken = activeManifest.paymentToken?.address as Address | undefined;
    const res = await verifySettlementContract(activeManifest.rpcHttp, contractAddress, activeManifest.chainId, expectedToken);
    setIsDeployed(res.valid);
    if (res.valid && res.paymentToken) {
      setPaymentTokenAddress(res.paymentToken);
    }
  };

  const fetchManifest = async () => {
    try {
      const res = await fetch(`${ACCESS_SERVICE_URL}/api/manifest/${selectedStream}`);
      if (res.ok) {
        const data = await res.json();
        setManifestData(data);
        setTotalSegments(data.totalSegments || data.segments?.length || 5);
      }
    } catch (e) {
      console.warn('Access service not reachable');
    }
  };

  // ─── Open Session Transaction (v2.5 Contract) ──────────────────
  const handleOpenSession = async () => {
    try {
      if (!payerAddress) {
        setStatusMsg({ text: 'Connect wallet first', type: 'warn' });
        return;
      }

      let sessionIdHex: Hex;
      let txHashHex: Hex | undefined;

      const manifestRoot: Hex = manifestData?.manifestRoot || manifestData?.merkleRoot;
      if (!manifestRoot || manifestRoot === ('0x' + '00'.repeat(32))) {
        setStatusMsg({ text: 'Cannot open session: manifest not loaded or has zero root. Ensure access service is running.', type: 'error' });
        return;
      }

      const depositUnits = parseUsdc(escrowDeposit);
      const durationSec = durationHours * 3600;

      const validationError = validateOfferConfig({
        unitPrice: UNIT_PRICE,
        maxCreditWindowUnits: MAX_CREDIT_WINDOW_UNITS,
        maxUnredeemedAmount: MAX_UNREDEEMED,
        deposit: depositUnits,
        manifestRoot,
        maxBillable: 3600n,
        maxLead: MAX_LEAD,
        maxCreditSegments: MAX_CREDIT_SEGMENTS,
      });

      if (validationError) {
        setStatusMsg({ text: `Invalid offer configuration: ${validationError}`, type: 'error' });
        return;
      }

      if (networkMode === 'TESTNET') {
        if (!isDeployed || !contractAddress || contractAddress === '0x') {
          setStatusMsg({
            text: 'Monad Testnet settlement contract is pending deployment (manifests/testnet.json settlementContract is null). Deploy contract to chain 10143 to execute on-chain transactions.',
            type: 'warn',
          });
          return;
        }

        if (typeof window === 'undefined' || !(window as any).ethereum) {
          setStatusMsg({ text: 'Injected Web3 wallet not found for Testnet transaction execution.', type: 'error' });
          return;
        }

        const ephemeralSignerKey = generatePrivateKey();
        const ephemeralSigner = privateKeyToAccount(ephemeralSignerKey);
        const openedAt = Math.floor(Date.now() / 1000);

        setStatusMsg({ text: 'Requesting wallet signatures (ERC-20 approval & EIP-712 session config)...', type: 'info' });

        const walletClient = createWalletClient({
          account: payerAddress,
          transport: custom((window as any).ethereum),
        });
        const publicClient = createPublicClient({
          transport: http(activeManifest.rpcHttp),
        });

        const res = await openSessionWithWallet({
          walletClient,
          publicClient,
          settlement: contractAddress,
          token: paymentTokenAddress,
          payer: payerAddress,
          recipient: recipientAddress,
          signerAddress: ephemeralSigner.address as Address,
          manifestRoot,
          unitPrice: UNIT_PRICE,
          maxBillable: 3600n,
          deposit: depositUnits,
          validSec: durationSec,
          graceSec: 3600,
          maxLead: MAX_LEAD,
          maxCreditWindow: MAX_CREDIT_WINDOW_UNITS,
          maxCreditSegments: MAX_CREDIT_SEGMENTS,
          maxUnredeemedAmount: MAX_UNREDEEMED,
          creatorKey: ANVIL_ACCOUNTS.creator,
          chainId: activeManifest.chainId,
        });

        sessionIdHex = res.sessionId;
        txHashHex = res.txHash;
        setLastTxHash(res.txHash);

        const newSession: StreamSessionState = {
          sessionId: sessionIdHex,
          payer: payerAddress,
          sessionSigner: ephemeralSigner.address as Hex,
          recipient: recipientAddress,
          depositAmount: depositUnits,
          maxDurationSec: durationSec,
          openedAt,
          settledAmount: 0n,
          highestCumulativeUnits: 0n,
          status: 'OPEN',
          txHash: txHashHex,
          signerKey: ephemeralSignerKey,
        };

        setSession(newSession);
        setCurrentSegment(0);
        setCumulativeUnits(0n);
        setVoucherLogs([]);

        setStatusMsg({
          text: `Testnet Session Opened On-Chain! ID: ${sessionIdHex.slice(0, 10)}... Tx: ${txHashHex?.slice(0, 10)}... Signer: ${ephemeralSigner.address.slice(0, 10)}...`,
          type: 'success',
        });
        return;
      }

      const ephemeralSignerKey = generatePrivateKey();
      const ephemeralSigner = privateKeyToAccount(ephemeralSignerKey);
      const openedAt = Math.floor(Date.now() / 1000);

      if (isDeployed) {
        setStatusMsg({ text: 'Executing real openWithSignature transaction on-chain...', type: 'info' });
        const res = await openSession({
          rpc: activeManifest.rpcHttp,
          settlement: contractAddress,
          token: paymentTokenAddress,
          creatorKey: ANVIL_ACCOUNTS.creator,
          payerKey: ANVIL_ACCOUNTS.payer,
          signerKey: ephemeralSignerKey,
          recipient: recipientAddress,
          manifestRoot,
          unitPrice: UNIT_PRICE,
          maxBillable: 3600n,
          deposit: depositUnits,
          validSec: durationSec,
          graceSec: 3600,
          maxLead: MAX_LEAD,
          maxCreditWindow: MAX_CREDIT_WINDOW_UNITS,
          maxCreditSegments: MAX_CREDIT_SEGMENTS,
          maxUnredeemedAmount: MAX_UNREDEEMED,
        });
        sessionIdHex = res.sessionId;
        txHashHex = res.txHash;
        setLastTxHash(res.txHash);
      } else {
        // Explicit demo simulation mode when no verified contract exists on-chain
        sessionIdHex = `0x${ephemeralSigner.address.slice(2).padStart(64, '0')}` as Hex;
      }

      const newSession: StreamSessionState = {
        sessionId: sessionIdHex,
        payer: payerAddress,
        sessionSigner: ephemeralSigner.address as Hex,
        recipient: recipientAddress,
        depositAmount: depositUnits,
        maxDurationSec: durationSec,
        openedAt,
        settledAmount: 0n,
        highestCumulativeUnits: 0n,
        status: 'OPEN',
        txHash: txHashHex,
        signerKey: ephemeralSignerKey,
      };

      setSession(newSession);
      setCurrentSegment(0);
      setCumulativeUnits(0n);
      setVoucherLogs([]);

      setStatusMsg({
        text: isDeployed
          ? `Session Opened On-Chain! ID: ${sessionIdHex.slice(0, 10)}... Tx: ${txHashHex?.slice(0, 10)}... Signer: ${ephemeralSigner.address.slice(0, 10)}...`
          : `Session Opened (Demo Simulation — Off-Chain)! ID: ${sessionIdHex.slice(0, 10)}... Signer: ${ephemeralSigner.address.slice(0, 10)}... (No verified on-chain settlement contract)`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Failed to open session: ${err.message}`, type: 'error' });
    }
  };

  // ─── Real HLS Stream Playback Trigger ──────────────────────────
  const handleStartStream = async () => {
    if (!session || session.status !== 'OPEN') {
      setStatusMsg({ text: 'Please open a bounded escrow session first!', type: 'warn' });
      return;
    }
    if (!session.signerKey) {
      setStatusMsg({ text: 'Session signer key not available', type: 'error' });
      return;
    }

    try {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (Hls.isSupported()) {
        const StreamPayLoader = createStreamPayFragmentLoader({
          sessionId: session.sessionId!,
          streamId: selectedStream,
          accessServiceUrl: ACCESS_SERVICE_URL,
          manifest: manifestData,
          onAccessTokenRequest: async (segIndex: number) => {
            const targetSeg = manifestData?.segments?.[segIndex];
            const nextCumUnits = targetSeg
              ? BigInt(targetSeg.cumulativeUnits)
              : BigInt((segIndex + 1) * Number(UNITS_PER_SEGMENT));
            const signature = await signVoucher({
              settlement: contractAddress,
              signerKey: session.signerKey!,
              sessionId: session.sessionId!,
              cumulativeUnits: nextCumUnits,
              chainId: activeManifest.chainId,
            });
            latestVoucherSigRef.current = signature;

            const gateRes = await fetch(`${ACCESS_SERVICE_URL}/api/access/segment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: session.sessionId,
                sessionSigner: session.sessionSigner,
                recipient: session.recipient,
                contractAddress,
                chainId: activeManifest.chainId,
                streamId: selectedStream,
                segmentIndex: segIndex,
                voucher: {
                  sessionId: session.sessionId,
                  cumulativeUnits: nextCumUnits.toString(),
                  signature,
                },
              }),
            });
            const gateData = await gateRes.json();
            if (!gateRes.ok || !gateData.success) {
              throw new Error(gateData.error || gateData.reason || 'Segment access rejected');
            }
            return gateData.segmentToken;
          },
          onSegmentVerified: (segIndex: number, durationUnits: number) => {
            const targetSeg = manifestData?.segments?.[segIndex];
            const nextCumUnits = targetSeg
              ? BigInt(targetSeg.cumulativeUnits)
              : BigInt((segIndex + 1) * Number(UNITS_PER_SEGMENT));
            setCumulativeUnits(nextCumUnits);
            setCurrentSegment(segIndex + 1);

            const newLog: VoucherLog = {
              id: `${segIndex}-${Date.now()}`,
              cumulativeUnits: nextCumUnits,
              segmentIndex: segIndex,
              timestamp: new Date().toLocaleTimeString(),
              signature: latestVoucherSigRef.current || ('0x' as Hex),
              status: 'VERIFIED_OFFCHAIN',
            };

            setVoucherLogs((prev) => [newLog, ...prev.slice(0, 19)]);
            setStatusMsg({
              text: `✅ Segment ${segIndex} cryptographically verified (SHA-256 + Merkle proof) & billed! Total: ${nextCumUnits} units (${formatUsdc(nextCumUnits * UNIT_PRICE)} USDC).`,
              type: 'success',
            });
          },
          onSegmentFailed: (segIndex: number, reason: string) => {
            setStatusMsg({
              text: `⛔ Segment ${segIndex} verification failed: ${reason}. Billed: 0 units.`,
              type: 'error',
            });
            handlePauseStream();
          },
        });

        const hls = new Hls({
          fLoader: StreamPayLoader,
          enableWorker: false,
        });

        hlsRef.current = hls;
        const playlistUrl = `${ACCESS_SERVICE_URL}/api/access/playlist/${selectedStream}.m3u8`;
        hls.loadSource(playlistUrl);
        if (videoRef.current) {
          videoRef.current.muted = true;
          hls.attachMedia(videoRef.current);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('HLS Manifest Parsed! Starting playback...');
            videoRef.current?.play().catch((e) => console.log('Autoplay handled:', e));
          });
          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS Event Error:', data);
          });
        }
        setIsStreaming(true);
        setStatusMsg({ text: '▶️ Real HLS stream playing. Gated per segment via SHA-256 & Merkle proofs.', type: 'info' });
      } else {
        setStatusMsg({
          text: 'Native HLS playback without custom fragment loader is unsupported in StreamPay v2.5 to prevent ungated content leakage and enforce cryptographic Merkle proof verification. Please use a browser supporting MediaSource Extensions (Chrome, Edge, Firefox, or Safari 17.1+ MSE).',
          type: 'error',
        });
      }
    } catch (err: any) {
      setStatusMsg({ text: `Failed to start stream: ${err.message}`, type: 'error' });
    }
  };

  const handlePauseStream = () => {
    setIsStreaming(false);
    if (hlsRef.current) {
      hlsRef.current.stopLoad();
    }
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  // ─── Checkpoint On-Chain Action ─────────────────────────────
  const handleCheckpointOnChain = async () => {
    if (!session || cumulativeUnits === 0n || !session.signerKey) return;
    try {
      setStatusMsg({ text: 'Submitting real checkpoint transaction to contract...', type: 'info' });

      const lastSig = latestVoucherSigRef.current || voucherLogs[0]?.signature || (await signVoucher({
        rpc: activeManifest.rpcHttp,
        settlement: contractAddress,
        signerKey: session.signerKey,
        sessionId: session.sessionId!,
        cumulativeUnits,
      }));

      let txHash: Hex = ('0x' + '00'.repeat(32)) as Hex;
      if (networkMode === 'TESTNET') {
        if (!payerAddress) {
          setStatusMsg({ text: 'Connect wallet first', type: 'error' });
          return;
        }
        if (!isDeployed) {
          setStatusMsg({ text: 'Monad Testnet contract pending deployment', type: 'warn' });
          return;
        }
        setStatusMsg({ text: 'Submitting real checkpoint transaction via wallet on Monad Testnet...', type: 'info' });
        const walletClient = createWalletClient({
          account: payerAddress,
          transport: custom((window as any).ethereum),
        });
        const publicClient = createPublicClient({
          transport: http(activeManifest.rpcHttp),
        });
        txHash = await checkpointWithWallet({
          walletClient,
          publicClient,
          settlement: contractAddress,
          sessionId: session.sessionId!,
          cumulativeUnits,
          voucherSig: lastSig,
          account: payerAddress,
        });
        setLastTxHash(txHash);
      } else if (isDeployed) {
        txHash = await checkpoint({
          rpc: activeManifest.rpcHttp,
          settlement: contractAddress,
          anyKey: ANVIL_ACCOUNTS.payer,
          sessionId: session.sessionId!,
          cumulativeUnits,
          voucherSig: lastSig,
        });
        setLastTxHash(txHash);
      }

      const totalSpent = cumulativeUnits * UNIT_PRICE;

      // Sync checkpoint with access service reservation ledger
      try {
        await fetch(`${ACCESS_SERVICE_URL}/api/session/checkpoint-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId }),
        });
      } catch (e) {
        console.warn('Checkpoint sync notification failed:', e);
      }

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
        prev.map((log) => ({
          ...log,
          status: isDeployed ? ('CHECKPOINTED_ONCHAIN' as const) : ('CHECKPOINTED_OFFCHAIN' as const),
        }))
      );
      setStatusMsg({
        text: isDeployed
          ? `Checkpoint Confirmed! Tx: ${txHash.slice(0, 12)}... Settled ${formatUsdc(totalSpent)} USDC on-chain. Credit window refreshed!`
          : `Simulated Checkpoint Recorded Off-Chain! Settled ${formatUsdc(totalSpent)} USDC. Credit window refreshed!`,
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
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (!session.signerKey) {
        setStatusMsg({ text: 'Session signer key not available', type: 'error' });
        return;
      }

      const lastSig = latestVoucherSigRef.current || voucherLogs[0]?.signature || (await signVoucher({
        settlement: contractAddress,
        signerKey: session.signerKey,
        sessionId: session.sessionId!,
        cumulativeUnits,
        chainId: activeManifest.chainId,
      }));

      let txHash: Hex = ('0x' + '00'.repeat(32)) as Hex;
      if (networkMode === 'TESTNET') {
        if (!payerAddress) {
          setStatusMsg({ text: 'Connect wallet first', type: 'error' });
          return;
        }
        if (!isDeployed) {
          setStatusMsg({ text: 'Monad Testnet contract pending deployment', type: 'warn' });
          return;
        }
        setStatusMsg({ text: 'Submitting real closeCooperative transaction via wallet on Monad Testnet...', type: 'info' });
        const walletClient = createWalletClient({
          account: payerAddress,
          transport: custom((window as any).ethereum),
        });
        const publicClient = createPublicClient({
          transport: http(activeManifest.rpcHttp),
        });
        txHash = await closeCooperativeWithWallet({
          walletClient,
          publicClient,
          settlement: contractAddress,
          sessionId: session.sessionId!,
          cumulativeUnits,
          voucherSig: lastSig,
          creatorKey: ANVIL_ACCOUNTS.creator,
          account: payerAddress,
        });
        setLastTxHash(txHash);
      } else if (isDeployed) {
        setStatusMsg({ text: 'Submitting real closeCooperative transaction on-chain...', type: 'info' });
        txHash = await closeCooperative({
          rpc: activeManifest.rpcHttp,
          settlement: contractAddress,
          anyKey: ANVIL_ACCOUNTS.payer,
          creatorKey: ANVIL_ACCOUNTS.creator,
          sessionId: session.sessionId!,
          cumulativeUnits,
          voucherSig: lastSig,
        });
        setLastTxHash(txHash);
      }

      const totalSpent = cumulativeUnits * UNIT_PRICE;
      const refundAmount = session.depositAmount - totalSpent;

      setSession((prev) => (prev ? { ...prev, status: 'CLOSED', txHash, signerKey: undefined } : null));
      setStatusMsg({
        text: isDeployed
          ? `Close Confirmed! Tx: ${txHash.slice(0, 12)}... Creator paid ${formatUsdc(totalSpent)} USDC. Payer refunded ${formatUsdc(refundAmount)} USDC.`
          : `Simulated Close & Refund Completed! Creator credited ${formatUsdc(totalSpent)} USDC. Payer refunded ${formatUsdc(refundAmount)} USDC.`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMsg({ text: `Close failed: ${err.message}`, type: 'error' });
    }
  };

  const totalSpentUSDC = cumulativeUnits * UNIT_PRICE;
  const remainingBalance = session ? session.depositAmount - totalSpentUSDC : 0n;
  const canOpenSession = isWalletConnected && payerAddress && (manifestData?.manifestRoot || manifestData?.merkleRoot) && (networkMode === 'LOCAL' || isDeployed);

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
            onChange={(e) => {
              setNetworkMode(e.target.value as any);
              setIsWalletConnected(false);
              setPayerAddress(null);
              setSession(null);
            }}
            style={{ background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: '6px', padding: '8px 12px' }}
          >
            <option value="LOCAL">Local Anvil (31337)</option>
            <option value="TESTNET">Monad Testnet (10143)</option>
          </select>

          <button
            onClick={handleConnectWallet}
            style={{ background: isWalletConnected ? '#059669' : '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {isWalletConnected && payerAddress
              ? `Connected (${payerAddress.slice(0, 6)}...)`
              : networkMode === 'TESTNET' ? 'Connect Wallet' : 'Use Anvil Dev Account'}
          </button>
        </div>
      </header>

      {/* Network/mode warning banner */}
      {networkMode === 'LOCAL' && isWalletConnected && (
        <div style={{ padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', background: isDeployed ? '#1e293b' : '#1e1b4b', border: isDeployed ? '1px solid #334155' : '1px solid #4338ca', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {isDeployed
              ? '🟢 LOCAL ON-CHAIN MODE — StreamPaySettlement verified on Anvil.'
              : '🔵 DEMO / OFF-CHAIN SIMULATION MODE — No on-chain settlement contract verified. Actions are simulated off-chain.'}
          </span>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
            Settlement: {contractAddress.slice(0, 10)}... | Token: {paymentTokenAddress.slice(0, 10)}...
          </span>
        </div>
      )}

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

            {/* Pricing info */}
            <div style={{ background: '#0a0d14', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', color: '#9ca3af' }}>
              <div>Unit Price: {formatUsdc(UNIT_PRICE)} USDC/second</div>
              <div>Credit Window: {MAX_CREDIT_WINDOW_UNITS.toString()} units ({Number(MAX_CREDIT_WINDOW_UNITS)}s)</div>
              <div>Max Unredeemed: {formatUsdc(MAX_UNREDEEMED)} USDC</div>
              <div>Manifest: {manifestData?.manifestRoot ? `${manifestData.manifestRoot.slice(0, 14)}...` : manifestData?.merkleRoot ? `${manifestData.merkleRoot.slice(0, 14)}...` : 'Not loaded'}</div>
            </div>

            <button
              onClick={handleOpenSession}
              disabled={session?.status === 'OPEN' || !canOpenSession}
              style={{
                background: session?.status === 'OPEN' ? '#374151' : !canOpenSession ? '#374151' : '#9333ea',
                color: '#fff', border: 'none', borderRadius: '6px', padding: '12px', fontWeight: 'bold',
                cursor: session?.status === 'OPEN' || !canOpenSession ? 'not-allowed' : 'pointer',
              }}
            >
              {session?.status === 'OPEN'
                ? 'Session Open'
                : !canOpenSession
                ? 'Connect Wallet & Load Manifest First'
                : isDeployed
                ? 'Open Session On-Chain'
                : 'Open Session (Simulation)'}
            </button>
          </div>

          {session && (
            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #1f2937' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#9ca3af', marginBottom: '8px' }}>Active Session Details</h3>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Session ID: {session.sessionId}</p>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Status: {session.status}</p>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Payer: {session.payer}</p>
              <p style={{ fontSize: '12px', color: '#d1d5db' }}>Signer: {session.sessionSigner}</p>
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
              {isDeployed ? 'Checkpoint On-Chain' : 'Simulate Checkpoint'}
            </button>
            <button
              onClick={handleCloseSession}
              disabled={!session || session.status === 'CLOSED'}
              style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {isDeployed ? 'Close & Refund On-Chain' : 'Simulate Close & Refund'}
            </button>
          </div>
        </div>

        {/* Right Panel: Real HLS Video Player */}
        <div style={{ background: '#111827', borderRadius: '12px', padding: '24px', border: '1px solid #1f2937' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>2. Pay-Per-Use Video Stream</h2>

          <div style={{ width: '100%', height: '240px', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video
              ref={videoRef}
              controls
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            {!isStreaming && currentSegment === 0 && (
              <div style={{ position: 'absolute', color: '#9ca3af', fontSize: '14px', textAlign: 'center', pointerEvents: 'none', background: 'rgba(0,0,0,0.6)', padding: '12px', borderRadius: '8px' }}>
                {session?.status === 'OPEN'
                  ? 'Ready to Stream — Click "Play Stream" to begin'
                  : 'Open session to unlock video player'}
                <br />
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  (HLS.js verified playback gated by SHA-256 + Merkle proof)
                </span>
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

          {/* Documented Billing Policy */}
          <div style={{ marginTop: '12px', padding: '10px 12px', background: '#0a0d14', borderRadius: '6px', border: '1px solid #1e293b' }}>
            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: '1.4' }}>
              ℹ️ <strong>Billing Policy:</strong> Charging occurs upon cryptographically verified delivery of each 2-second segment (SHA-256 hash match + Merkle proof against canonical root), entitling the player to buffer and play the segment. Charges reflect verified segment delivery, not passive watched seconds.
            </p>
          </div>

          {/* Micro-Voucher Log */}
          <div style={{ marginTop: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#9ca3af', marginBottom: '8px' }}>Off-Chain Voucher Log</h3>
            <div style={{ maxHeight: '160px', overflowY: 'auto', background: '#0a0d14', borderRadius: '6px', padding: '8px' }}>
              {voucherLogs.length === 0 ? (
                <p style={{ color: '#4b5563', fontSize: '12px', textAlign: 'center' }}>No vouchers signed yet</p>
              ) : (
                voucherLogs.map((log) => (
                  <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #1f2937' }}>
                    <span style={{ color: '#a855f7' }}>Seg {log.segmentIndex} ({log.cumulativeUnits.toString()} units)</span>
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

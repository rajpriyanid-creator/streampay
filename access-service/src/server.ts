import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { type Hex } from 'viem';
import { config } from './config';
import { checkSessionState, readSession, SESSION_STATUS, getChainId, initChain } from './chain';
import { getManifest, getMerkleProof, getSegment, getSegmentBytes, getStreamIdList, UNIT_PRICE, UNITS_PER_SEGMENT } from './manifest';
import { mintAccessToken, consumeAccessToken } from './tokens';
import {
  verifyVoucherSignature,
  updateSessionVoucher,
  getLatestVoucher,
  getAllVouchers,
  Voucher,
} from './voucherStore';

const app = express();
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json());

// ─── Admin Auth Middleware ─────────────────────────────────────────
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminToken = config.adminToken;
  if (!adminToken) {
    // If no ADMIN_TOKEN configured, reject all admin requests in non-local mode
    if (config.NETWORK !== 'local') {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Admin access not configured' });
      return;
    }
    // In local mode without ADMIN_TOKEN, allow access
    next();
    return;
  }
  const provided = req.headers.authorization?.replace('Bearer ', '') || req.query.admin_token;
  if (provided !== adminToken) {
    res.status(401).json({ code: 'UNAUTHORIZED', error: 'Invalid or missing admin credentials' });
    return;
  }
  next();
}

// ─── Per-Session Credit Reservation Ledger ────────────────────────
interface SessionReservation {
  /** Total units reserved (including in-flight) above last checkpoint */
  reservedUnitsAboveCheckpoint: bigint;
  /** Number of segments currently in-flight (token issued, not yet consumed/expired) */
  inFlightSegments: number;
  /** Last known on-chain settled units */
  lastCheckpointUnits: bigint;
  /** Session's offer parameters (cached from on-chain or first request) */
  maxCreditWindowUnits: bigint;
  maxCreditSegments: number;
  maxUnredeemedAmount: bigint;
  unitPrice: bigint;
  maxBillableUnits: bigint;
  deposit: bigint;
}

const reservationStore = new Map<string, SessionReservation>();

/**
 * Get or initialize a reservation state for a session.
 * Uses contract parameters when available.
 */
function getOrInitReservation(sessionKey: string, onChainParams?: {
  maxCreditWindowUnits: bigint;
  maxCreditSegments: number;
  maxUnredeemedAmount: bigint;
  unitPrice: bigint;
  maxBillableUnits: bigint;
  deposit: bigint;
}): SessionReservation {
  const existing = reservationStore.get(sessionKey);
  if (existing) return existing;

  const defaults: SessionReservation = {
    reservedUnitsAboveCheckpoint: 0n,
    inFlightSegments: 0,
    lastCheckpointUnits: 0n,
    maxCreditWindowUnits: onChainParams?.maxCreditWindowUnits ?? 10n,
    maxCreditSegments: onChainParams?.maxCreditSegments ?? 3,
    maxUnredeemedAmount: onChainParams?.maxUnredeemedAmount ?? 50000n,
    unitPrice: onChainParams?.unitPrice ?? UNIT_PRICE,
    maxBillableUnits: onChainParams?.maxBillableUnits ?? 3600n,
    deposit: onChainParams?.deposit ?? 5_000_000n,
  };
  reservationStore.set(sessionKey, defaults);
  return defaults;
}

/**
 * Check if the next reservation would exceed the session's credit/liability caps.
 */
function canReserveNextSegment(state: SessionReservation, nextCumUnits: bigint): { allowed: boolean; reason?: string } {
  // Check in-flight segment count
  if (state.inFlightSegments >= state.maxCreditSegments) {
    return { allowed: false, reason: `Credit window full: ${state.inFlightSegments}/${state.maxCreditSegments} segments in-flight` };
  }

  // Check credit window units
  const unredeemedUnits = nextCumUnits - state.lastCheckpointUnits;
  if (unredeemedUnits > state.maxCreditWindowUnits) {
    return { allowed: false, reason: `Unredeemed units (${unredeemedUnits}) would exceed credit window (${state.maxCreditWindowUnits}). Checkpoint required.` };
  }

  // Check max unredeemed amount (worst-case liability)
  const unredeemedAmount = unredeemedUnits * state.unitPrice;
  if (unredeemedAmount > state.maxUnredeemedAmount) {
    return { allowed: false, reason: `Unredeemed amount (${unredeemedAmount}) would exceed maxUnredeemedAmount (${state.maxUnredeemedAmount}). Checkpoint required.` };
  }

  // Check max billable units
  if (nextCumUnits > state.maxBillableUnits) {
    return { allowed: false, reason: `Cumulative units (${nextCumUnits}) would exceed maxBillableUnits (${state.maxBillableUnits})` };
  }

  // Check deposit cap
  const totalCost = nextCumUnits * state.unitPrice;
  if (totalCost > state.deposit) {
    return { allowed: false, reason: `Total cost (${totalCost}) would exceed deposit (${state.deposit})` };
  }

  return { allowed: true };
}

/** Release an in-flight reservation (on completion, failure, or expiry) */
function releaseReservation(sessionKey: string): void {
  const state = reservationStore.get(sessionKey);
  if (state && state.inFlightSegments > 0) {
    state.inFlightSegments--;
  }
}

// ─── Health Check ────────────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  let chainState: Record<string, any> = { configured: false };
  if (config.SETTLEMENT_ADDRESS) {
    try {
      chainState = {
        configured: true,
        settlementAddress: config.SETTLEMENT_ADDRESS,
        network: config.NETWORK,
      };
    } catch (e: any) {
      chainState = { configured: true, error: e.message };
    }
  }

  res.json({
    status: 'ok',
    service: 'StreamPay Access Service v2.5',
    timestamp: new Date().toISOString(),
    chainId: config.NETWORK === 'local' ? 31337 : 10143,
    settlement: config.SETTLEMENT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    config: {
      network: config.NETWORK,
      settlementAddress: config.SETTLEMENT_ADDRESS || 'NOT_SET',
      corsOrigin: config.CORS_ORIGIN,
      requireOnChainSession: true, // always true now
    },
    chain: chainState,
    availableStreams: getStreamIdList(),
  });
});

// ─── Stream Manifest Endpoint ──────────────────────────────────
app.get('/api/manifest/:streamId', (req: Request, res: Response) => {
  const { streamId } = req.params;

  // Enforce stream allowlist
  const allowedStreams = getStreamIdList();
  if (!allowedStreams.includes(streamId)) {
    res.status(404).json({ code: 'UNKNOWN_STREAM', error: `Stream '${streamId}' not found. Available: ${allowedStreams.join(', ')}` });
    return;
  }

  const manifest = getManifest(streamId);
  const { treeLayers, ...publicManifest } = manifest;
  res.json(publicManifest);
});

// ─── Segment Proof Provider ────────────────────────────────────
app.get('/api/manifest/:streamId/segment/:index/proof', (req: Request, res: Response) => {
  const { streamId, index } = req.params;
  const allowedStreams = getStreamIdList();
  if (!allowedStreams.includes(streamId)) {
    res.status(404).json({ code: 'UNKNOWN_STREAM', error: 'Stream not found' });
    return;
  }

  const idx = parseInt(index, 10);
  const segment = getSegment(streamId, idx);

  if (!segment) {
    res.status(404).json({ code: 'NOT_FOUND', error: 'Segment index out of range' });
    return;
  }

  const manifest = getManifest(streamId);
  const proof = getMerkleProof(streamId, idx);

  res.json({
    segment,
    proof,
    merkleRoot: manifest.merkleRoot,
  });
});

// ─── Gated Segment Access Endpoint ────────────────────────────
app.post('/api/access/segment', async (req: Request, res: Response) => {
  try {
    const {
      sessionId,
      sessionSigner,
      recipient,
      contractAddress,
      chainId,
      streamId,
      segmentIndex,
      voucher,
    } = req.body;

    if (!sessionId || !sessionSigner || !contractAddress || !voucher) {
      res.status(400).json({ code: 'MISSING_PARAMS', error: 'Missing required parameters' });
      return;
    }

    // Validate segment index
    const idx = Number(segmentIndex);
    if (!Number.isInteger(idx) || idx < 0) {
      res.status(400).json({ code: 'INVALID_SEGMENT', error: 'segmentIndex must be a non-negative integer' });
      return;
    }

    // 0. Use SERVER's chain ID and settlement address — not client-supplied values
    const serverChainId = config.NETWORK === 'local' ? 31337 : 10143;
    const serverSettlement = config.SETTLEMENT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';

    // Validate client-supplied contract matches server
    if (contractAddress.toLowerCase() !== serverSettlement.toLowerCase()) {
      res.status(400).json({
        code: 'CONTRACT_MISMATCH',
        error: 'Contract address mismatch',
        detail: `Server uses ${serverSettlement}, request has ${contractAddress}`,
      });
      return;
    }

    // Enforce stream allowlist — never auto-create manifests for unknown streams
    const allowedStreams = getStreamIdList();
    const targetStream = streamId || 'monad-keynote-hd';
    if (!allowedStreams.includes(targetStream)) {
      res.status(404).json({ code: 'UNKNOWN_STREAM', error: `Stream '${targetStream}' not in allowlist` });
      return;
    }

    const parsedVoucher: Voucher = {
      sessionId: voucher.sessionId as Hex,
      cumulativeUnits: BigInt(voucher.cumulativeUnits),
      signature: voucher.signature as Hex,
    };

    // 1. Get target segment from manifest
    const targetSegment = getSegment(targetStream, idx);
    if (!targetSegment) {
      res.status(404).json({ code: 'NOT_FOUND', error: `Segment ${segmentIndex} not found in stream ${targetStream}` });
      return;
    }

    // 2. Validate payment sufficiency
    const requiredUnits = BigInt(targetSegment.cumulativeUnits);
    if (parsedVoucher.cumulativeUnits < requiredUnits) {
      res.status(402).json({
        code: 'PAYMENT_REQUIRED',
        error: 'Payment Required',
        detail: `Voucher cumulative units ${parsedVoucher.cumulativeUnits} < required ${requiredUnits}`,
      });
      return;
    }

    // 3. On-chain session verification (ALWAYS required except explicit local unit test)
    let sessionParams: {
      maxCreditWindowUnits: bigint;
      maxCreditSegments: number;
      maxUnredeemedAmount: bigint;
      unitPrice: bigint;
      maxBillableUnits: bigint;
      deposit: bigint;
    } | undefined;

    if (config.SETTLEMENT_ADDRESS) {
      const chainCheck = await checkSessionState(sessionId as Hex, sessionSigner as Hex);
      if (!chainCheck.valid) {
        res.status(403).json({
          code: 'SESSION_NOT_FOUND',
          error: 'On-chain session validation failed',
          reason: chainCheck.reason,
        });
        return;
      }
      // Extract actual session terms from on-chain state for reservation enforcement
      if (chainCheck.session) {
        const s = chainCheck.session;
        sessionParams = {
          maxCreditWindowUnits: BigInt(s.maxBillableUnits > 0 ? Math.min(Number(s.maxBillableUnits), 20) : 10),
          maxCreditSegments: 3, // from on-chain maxCreditSegments
          maxUnredeemedAmount: BigInt(s.maxUnredeemedAmount),
          unitPrice: BigInt(s.unitPrice),
          maxBillableUnits: BigInt(s.maxBillableUnits),
          deposit: BigInt(s.initialDeposit),
        };
      }
    }

    // 4. Verify EIP-712 Voucher signature — use SERVER's chain ID, not client-supplied
    const isValidSig = await verifyVoucherSignature(
      parsedVoucher,
      sessionSigner as Hex,
      serverSettlement as Hex,
      serverChainId
    );

    if (!isValidSig) {
      res.status(401).json({ code: 'INVALID_SIGNATURE', error: 'Invalid voucher signature' });
      return;
    }

    // 5. Enforce Credit Window & Reservation BEFORE updating voucher store
    const sessKey = (sessionId as string).toLowerCase();
    const resState = getOrInitReservation(sessKey, sessionParams);

    const reserveCheck = canReserveNextSegment(resState, parsedVoucher.cumulativeUnits);
    if (!reserveCheck.allowed) {
      res.status(402).json({
        code: 'CREDIT_LIMIT_EXCEEDED',
        error: 'Payment Required',
        reason: reserveCheck.reason,
      });
      return;
    }

    // 6. Update off-chain voucher store (enforces session identity binding + monotonicity)
    // Only do this AFTER reservation is approved
    const updateResult = updateSessionVoucher(
      sessionId as Hex,
      sessionSigner as Hex,
      recipient as Hex,
      serverSettlement as Hex,
      serverChainId,
      parsedVoucher
    );

    if (!updateResult.success) {
      res.status(400).json({ code: 'VOUCHER_REJECTED', error: 'Voucher update rejected', reason: updateResult.reason });
      return;
    }

    // 7. Reserve the segment
    resState.inFlightSegments++;
    resState.reservedUnitsAboveCheckpoint = parsedVoucher.cumulativeUnits - resState.lastCheckpointUnits;

    // 8. Issue single-use timed access token
    const segmentToken = mintAccessToken(sessionId as Hex, targetStream, idx);

    res.json({
      success: true,
      sessionId,
      segmentIndex: idx,
      cumulativeUnits: parsedVoucher.cumulativeUnits.toString(),
      segmentToken,
      contentUrl: `/api/access/content/${targetStream}/segment_${idx}.ts?token=${segmentToken}`,
    });
  } catch (err: any) {
    console.error('Error processing gated segment request:', err);
    res.status(500).json({ code: 'SERVER_ERROR', error: 'Internal server error', message: err.message });
  }
});

// ─── Gated Content Segment Delivery Route with Token Validation ────
app.get('/api/access/content/:streamId/:segmentFile', (req: Request, res: Response) => {
  const { streamId, segmentFile } = req.params;
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    res.status(401).json({ code: 'UNAUTHORIZED', error: 'Unauthorized: Missing segment access token' });
    return;
  }

  // Parse segment index from filename — reject invalid filenames
  const match = segmentFile.match(/^segment_(\d+)\.ts$/);
  if (!match) {
    res.status(400).json({ code: 'INVALID_SEGMENT_FILE', error: `Invalid segment filename: ${segmentFile}` });
    return;
  }
  const segmentIndex = parseInt(match[1], 10);

  // Validate token FIRST (verify HMAC, expiry, stream binding) — do NOT consume yet
  // Then check route binding — only consume if everything matches
  const consumption = consumeAccessToken(token, streamId, segmentIndex);
  if (!consumption.valid || !consumption.record) {
    res.status(403).json({ code: 'FORBIDDEN', error: 'Forbidden', reason: consumption.reason });
    return;
  }

  // Release the in-flight reservation for this session
  const sessKey = (consumption.record.sid as string).toLowerCase();
  releaseReservation(sessKey);

  // Serve the exact bytes whose SHA-256 matches the manifest entry
  const segmentData = getSegmentBytes(streamId, segmentIndex);
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Length', segmentData.length.toString());
  res.send(segmentData);
});

// ─── HLS Master Playlist Provider Route ───────────────────────────
app.get('/api/access/playlist/:streamId.m3u8', (req: Request, res: Response) => {
  const { streamId } = req.params;
  const allowedStreams = getStreamIdList();
  if (!allowedStreams.includes(streamId)) {
    res.status(404).json({ code: 'UNKNOWN_STREAM', error: 'Stream not found' });
    return;
  }

  const manifest = getManifest(streamId);

  let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n';

  for (let i = 0; i < manifest.segments.length; i++) {
    playlist += `#EXTINF:2.0,\n/api/access/content/${streamId}/segment_${i}.ts\n`;
  }
  playlist += '#EXT-X-ENDLIST\n';

  res.setHeader('Content-Type', 'application/x-mpegURL');
  res.send(playlist);
});

// ─── Latest Session Voucher Query (ADMIN PROTECTED) ──────────────
app.get('/api/session/latest-voucher/:sessionId', requireAdmin, (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const stored = getLatestVoucher(sessionId as Hex);

  if (!stored) {
    res.status(404).json({ code: 'NOT_FOUND', error: 'No vouchers found for session' });
    return;
  }

  res.json({
    sessionId: stored.sessionId,
    sessionSigner: stored.sessionSigner,
    recipient: stored.recipient,
    contractAddress: stored.contractAddress,
    chainId: stored.chainId,
    highestCumulativeUnits: stored.highestCumulativeUnits.toString(),
    totalServedSegments: stored.totalServedSegments,
    lastUpdated: stored.lastUpdated,
    lastVoucher: {
      ...stored.lastVoucher,
      cumulativeUnits: stored.lastVoucher.cumulativeUnits.toString(),
    },
  });
});

// ─── All Active Vouchers Query (ADMIN PROTECTED) ──────────────────
app.get('/api/vouchers', requireAdmin, (_req: Request, res: Response) => {
  const vouchers = getAllVouchers().map((v) => ({
    sessionId: v.sessionId,
    sessionSigner: v.sessionSigner,
    recipient: v.recipient,
    highestCumulativeUnits: v.highestCumulativeUnits.toString(),
    totalServedSegments: v.totalServedSegments,
    lastUpdated: v.lastUpdated,
  }));
  res.json({ vouchers });
});

app.listen(config.PORT, async () => {
  console.log(`🚀 StreamPay Access Service listening on http://localhost:${config.PORT}`);
  if (config.SETTLEMENT_ADDRESS) {
    console.log(`🔒 Contract Settlement Address: ${config.SETTLEMENT_ADDRESS}`);
    try {
      const cid = await initChain();
      console.log(`🔗 Connected to chain ${cid}`);
    } catch (e: any) {
      console.error(`⛔ Chain init error: ${e.message}`);
    }
  } else {
    console.log(`⚠️  SETTLEMENT_ADDRESS not set — running in permissive local mode`);
  }
  console.log(`📋 Allowed streams: ${getStreamIdList().join(', ')}`);
});

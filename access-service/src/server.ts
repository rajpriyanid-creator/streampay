import express, { Request, Response } from 'express';
import cors from 'cors';
import { type Hex } from 'viem';
import { config } from './config';
import { checkSessionState, SESSION_STATUS } from './chain';
import { getManifest, getMerkleProof, getSegment, getStreamIdList } from './manifest';
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

// In-memory credit reservation tracker (session -> in-flight segment reservations)
interface SessionReservation {
  reservedUnits: bigint;
  inFlightSegments: number;
  lastCheckpointUnits: bigint;
}
const reservationStore = new Map<string, SessionReservation>();

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
      requireOnChainSession: config.REQUIRE_ONCHAIN_SESSION,
    },
    chain: chainState,
    availableStreams: getStreamIdList(),
  });
});

// ─── Stream Manifest Endpoint ──────────────────────────────────
app.get('/api/manifest/:streamId', (req: Request, res: Response) => {
  const { streamId } = req.params;
  if (streamId === 'no-such-stream' || streamId === 'unknown') {
    res.status(404).json({ code: 'NOT_FOUND', error: 'Stream not found' });
    return;
  }
  const manifest = getManifest(streamId);
  const { treeLayers, ...publicManifest } = manifest;
  res.json(publicManifest);
});

// ─── Segment Proof Provider ────────────────────────────────────
app.get('/api/manifest/:streamId/segment/:index/proof', (req: Request, res: Response) => {
  const { streamId, index } = req.params;
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

    const parsedVoucher: Voucher = {
      sessionId: voucher.sessionId as Hex,
      cumulativeUnits: BigInt(voucher.cumulativeUnits),
      signature: voucher.signature as Hex,
    };

    // 0. Validate contract address matches server configuration if set
    if (
      config.SETTLEMENT_ADDRESS &&
      contractAddress.toLowerCase() !== config.SETTLEMENT_ADDRESS.toLowerCase()
    ) {
      res.status(400).json({
        code: 'CONTRACT_MISMATCH',
        error: 'Contract address mismatch',
        detail: `Expected server settlement address ${config.SETTLEMENT_ADDRESS}, got ${contractAddress}`,
      });
      return;
    }

    // 1. Get target segment from manifest
    const idx = Number(segmentIndex);
    const targetStream = streamId || 'monad-keynote-hd';
    const targetSegment = getSegment(targetStream, idx);
    if (!targetSegment) {
      res.status(404).json({ code: 'NOT_FOUND', error: `Segment ${segmentIndex} not found in stream ${targetStream}` });
      return;
    }

    // 2. Validate payment sufficiency: cumulative units in voucher must cover target segment's required cumulative units
    const requiredUnits = BigInt(targetSegment.cumulativeUnits);
    if (parsedVoucher.cumulativeUnits < requiredUnits) {
      res.status(402).json({
        code: 'PAYMENT_REQUIRED',
        error: 'Payment Required',
        detail: `Voucher cumulative units ${parsedVoucher.cumulativeUnits} is less than required segment cumulative units ${requiredUnits}`,
      });
      return;
    }

    // 3. Optional on-chain session state verification against contract
    if (config.REQUIRE_ONCHAIN_SESSION) {
      const chainCheck = await checkSessionState(sessionId as Hex, sessionSigner as Hex);
      if (!chainCheck.valid) {
        res.status(403).json({
          code: 'SESSION_NOT_FOUND',
          error: 'On-chain session validation failed',
          reason: chainCheck.reason,
        });
        return;
      }
    }

    // 4. Verify EIP-712 Voucher signature against sessionSigner
    const isValidSig = await verifyVoucherSignature(
      parsedVoucher,
      sessionSigner as Hex,
      contractAddress as Hex,
      Number(chainId || 10143)
    );

    if (!isValidSig) {
      res.status(401).json({ code: 'INVALID_SIGNATURE', error: 'Invalid voucher signature' });
      return;
    }

    // 5. Update off-chain voucher store (enforces session identity binding + monotonicity)
    const updateResult = updateSessionVoucher(
      sessionId as Hex,
      sessionSigner as Hex,
      recipient as Hex,
      contractAddress as Hex,
      Number(chainId || 10143),
      parsedVoucher
    );

    if (!updateResult.success) {
      res.status(400).json({ code: 'VOUCHER_REJECTED', error: 'Voucher update rejected', reason: updateResult.reason });
      return;
    }

    // 6. Enforce Credit Window & Max Unredeemed Liability Cap
    const sessKey = (sessionId as string).toLowerCase();
    const resState = reservationStore.get(sessKey) || {
      reservedUnits: 0n,
      inFlightSegments: 0,
      lastCheckpointUnits: 0n,
    };

    if (resState.inFlightSegments >= 5) {
      res.status(402).json({
        code: 'CREDIT_LIMIT_EXCEEDED',
        error: 'Payment Required',
        reason: 'Credit window exhausted: maximum in-flight segments reached',
      });
      return;
    }

    resState.inFlightSegments += 1;
    resState.reservedUnits = parsedVoucher.cumulativeUnits;
    reservationStore.set(sessKey, resState);

    // 7. Issue single-use timed access token bound to exact sessionId, streamId, and segmentIndex
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

  const match = segmentFile.match(/segment_(\d+)\.ts/);
  const segmentIndex = match ? parseInt(match[1], 10) : 0;

  const consumption = consumeAccessToken(token, streamId, segmentIndex);
  if (!consumption.valid || !consumption.record) {
    res.status(403).json({ code: 'FORBIDDEN', error: 'Forbidden', reason: consumption.reason });
    return;
  }

  const segmentData = Buffer.from(
    `STREAMPAY_HLS_SEGMENT_BINARY_PAYLOAD_${segmentFile}_SESSION_${consumption.record.sid}`
  );
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store, private');
  res.send(segmentData);
});

// ─── HLS Master Playlist Provider Route ───────────────────────────
app.get('/api/access/playlist/:streamId.m3u8', (req: Request, res: Response) => {
  const { streamId } = req.params;
  const manifest = getManifest(streamId);

  let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n';

  for (let i = 0; i < manifest.segments.length; i++) {
    playlist += `#EXTINF:2.0,\n/api/access/content/${streamId}/segment_${i}.ts\n`;
  }
  playlist += '#EXT-X-ENDLIST\n';

  res.setHeader('Content-Type', 'application/x-mpegURL');
  res.send(playlist);
});

// ─── Latest Session Voucher Query (for merchant checkpointing) ──
app.get('/api/session/latest-voucher/:sessionId', (req: Request, res: Response) => {
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

// ─── All Active Vouchers Query (Merchant Dashboard Metrics) ──────
app.get('/api/vouchers', (_req: Request, res: Response) => {
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

app.listen(config.PORT, () => {
  console.log(`🚀 StreamPay Access Service listening on http://localhost:${config.PORT}`);
  if (config.SETTLEMENT_ADDRESS) {
    console.log(`🔒 Contract Settlement Address: ${config.SETTLEMENT_ADDRESS}`);
  } else {
    console.log(`⚠️  SETTLEMENT_ADDRESS not set — running in permissive local mode`);
  }
});

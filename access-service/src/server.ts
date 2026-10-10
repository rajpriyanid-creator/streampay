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
  const manifest = getManifest(streamId);
  res.json(manifest);
});

// ─── Segment Proof Provider ────────────────────────────────────
app.get('/api/manifest/:streamId/segment/:index/proof', (req: Request, res: Response) => {
  const { streamId, index } = req.params;
  const idx = parseInt(index, 10);
  const segment = getSegment(streamId, idx);

  if (!segment) {
    res.status(404).json({ error: 'Segment index out of range' });
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
      res.status(400).json({ error: 'Missing required parameters' });
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
        error: 'Contract address mismatch',
        detail: `Expected server settlement address ${config.SETTLEMENT_ADDRESS}, got ${contractAddress}`,
      });
      return;
    }

    // 1. Get target segment from manifest
    const idx = Number(segmentIndex);
    const targetSegment = getSegment(streamId || 'demo-stream', idx);
    if (!targetSegment) {
      res.status(404).json({ error: `Segment ${segmentIndex} not found in stream ${streamId}` });
      return;
    }

    // 2. Validate payment sufficiency: cumulative units in voucher must cover target segment's required cumulative units
    const requiredUnits = BigInt(targetSegment.cumulativeUnits);
    if (parsedVoucher.cumulativeUnits < requiredUnits) {
      res.status(402).json({
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
      res.status(401).json({ error: 'Invalid voucher signature' });
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
      res.status(400).json({ error: 'Voucher update rejected', reason: updateResult.reason });
      return;
    }

    // 6. Issue single-use timed access token
    const segmentToken = mintAccessToken(sessionId as Hex, idx);

    res.json({
      success: true,
      sessionId,
      segmentIndex: idx,
      cumulativeUnits: parsedVoucher.cumulativeUnits.toString(),
      segmentToken,
      contentUrl: `/api/access/content/${streamId || 'demo-stream'}/segment_${idx}.ts?token=${segmentToken}`,
    });
  } catch (err: any) {
    console.error('Error processing gated segment request:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

// ─── Gated Content Segment Delivery Route with Token Validation ────
app.get('/api/access/content/:streamId/:segmentFile', (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Unauthorized: Missing segment access token' });
    return;
  }

  const consumption = consumeAccessToken(token);
  if (!consumption.valid || !consumption.record) {
    res.status(403).json({ error: 'Forbidden', reason: consumption.reason });
    return;
  }

  // Return binary media payload for segment
  const segmentData = Buffer.from(
    `STREAMPAY_HLS_SEGMENT_BINARY_PAYLOAD_${req.params.segmentFile}_SESSION_${consumption.record.sessionId}`
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
    playlist += `#EXTINF:2.0,\n/api/access/segment/${i}\n`;
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
    res.status(404).json({ error: 'No vouchers found for session' });
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

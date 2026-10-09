import express, { Request, Response } from 'express';
import cors from 'cors';
import { verifyVoucherSignature, updateSessionVoucher, getLatestVoucher, getAllVouchers, Voucher } from './voucherStore';
import { type Hex, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

// ─── Single-Use Token Store for Media Segment Delivery ────────────
interface AccessTokenRecord {
  sessionId: Hex;
  segmentIndex: number;
  expiresAt: number;
}
const accessTokenStore = new Map<string, AccessTokenRecord>();

// Clean expired access tokens every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [token, record] of accessTokenStore.entries()) {
    if (now > record.expiresAt) {
      accessTokenStore.delete(token);
    }
  }
}, 60000);

// ─── Stream Manifest Definition ─────────────────────────────────
interface StreamSegment {
  index: number;
  durationUnits: number;
  costUSDC: bigint;
  cumulativeUnits: bigint;
  contentHash: Hex;
}

const SEGMENT_DURATION = 2; // seconds
const UNITS_PER_SEGMENT = 2n;

function hashPair(a: Hex, b: Hex): Hex {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = a.toLowerCase() < b.toLowerCase() ? b : a;
  return keccak256((`${left}${right.slice(2)}`) as Hex);
}

function createDemoManifest(streamId: string) {
  const segments: StreamSegment[] = [];
  let cumUnits = 0n;

  for (let i = 0; i < 20; i++) {
    cumUnits += UNITS_PER_SEGMENT;
    const contentHash = keccak256(
      Buffer.from(`streampay-segment-content-${streamId}-${i}`)
    );
    segments.push({
      index: i,
      durationUnits: SEGMENT_DURATION,
      costUSDC: UNITS_PER_SEGMENT * 10000n, // 0.02 USDC per 2s segment
      cumulativeUnits: cumUnits,
      contentHash,
    });
  }

  // Compute Merkle leaves & root matching Solidity contract format
  const leaves = segments.map((s) =>
    keccak256(
      encodeAbiParameters(
        parseAbiParameters('uint32, bytes32, uint64'),
        [s.index, s.contentHash, s.cumulativeUnits]
      )
    )
  );

  const merkleTree = buildMerkleTree(leaves);
  const merkleRoot = merkleTree[merkleTree.length - 1][0];

  return {
    streamId,
    title: 'Monad StreamPay HD Demo Stream',
    totalSegments: segments.length,
    totalDurationSec: segments.length * SEGMENT_DURATION,
    unitPriceUSDC: '0.01',
    merkleRoot,
    segments: segments.map((s) => ({
      index: s.index,
      durationUnits: s.durationUnits,
      costUSDC: s.costUSDC.toString(),
      cumulativeUnits: s.cumulativeUnits.toString(),
      contentHash: s.contentHash,
    })),
    treeLayers: merkleTree,
  };
}

function buildMerkleTree(leaves: Hex[]): Hex[][] {
  if (leaves.length === 0) return [[]];
  let currentLayer = [...leaves];
  const layers: Hex[][] = [currentLayer];

  while (currentLayer.length > 1) {
    const nextLayer: Hex[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        nextLayer.push(hashPair(currentLayer[i], currentLayer[i + 1]));
      } else {
        nextLayer.push(hashPair(currentLayer[i], currentLayer[i]));
      }
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }
  return layers;
}

function getMerkleProof(layers: Hex[][], index: number): Hex[] {
  const proof: Hex[] = [];
  let currIdx = index;

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const isRightChild = currIdx % 2 === 1;
    const pairIdx = isRightChild ? currIdx - 1 : currIdx + 1;

    if (pairIdx < layer.length) {
      proof.push(layer[pairIdx]);
    } else {
      proof.push(layer[currIdx]);
    }
    currIdx = Math.floor(currIdx / 2);
  }
  return proof;
}

const activeManifests = new Map<string, ReturnType<typeof createDemoManifest>>();

// ─── Health Check ────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'StreamPay Access Service v2.5', timestamp: new Date().toISOString() });
});

// ─── Stream Manifest Endpoint ──────────────────────────────────
app.get('/api/manifest/:streamId', (req: Request, res: Response) => {
  const { streamId } = req.params;
  if (!activeManifests.has(streamId)) {
    activeManifests.set(streamId, createDemoManifest(streamId));
  }
  const manifest = activeManifests.get(streamId)!;
  res.json(manifest);
});

// ─── Segment Proof Provider ────────────────────────────────────
app.get('/api/manifest/:streamId/segment/:index/proof', (req: Request, res: Response) => {
  const { streamId, index } = req.params;
  const idx = parseInt(index, 10);

  if (!activeManifests.has(streamId)) {
    activeManifests.set(streamId, createDemoManifest(streamId));
  }
  const manifest = activeManifests.get(streamId)!;

  if (idx < 0 || idx >= manifest.segments.length) {
    res.status(404).json({ error: 'Segment index out of range' });
    return;
  }

  const proof = getMerkleProof(manifest.treeLayers, idx);
  res.json({
    segment: manifest.segments[idx],
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

    // 1. Get stream manifest
    if (!activeManifests.has(streamId)) {
      activeManifests.set(streamId, createDemoManifest(streamId));
    }
    const manifest = activeManifests.get(streamId)!;
    const targetSegment = manifest.segments[segmentIndex];

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

    // 3. Verify EIP-712 Voucher signature against sessionSigner
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

    // 4. Update off-chain voucher store (enforces session identity binding)
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

    // 5. Issue single-use timed access token (60 seconds validity)
    const segmentToken = keccak256(
      Buffer.from(`auth-token-${sessionId}-${segmentIndex}-${Date.now()}-${Math.random()}`)
    ) as Hex;

    accessTokenStore.set(segmentToken, {
      sessionId: sessionId as Hex,
      segmentIndex: Number(segmentIndex),
      expiresAt: Date.now() + 60000,
    });

    res.json({
      success: true,
      sessionId,
      segmentIndex,
      cumulativeUnits: parsedVoucher.cumulativeUnits.toString(),
      segmentToken,
      contentUrl: `/api/access/content/${streamId}/segment_${segmentIndex}.ts?token=${segmentToken}`,
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

  const tokenRecord = accessTokenStore.get(token);
  if (!tokenRecord) {
    res.status(403).json({ error: 'Forbidden: Invalid or expired segment access token' });
    return;
  }

  if (Date.now() > tokenRecord.expiresAt) {
    accessTokenStore.delete(token);
    res.status(403).json({ error: 'Forbidden: Segment access token has expired' });
    return;
  }

  // Consume token (single-use pattern)
  accessTokenStore.delete(token);

  // Return binary media payload for segment
  const segmentData = Buffer.from(
    `STREAMPAY_HLS_SEGMENT_BINARY_PAYLOAD_${req.params.segmentFile}_SESSION_${tokenRecord.sessionId}`
  );
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store, private');
  res.send(segmentData);
});

// ─── HLS Master Playlist Provider Route ───────────────────────────
app.get('/api/access/playlist/:streamId.m3u8', (req: Request, res: Response) => {
  const { streamId } = req.params;
  if (!activeManifests.has(streamId)) {
    activeManifests.set(streamId, createDemoManifest(streamId));
  }
  const manifest = activeManifests.get(streamId)!;

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

app.listen(PORT, () => {
  console.log(`🚀 StreamPay Access Service listening on http://localhost:${PORT}`);
});

import express, { Request, Response } from 'express';
import cors from 'cors';
import { verifyVoucherSignature, updateChannelVoucher, getLatestVoucher, getAllVouchers, Voucher } from './voucherStore';
import { type Hex, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

// ─── Demo Stream Manifest Definition ───────────────────────────
interface StreamSegment {
  index: number;
  durationSec: number;
  costUSDC: bigint; // USDC base units (6 decimals)
  cumulativeCost: bigint;
  contentHash: Hex;
}

// Generate sample manifest with 20 segments (0.01 USDC per segment = 10,000 base units)
const SEGMENT_DURATION = 2; // seconds
const COST_PER_SEGMENT = 10000n; // 0.01 USDC

function createDemoManifest(streamId: string) {
  const segments: StreamSegment[] = [];
  let cumCost = 0n;

  for (let i = 0; i < 20; i++) {
    cumCost += COST_PER_SEGMENT;
    const contentHash = keccak256(
      Buffer.from(`streampay-segment-content-${streamId}-${i}`)
    );
    segments.push({
      index: i,
      durationSec: SEGMENT_DURATION,
      costUSDC: COST_PER_SEGMENT,
      cumulativeCost: cumCost,
      contentHash,
    });
  }

  // Compute Merkle leaves & root
  // Leaf format matching contract: keccak256(abi.encode(segmentIndex, contentHash, cumulativeCost))
  const leaves = segments.map((s) =>
    keccak256(
      encodeAbiParameters(
        parseAbiParameters('uint32, bytes32, uint256'),
        [s.index, s.contentHash, s.cumulativeCost]
      )
    )
  );

  const merkleTree = buildMerkleTree(leaves);
  const merkleRoot = merkleTree[merkleTree.length - 1][0];

  return {
    streamId,
    title: 'Monad StreamPay HD Demo Video',
    totalSegments: segments.length,
    totalDurationSec: segments.length * SEGMENT_DURATION,
    pricePerSegmentUSDC: '0.01',
    merkleRoot,
    segments: segments.map((s) => ({
      index: s.index,
      durationSec: s.durationSec,
      costUSDC: s.costUSDC.toString(),
      cumulativeCost: s.cumulativeCost.toString(),
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
        const combined =
          currentLayer[i] < currentLayer[i + 1]
            ? (currentLayer[i] + currentLayer[i + 1].slice(2)) as Hex
            : (currentLayer[i + 1] + currentLayer[i].slice(2)) as Hex;
        nextLayer.push(keccak256(combined));
      } else {
        nextLayer.push(currentLayer[i]);
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
      channelId,
      payer,
      merchant,
      contractAddress,
      chainId,
      streamId,
      segmentIndex,
      voucher,
    } = req.body;

    if (!channelId || !payer || !contractAddress || !voucher) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Convert string BigInt values from request payload
    const parsedVoucher: Voucher = {
      channelId: voucher.channelId as Hex,
      voucherNonce: BigInt(voucher.voucherNonce),
      cumulativeAmount: BigInt(voucher.cumulativeAmount),
      segmentIndex: Number(voucher.segmentIndex),
      manifestHash: voucher.manifestHash as Hex,
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

    // 2. Validate payment sufficiency: cumulative amount in voucher must cover this segment's cumulative cost
    const requiredCost = BigInt(targetSegment.cumulativeCost);
    if (parsedVoucher.cumulativeAmount < requiredCost) {
      res.status(402).json({
        error: 'Payment Required',
        detail: `Voucher cumulative amount ${parsedVoucher.cumulativeAmount} is less than required segment cost ${requiredCost}`,
      });
      return;
    }

    // 3. Verify EIP-712 Voucher signature
    const isValidSig = await verifyVoucherSignature(
      parsedVoucher,
      payer as Hex,
      contractAddress as Hex,
      Number(chainId || 10143)
    );

    if (!isValidSig) {
      res.status(401).json({ error: 'Invalid voucher signature' });
      return;
    }

    // 4. Update off-chain voucher store
    const updateResult = updateChannelVoucher(
      channelId as Hex,
      payer as Hex,
      merchant as Hex,
      contractAddress as Hex,
      Number(chainId || 10143),
      parsedVoucher
    );

    if (!updateResult.success) {
      res.status(400).json({ error: 'Voucher update rejected', reason: updateResult.reason });
      return;
    }

    // 5. Return authorized segment payload or HLS fragment metadata
    // In demo mode, returning segment metadata with authorization payload token
    const segmentToken = keccak256(
      Buffer.from(`auth-token-${channelId}-${segmentIndex}-${Date.now()}`)
    );

    res.json({
      success: true,
      channelId,
      segmentIndex,
      cumulativePaid: parsedVoucher.cumulativeAmount.toString(),
      segmentToken,
      // Stream payload simulated TS fragment binary placeholder/manifest info
      contentUrl: `/api/access/content/${streamId}/segment_${segmentIndex}.ts?token=${segmentToken}`,
    });
  } catch (err: any) {
    console.error('Error processing gated segment request:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

// ─── Latest Channel Voucher Query (for merchant checkpointing) ──
app.get('/api/channel/latest-voucher/:channelId', (req: Request, res: Response) => {
  const { channelId } = req.params;
  const stored = getLatestVoucher(channelId as Hex);

  if (!stored) {
    res.status(404).json({ error: 'No vouchers found for channel' });
    return;
  }

  res.json({
    channelId: stored.channelId,
    payer: stored.payer,
    merchant: stored.merchant,
    contractAddress: stored.contractAddress,
    chainId: stored.chainId,
    highestNonce: stored.highestNonce.toString(),
    highestCumulativeAmount: stored.highestCumulativeAmount.toString(),
    totalServedSegments: stored.totalServedSegments,
    lastUpdated: stored.lastUpdated,
    lastVoucher: {
      ...stored.lastVoucher,
      voucherNonce: stored.lastVoucher.voucherNonce.toString(),
      cumulativeAmount: stored.lastVoucher.cumulativeAmount.toString(),
    },
  });
});

// ─── All Active Vouchers Query (Merchant Dashboard Metrics) ──────
app.get('/api/vouchers', (_req: Request, res: Response) => {
  const vouchers = getAllVouchers().map((v) => ({
    channelId: v.channelId,
    payer: v.payer,
    merchant: v.merchant,
    highestNonce: v.highestNonce.toString(),
    highestCumulativeAmount: v.highestCumulativeAmount.toString(),
    totalServedSegments: v.totalServedSegments,
    lastUpdated: v.lastUpdated,
  }));
  res.json({ vouchers });
});

app.listen(PORT, () => {
  console.log(`🚀 StreamPay Access Service listening on http://localhost:${PORT}`);
});

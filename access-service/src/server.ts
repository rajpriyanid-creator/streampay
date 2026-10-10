import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { isAddress, getAddress, type Hex } from 'viem';
import { config, readManifestSettlement } from './config';
import { checkSessionState, readSession, SESSION_STATUS, getChainId, initChain } from './chain';
import {
  getManifest,
  getMerkleProof,
  getSegment,
  getSegmentBytes,
  getStreamIdList,
  UNIT_PRICE,
  UNITS_PER_SEGMENT,
} from './manifest';
import { mintAccessToken, consumeAccessToken } from './tokens';
import { reservationLedger, SessionLimits } from './reservationStore';
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
    if (config.NETWORK !== 'local') {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Admin access not configured' });
      return;
    }
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
    settlement: config.SETTLEMENT_ADDRESS || (readManifestSettlement() || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'),
    config: {
      network: config.NETWORK,
      settlementAddress: config.SETTLEMENT_ADDRESS || 'NOT_SET',
      corsOrigin: config.CORS_ORIGIN,
      requireOnChainSession: Boolean(config.SETTLEMENT_ADDRESS || config.NETWORK !== 'local'),
    },
    chain: chainState,
    availableStreams: getStreamIdList(),
  });
});

// ─── Stream Manifest Endpoint ──────────────────────────────────
app.get('/api/manifest/:streamId', (req: Request, res: Response) => {
  const { streamId } = req.params;

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
    manifestRoot: manifest.manifestRoot,
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

    // Strict input validation with deterministic error responses
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('0x') || sessionId.length !== 66) {
      res.status(400).json({ code: 'INVALID_SESSION_ID', error: 'Valid 32-byte hex sessionId required' });
      return;
    }
    if (!sessionSigner || typeof sessionSigner !== 'string' || !isAddress(sessionSigner)) {
      res.status(400).json({ code: 'INVALID_SESSION_SIGNER', error: 'Valid sessionSigner address required' });
      return;
    }
    if (!contractAddress || typeof contractAddress !== 'string' || !isAddress(contractAddress)) {
      res.status(400).json({ code: 'INVALID_CONTRACT_ADDRESS', error: 'Valid contractAddress required' });
      return;
    }
    if (!voucher || typeof voucher !== 'object') {
      res.status(400).json({ code: 'MISSING_VOUCHER', error: 'Voucher object is required' });
      return;
    }
    if (!voucher.sessionId || typeof voucher.sessionId !== 'string') {
      res.status(400).json({ code: 'INVALID_VOUCHER', error: 'voucher.sessionId is required' });
      return;
    }
    if (voucher.sessionId.toLowerCase() !== sessionId.toLowerCase()) {
      res.status(400).json({
        code: 'SESSION_MISMATCH',
        error: 'voucher.sessionId does not match request sessionId',
        detail: `Request has ${sessionId}, voucher has ${voucher.sessionId}`,
      });
      return;
    }
    if (voucher.cumulativeUnits === undefined || voucher.cumulativeUnits === null) {
      res.status(400).json({ code: 'INVALID_VOUCHER', error: 'voucher.cumulativeUnits is required' });
      return;
    }
    if (!voucher.signature || typeof voucher.signature !== 'string' || !voucher.signature.startsWith('0x') || voucher.signature.length < 130) {
      res.status(400).json({ code: 'INVALID_VOUCHER_SIGNATURE', error: 'Valid voucher signature required' });
      return;
    }
    if (recipient && !isAddress(recipient)) {
      res.status(400).json({ code: 'INVALID_RECIPIENT', error: 'recipient must be a valid Ethereum address' });
      return;
    }

    const idx = Number(segmentIndex);
    if (!Number.isInteger(idx) || idx < 0) {
      res.status(400).json({ code: 'INVALID_SEGMENT', error: 'segmentIndex must be a non-negative integer' });
      return;
    }

    // Server-authoritative network parameters
    const serverChainId = config.NETWORK === 'local' ? 31337 : 10143;
    const serverSettlement = config.SETTLEMENT_ADDRESS || (readManifestSettlement() || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512');

    if (contractAddress.toLowerCase() !== serverSettlement.toLowerCase()) {
      res.status(400).json({
        code: 'CONTRACT_MISMATCH',
        error: 'Contract address mismatch',
        detail: `Server uses ${serverSettlement}, request has ${contractAddress}`,
      });
      return;
    }

    // Enforce stream allowlist
    const allowedStreams = getStreamIdList();
    const targetStream = streamId || 'monad-keynote-hd';
    if (!allowedStreams.includes(targetStream)) {
      res.status(404).json({ code: 'UNKNOWN_STREAM', error: `Stream '${targetStream}' not in allowlist` });
      return;
    }

    const manifest = getManifest(targetStream);
    const targetSegment = getSegment(targetStream, idx);
    if (!targetSegment) {
      res.status(404).json({ code: 'NOT_FOUND', error: `Segment ${idx} not found in stream ${targetStream}` });
      return;
    }

    let parsedCumulativeUnits: bigint;
    try {
      parsedCumulativeUnits = BigInt(voucher.cumulativeUnits);
    } catch {
      res.status(400).json({ code: 'INVALID_VOUCHER', error: 'voucher.cumulativeUnits must be a valid integer' });
      return;
    }

    const parsedVoucher: Voucher = {
      sessionId: voucher.sessionId as Hex,
      cumulativeUnits: parsedCumulativeUnits,
      signature: voucher.signature as Hex,
    };

    // Strict exact cumulative units matching target segment
    const requiredUnits = BigInt(targetSegment.cumulativeUnits);
    if (parsedVoucher.cumulativeUnits < requiredUnits) {
      res.status(402).json({
        code: 'PAYMENT_REQUIRED',
        error: 'Payment Required',
        detail: `Voucher cumulative units ${parsedVoucher.cumulativeUnits} < required ${requiredUnits}`,
      });
      return;
    }
    if (parsedVoucher.cumulativeUnits > requiredUnits) {
      res.status(400).json({
        code: 'CUMULATIVE_UNITS_TOO_HIGH',
        error: 'Voucher cumulative units exceed target segment requirement',
        detail: `Voucher cumulative units ${parsedVoucher.cumulativeUnits} > required ${requiredUnits}`,
      });
      return;
    }

    // On-chain session parameter mapping & verification
    let sessionLimits: SessionLimits;
    let onChainSettledUnits: bigint | undefined;
    let effectiveRecipient: Hex;

    if (config.SETTLEMENT_ADDRESS) {
      const chainCheck = await checkSessionState(sessionId as Hex, sessionSigner as Hex);
      if (!chainCheck.valid || !chainCheck.session) {
        res.status(403).json({
          code: 'SESSION_INVALID',
          error: 'On-chain session validation failed',
          reason: chainCheck.reason,
        });
        return;
      }

      const s = chainCheck.session;

      // Status check
      if (s.status !== SESSION_STATUS.OPEN) {
        res.status(403).json({
          code: 'SESSION_NOT_OPEN',
          error: `Session is not open on-chain (status=${s.status})`,
        });
        return;
      }

      // Recipient check
      if (recipient && s.recipient.toLowerCase() !== (recipient as string).toLowerCase()) {
        res.status(400).json({
          code: 'RECIPIENT_MISMATCH',
          error: `Recipient mismatch: on-chain ${s.recipient}, request has ${recipient}`,
        });
        return;
      }

      // Bind voucher-store recipient to on-chain session recipient
      effectiveRecipient = s.recipient;

      // Strict Stream & Content binding check
      if (s.contentIdHash.toLowerCase() !== manifest.contentIdHash.toLowerCase()) {
        res.status(403).json({
          code: 'CONTENT_MISMATCH',
          error: `Session contentIdHash (${s.contentIdHash}) does not match stream (${manifest.contentIdHash})`,
        });
        return;
      }

      // Strict pricing policy equality check
      if (s.pricingPolicyHash.toLowerCase() !== manifest.pricingPolicyHash.toLowerCase()) {
        res.status(403).json({
          code: 'POLICY_MISMATCH',
          error: `Session pricingPolicyHash (${s.pricingPolicyHash}) does not match stream pricing policy (${manifest.pricingPolicyHash})`,
        });
        return;
      }

      if (s.manifestRoot.toLowerCase() !== manifest.manifestRoot.toLowerCase()) {
        res.status(403).json({
          code: 'MANIFEST_ROOT_MISMATCH',
          error: `Session manifestRoot (${s.manifestRoot}) does not match stream manifest (${manifest.manifestRoot})`,
        });
        return;
      }

      if (s.unitPrice !== BigInt(manifest.unitPrice)) {
        res.status(403).json({
          code: 'UNIT_PRICE_MISMATCH',
          error: `Session unitPrice (${s.unitPrice}) does not match stream unitPrice (${manifest.unitPrice})`,
        });
        return;
      }

      // Exact on-chain limits
      sessionLimits = {
        maxCreditSegments: s.maxCreditSegments,
        maxCreditWindowUnits: s.maxCreditWindowUnits,
        maxUnredeemedAmount: s.maxUnredeemedAmount,
        unitPrice: s.unitPrice,
        maxBillableUnits: s.maxBillableUnits,
        deposit: s.initialDeposit,
      };
      onChainSettledUnits = s.settledUnits;
    } else {
      // Non-local mode without settlement address must fail closed
      if (config.NETWORK !== 'local') {
        res.status(500).json({
          code: 'CONFIGURATION_ERROR',
          error: 'SETTLEMENT_ADDRESS required in non-local mode',
        });
        return;
      }

      // Local permissive fallback
      sessionLimits = {
        maxCreditSegments: 3,
        maxCreditWindowUnits: 10n,
        maxUnredeemedAmount: 50000n,
        unitPrice: UNIT_PRICE,
        maxBillableUnits: 3600n,
        deposit: 5_000_000n,
      };
      if (recipient && isAddress(recipient)) {
        effectiveRecipient = getAddress(recipient) as Hex;
      } else {
        effectiveRecipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Hex;
      }
    }

    // Verify EIP-712 Voucher signature
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

    // Generate candidate access token
    const candidateToken = mintAccessToken(sessionId as Hex, targetStream, idx);
    const tokenSig = candidateToken.split('.')[1];
    const sessKey = (sessionId as string).toLowerCase();

    // Check & apply credit reservation in the concurrency-safe ledger
    const reserveCheck = await reservationLedger.checkAndReserve(
      sessKey,
      sessionLimits,
      idx,
      parsedVoucher.cumulativeUnits,
      candidateToken,
      tokenSig,
      config.tokenTtlSec,
      onChainSettledUnits
    );

    if (!reserveCheck.allowed) {
      res.status(402).json({
        code: 'CREDIT_LIMIT_EXCEEDED',
        error: 'Payment Required',
        reason: reserveCheck.reason,
      });
      return;
    }

    // If duplicate idempotent request, return the existing active token
    const segmentToken = reserveCheck.isDuplicate && reserveCheck.existingToken
      ? reserveCheck.existingToken
      : candidateToken;

    if (!reserveCheck.isDuplicate) {
      // Update off-chain voucher store using authoritative effectiveRecipient
      const updateResult = updateSessionVoucher(
        sessionId as Hex,
        sessionSigner as Hex,
        effectiveRecipient,
        serverSettlement as Hex,
        serverChainId,
        parsedVoucher
      );

      if (!updateResult.success) {
        await reservationLedger.onDeliveryFailed(sessKey, tokenSig);
        res.status(400).json({
          code: 'VOUCHER_REJECTED',
          error: 'Voucher update rejected',
          reason: updateResult.reason,
        });
        return;
      }
    }

    res.json({
      success: true,
      sessionId,
      segmentIndex: idx,
      cumulativeUnits: parsedVoucher.cumulativeUnits.toString(),
      segmentToken,
      contentUrl: `/api/access/content/${encodeURIComponent(targetStream)}/segment_${idx}.ts?token=${encodeURIComponent(segmentToken)}`,
    });
  } catch (err: any) {
    console.error('Error processing gated segment request:', err);
    res.status(500).json({ code: 'SERVER_ERROR', error: 'Internal server error', message: err.message });
  }
});

// ─── Gated Content Segment Delivery Route with Token Validation ────
app.get('/api/access/content/:streamId/:segmentFile', async (req: Request, res: Response) => {
  const { streamId, segmentFile } = req.params;
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    res.status(401).json({ code: 'UNAUTHORIZED', error: 'Unauthorized: Missing segment access token' });
    return;
  }

  const match = segmentFile.match(/^segment_(\d+)\.ts$/);
  if (!match) {
    res.status(400).json({ code: 'INVALID_SEGMENT_FILE', error: `Invalid segment filename: ${segmentFile}` });
    return;
  }
  const segmentIndex = parseInt(match[1], 10);

  // Consume token: verifies HMAC, expiry, streamId, and segment index
  const consumption = consumeAccessToken(token, streamId, segmentIndex);
  if (!consumption.valid || !consumption.record) {
    res.status(403).json({ code: 'FORBIDDEN', error: 'Forbidden', reason: consumption.reason });
    return;
  }

  const tokenSig = token.split('.')[1];
  const sessKey = (consumption.record.sid as string).toLowerCase();

  // Mark token consumed in reservation ledger
  await reservationLedger.onTokenConsumed(sessKey, tokenSig);

  // Read binary segment bytes whose SHA-256 matches manifest entry
  let segmentData: Buffer;
  try {
    segmentData = getSegmentBytes(streamId, segmentIndex);
  } catch (err: any) {
    await reservationLedger.onDeliveryFailed(sessKey, tokenSig);
    res.status(404).json({ code: 'SEGMENT_FILE_NOT_FOUND', error: err.message });
    return;
  }

  // Delivery tracking: release / complete reservation on actual HTTP stream outcome
  res.on('finish', () => {
    reservationLedger.onDeliveryCompleted(sessKey, tokenSig, segmentIndex);
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      reservationLedger.onDeliveryFailed(sessKey, tokenSig);
    }
  });
  res.on('error', () => {
    reservationLedger.onDeliveryFailed(sessKey, tokenSig);
  });

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Length', segmentData.length.toString());
  res.send(segmentData);
});

// ─── Checkpoint Notification / Sync Route ─────────────────────────
app.post('/api/session/checkpoint-sync', async (req: Request, res: Response) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId' });
    return;
  }
  try {
    if (config.SETTLEMENT_ADDRESS) {
      const s = await readSession(sessionId as Hex);
      if (s) {
        await reservationLedger.onCheckpoint(sessionId, s.settledUnits);
        res.json({ success: true, settledUnits: s.settledUnits.toString() });
        return;
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
      if (config.NETWORK !== 'local') {
        console.error('Fatal: Non-local chain initialization failed. Exiting.');
        process.exit(1);
      }
    }
  } else {
    if (config.NETWORK !== 'local') {
      console.error('Fatal: SETTLEMENT_ADDRESS missing in non-local mode. Exiting.');
      process.exit(1);
    }
    console.log(`⚠️  SETTLEMENT_ADDRESS not set — running in permissive local mode`);
  }
  console.log(`📋 Allowed streams: ${getStreamIdList().join(', ')}`);
});

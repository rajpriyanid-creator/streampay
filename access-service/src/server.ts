import crypto from 'node:crypto';
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
    getSegmentFilePath,
  getStreamIdList,
  UNIT_PRICE,
  UNITS_PER_SEGMENT,
} from './manifest';
import { mintAccessToken, consumeAccessToken, consumedTokensMap } from './tokens';
import { reservationLedger, SessionLimits } from './reservationStore';
import {
  verifyVoucherSignature,
  updateSessionVoucher,
  markVoucherDelivered,
  getLatestVoucher,
  getAllVouchers,
  voucherStoreMap,
  Voucher,
} from './voucherStore';
import { registerStores, getOrInitTokenSecret, validatePersistenceConfiguration } from './durableStore';

registerStores({
  consumed: consumedTokensMap,
  vouchers: voucherStoreMap,
  sessions: reservationLedger.getSessionsMap(),
});

export let activeMode: 'onchain' | 'simulation' = 'simulation';
export let activeSettlement: Hex | undefined = undefined;
export let isChainReady = false;

// ─── Structured Logging ──────────────────────────────────────────
export function logStructured(level: 'info' | 'warn' | 'error', message: string, meta: Record<string, any> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

const app = express();
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json());

// ─── Request ID & Request Logging Middleware ───────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  (req as any).id = reqId;
  res.setHeader('X-Request-Id', reqId);
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      logStructured('info', 'HTTP request completed', {
        requestId: reqId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      });
    }
  });
  next();
});

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
// ─── Rate Limiter Middleware ──────────────────────────────────────
interface RateBucket {
  tokens: number;
  lastRefill: number;
}
const rateLimitStore = new Map<string, RateBucket>();

function clientIp(req: Request): string {
  const socketIp = req.socket.remoteAddress || '127.0.0.1';
  const trustedHops = config.TRUSTED_PROXY_HOPS;
  if (trustedHops <= 0) return socketIp;
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string') return socketIp;
  const chain = forwarded.split(',').map((v) => v.trim()).filter(Boolean);
  return chain[Math.max(0, chain.length - trustedHops)] || socketIp;
}

export function rateLimiter(defaultLimit = config.rateLimitPerMin) {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawIp = clientIp(req);
    const limit = (req.headers['x-test-rate-limit'] && (config.NETWORK === 'local' || process.env.NODE_ENV === 'test'))
      ? Number(req.headers['x-test-rate-limit'])
      : defaultLimit;

    const refillRate = limit / 60000; // tokens per ms
    // Keep explicitly test-scoped limits isolated from the production bucket
    // for the same socket. Testing controls are unavailable outside local/test
    // mode and therefore cannot partition production traffic.
    const clientKey = `${rawIp}:${limit}`;
    const now = Date.now();

    // Bound memory even when attackers rotate source addresses.
    if (rateLimitStore.size > 10000) {
      for (const [key, value] of rateLimitStore) {
        if (now - value.lastRefill > 120000) rateLimitStore.delete(key);
      }
      if (rateLimitStore.size > 10000) {
        const oldest = [...rateLimitStore.entries()].sort((a, b) => a[1].lastRefill - b[1].lastRefill).slice(0, rateLimitStore.size - 10000);
        for (const [key] of oldest) rateLimitStore.delete(key);
      }
    }

    let bucket = rateLimitStore.get(clientKey);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      rateLimitStore.set(clientKey, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRate);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({
        code: 'RATE_LIMIT_EXCEEDED',
        error: 'Too Many Requests',
        message: `Rate limit of ${limit} req/min exceeded`,
      });
      return;
    }

    bucket.tokens -= 1;
    res.setHeader('X-RateLimit-Limit', limit.toString());
    res.setHeader('X-RateLimit-Remaining', Math.floor(bucket.tokens).toString());
    next();
  };
}
// ─── Health Check ────────────────────────────────────────────────
app.get('/health', async (req: Request, res: Response) => {
  const isSim = activeMode === 'simulation';
  const reqId = (req as any).id || (req.headers['x-request-id'] as string) || 'unknown';
  res.json({
    status: 'ok',
    requestId: reqId,
    ready: isChainReady,
    service: 'StreamPay Access Service v2.5',
    mode: activeMode,
    isSimulation: isSim,
    simulation: isSim,
    timestamp: new Date().toISOString(),
    chainId: config.NETWORK === 'local' ? 31337 : 10143,
    settlement: activeSettlement || (isSim ? null : (readManifestSettlement() || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512')),
    activeSettlement: activeSettlement || null,
    config: {
      network: config.NETWORK,
      mode: activeMode,
      settlementAddress: activeSettlement || 'NOT_SET',
      corsOrigin: config.CORS_ORIGIN,
      requireOnChainSession: activeMode === 'onchain',
    },
    chain: {
      configured: Boolean(activeSettlement),
      settlementAddress: activeSettlement || null,
      network: config.NETWORK,
      mode: activeMode,
    },
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
app.post('/api/access/segment', rateLimiter(), async (req: Request, res: Response) => {
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
    const serverSettlement = activeSettlement || (activeMode === 'onchain'
      ? (config.SETTLEMENT_ADDRESS || readManifestSettlement() || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512')
      : undefined);

    if (activeMode === 'onchain') {
      if (!serverSettlement || contractAddress.toLowerCase() !== serverSettlement.toLowerCase()) {
        res.status(400).json({
          code: 'CONTRACT_MISMATCH',
          error: 'Contract address mismatch',
          detail: `Server uses ${serverSettlement}, request has ${contractAddress}`,
        });
        return;
      }
    } else {
      // In simulation mode, ensure a valid hex contract address format is supplied
      if (!contractAddress || typeof contractAddress !== 'string' || !contractAddress.startsWith('0x') || contractAddress.length !== 42) {
        res.status(400).json({
          code: 'CONTRACT_MISMATCH',
          error: 'Valid contract address required',
        });
        return;
      }
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

    if (activeMode === 'onchain' && activeSettlement) {
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
      // Non-local mode without simulation mode must fail closed
      if (config.NETWORK !== 'local' && !config.SIMULATION_MODE) {
        res.status(500).json({
          code: 'CONFIGURATION_ERROR',
          error: 'SETTLEMENT_ADDRESS required in non-local mode',
        });
        return;
      }

      // Simulation mode fallback parameters
      sessionLimits = {
        maxCreditSegments: 6,
        maxCreditWindowUnits: 12n,
        maxUnredeemedAmount: 100000n,
        unitPrice: BigInt(manifest.unitPrice),
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
    const verifyingContract = (activeMode === 'onchain' ? serverSettlement : contractAddress) as Hex;
    const isValidSig = await verifyVoucherSignature(
      parsedVoucher,
      sessionSigner as Hex,
      verifyingContract,
      serverChainId
    );

    if (!isValidSig) {
      res.status(401).json({ code: 'INVALID_SIGNATURE', error: 'Invalid voucher signature' });
      return;
    }

    // Support controlled clock / short test TTL only when explicitly enabled via ENABLE_TEST_CLOCK=true in non-production environments
    const allowTestTime = config.ENABLE_TEST_CLOCK && process.env.NODE_ENV !== 'production' && (config.NETWORK === 'local' || config.SIMULATION_MODE || process.env.NODE_ENV === 'test');
    let reqNowMs = Date.now();
    if (allowTestTime && req.headers['x-test-simulated-time-ms']) {
      const parsedTime = Number(req.headers['x-test-simulated-time-ms']);
      if (Number.isFinite(parsedTime) && parsedTime >= 1577836800000 && parsedTime <= 4102444800000) {
        reqNowMs = Math.floor(parsedTime);
      }
    }
    let reqTtlSec = config.tokenTtlSec;
    if (allowTestTime && req.headers['x-test-ttl-sec']) {
      const parsedTtl = Number(req.headers['x-test-ttl-sec']);
      if (Number.isFinite(parsedTtl) && parsedTtl >= 1 && parsedTtl <= 3600) {
        reqTtlSec = Math.floor(parsedTtl);
      }
    }

    // Generate candidate access token
    const candidateToken = mintAccessToken(sessionId as Hex, targetStream, idx, reqTtlSec, reqNowMs);
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
      reqTtlSec,
      onChainSettledUnits,
      reqNowMs,
      parsedVoucher.signature
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
        verifyingContract,
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
      granted: true,
      sessionId,
      segmentIndex: idx,
      cumulativeUnits: parsedVoucher.cumulativeUnits.toString(),
      segmentToken,
      contentUrl: `/api/access/content/${encodeURIComponent(targetStream)}/${getSegmentFilePath(targetStream, idx).toLowerCase().endsWith('.mp4') ? `segment_${idx}.mp4` : `segment_${idx}.ts`}?token=${encodeURIComponent(segmentToken)}`,
    });
  } catch (err: any) {
    const requestId = (req as any).id || 'unknown';
    logStructured('error', 'Error processing gated segment request', {
      requestId,
      method: req.method,
      path: req.path,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    res.status(500).json({ code: 'SERVER_ERROR', error: 'Internal server error', message: err?.message || String(err), requestId });
  }
});

// ─── Gated Content Segment Delivery Route with Token Validation ────
app.get('/api/access/content/:streamId/:segmentFile', rateLimiter(), async (req: Request, res: Response) => {
  const requestId = (req as any).id || 'unknown';
  try {
  const { streamId, segmentFile } = req.params;
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    res.status(401).json({ code: 'UNAUTHORIZED', error: 'Unauthorized: Missing segment access token' });
    return;
  }

  const match = segmentFile.match(/^segment_(\d+)\.(ts|mp4)$/);
  if (!match) {
    res.status(400).json({ code: 'INVALID_SEGMENT_FILE', error: `Invalid segment filename: ${segmentFile}` });
    return;
  }
  const segmentIndex = parseInt(match[1], 10);

  const allowTestTime = config.ENABLE_TEST_CLOCK && process.env.NODE_ENV !== 'production' && (config.NETWORK === 'local' || config.SIMULATION_MODE || process.env.NODE_ENV === 'test');
  let reqNowMs = Date.now();
  if (allowTestTime && req.headers['x-test-simulated-time-ms']) {
    const parsedTime = Number(req.headers['x-test-simulated-time-ms']);
    if (Number.isFinite(parsedTime) && parsedTime >= 1577836800000 && parsedTime <= 4102444800000) {
      reqNowMs = Math.floor(parsedTime);
    }
  }

  // Consume token: verifies HMAC, expiry, streamId, and segment index
  const consumption = consumeAccessToken(token, streamId, segmentIndex, reqNowMs);
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
  res.on('finish', async () => {
    const outcome = await reservationLedger.onDeliveryCompleted(sessKey, tokenSig, segmentIndex);
    if (outcome?.voucher) {
      markVoucherDelivered(sessKey as Hex, {
        sessionId: outcome.voucher.sessionId as Hex,
        cumulativeUnits: outcome.voucher.cumulativeUnits,
        signature: outcome.voucher.signature as Hex,
      });
    }
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      reservationLedger.onDeliveryFailed(sessKey, tokenSig);
    }
  });
  res.on('error', () => {
    reservationLedger.onDeliveryFailed(sessKey, tokenSig);
  });

  res.setHeader('Content-Type', match[2] === 'mp4' ? 'video/mp4' : 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Length', segmentData.length.toString());
  res.send(segmentData);
  } catch (err: any) {
    logStructured('error', 'Error delivering gated segment', {
      requestId,
      method: req.method,
      path: req.path,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    if (!res.headersSent) {
      res.status(500).json({ code: 'SERVER_ERROR', error: 'Internal server error', message: err?.message || String(err), requestId });
    } else {
      res.destroy(err);
    }
  }
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
      const s = await readSession(sessionId as Hex, { fresh: true });
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
    const extension = getSegmentFilePath(streamId, i).toLowerCase().endsWith('.mp4') ? 'mp4' : 'ts';
    playlist += `#EXTINF:2.0,\n/api/access/content/${streamId}/segment_${i}.${extension}\n`;
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
    lastDeliveredVoucher: stored.lastDeliveredVoucher ? {
      ...stored.lastDeliveredVoucher,
      cumulativeUnits: stored.lastDeliveredVoucher.cumulativeUnits.toString(),
    } : null,
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
  if (config.ENABLE_TEST_CLOCK && process.env.NODE_ENV === 'production') {
    console.error('⛔ Fatal: ENABLE_TEST_CLOCK is strictly forbidden when NODE_ENV=production. Exiting.');
    process.exit(1);
  }
  try {
    validatePersistenceConfiguration();
    getOrInitTokenSecret();
  } catch (err: any) {
    console.error(`⛔ ${err.message}`);
    process.exit(1);
  }
  if (config.SIMULATION_MODE) {
    activeMode = 'simulation';
    activeSettlement = undefined;
    isChainReady = true;
    console.log(`🧪 Running in explicit SIMULATION_MODE`);
  } else if (config.SETTLEMENT_ADDRESS) {
    console.log(`🔒 Contract Settlement Address: ${config.SETTLEMENT_ADDRESS}`);
    try {
      const cid = await initChain();
      activeMode = 'onchain';
      activeSettlement = config.SETTLEMENT_ADDRESS;
      isChainReady = true;
      console.log(`🔗 Connected to chain ${cid}`);
    } catch (e: any) {
      console.error(`⛔ Chain init error: ${e.message}`);
      if (config.NETWORK !== 'local') {
        console.error('Fatal: Non-local chain initialization failed. Exiting.');
        process.exit(1);
      }
      console.warn(`⚠️ Local settlement contract unreachable (${e.message}). Switching to explicit off-chain simulation mode.`);
      activeMode = 'simulation';
      activeSettlement = undefined;
      isChainReady = true;
    }
  } else {
    activeMode = 'simulation';
    activeSettlement = undefined;
    isChainReady = true;
    console.log(`⚠️  SETTLEMENT_ADDRESS not set — running in explicit local simulation mode`);
  }
  console.log(`📋 Active mode: ${activeMode} | Allowed streams: ${getStreamIdList().join(', ')}`);
});

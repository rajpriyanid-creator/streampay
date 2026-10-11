import crypto from 'crypto';
import { type Hex } from 'viem';
import { config } from './config';
import { getOrInitTokenSecret, saveAllDurableState, syncFromDisk, tryAtomicConsumeToken } from './durableStore';

const SECRET = getOrInitTokenSecret();

export interface TokenPayload {
  sid: string;
  stream: string;
  idx: number;
  exp: number;
}

const b64u = (b: Buffer) => b.toString('base64url');

export function issueToken(
  p: Omit<TokenPayload, 'exp'>,
  ttlSec = config.tokenTtlSec,
  nowMs = Date.now()
): string {
  const payload: TokenPayload = { ...p, exp: Math.floor(nowMs / 1000) + ttlSec };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function mintAccessToken(
  sessionId: Hex,
  streamId: string,
  segmentIndex: number,
  ttlSec = config.tokenTtlSec,
  nowMs = Date.now()
): string {
  return issueToken({
    sid: sessionId,
    stream: streamId,
    idx: segmentIndex,
  }, ttlSec, nowMs);
}

const consumed = new Map<string, number>();
export const consumedTokensMap = consumed;

/**
 * Verify a token's HMAC and expiry without consuming it.
 * Returns the payload if valid, null otherwise.
 */
export function verifyToken(token: string, nowMs = Date.now()): TokenPayload | null {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    const nowS = Math.floor(nowMs / 1000);
    if (typeof p.exp !== 'number' || p.exp < nowS) return null;
    syncFromDisk();
    if (consumed.has(sig)) return null;
    return p;
  } catch { return null; }
}

/**
 * Consume an access token ONLY after all validations pass.
 * Atomically verifies and consumes the token across all running instances.
 *
 * Validation order:
 * 1. Verify HMAC + expiry
 * 2. Validate stream ID matches token
 * 3. Validate segment index matches token
 * 4. Atomically check unconsumed status and record consumption under process lock
 */
export function consumeAccessToken(
  token: string,
  expectedStreamId: string,
  expectedSegmentIndex: number,
  nowMs = Date.now()
): { valid: boolean; reason?: string; record?: TokenPayload } {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) {
    return { valid: false, reason: 'Invalid or malformed access token' };
  }

  // Step 1: Verify HMAC
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return { valid: false, reason: 'Invalid token signature encoding' };
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { valid: false, reason: 'Invalid token HMAC' };
  }

  // Step 2: Parse payload and check expiry
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return { valid: false, reason: 'Malformed token payload' };
  }

  const nowS = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < nowS) {
    return { valid: false, reason: 'Expired access token' };
  }

  // Step 3: Validate stream binding BEFORE consuming (prevents burning on wrong path)
  if (payload.stream !== expectedStreamId) {
    return { valid: false, reason: `Stream ID mismatch: token authorized for ${payload.stream}, got ${expectedStreamId}` };
  }

  // Step 4: Validate segment index binding BEFORE consuming
  if (payload.idx !== expectedSegmentIndex) {
    return { valid: false, reason: `Segment index mismatch: token authorized for ${payload.idx}, got ${expectedSegmentIndex}` };
  }

  // Step 5: Atomically verify unconsumed status and record consumption across instances
  let consumedOk: boolean;
  try {
    consumedOk = tryAtomicConsumeToken(sig, payload.exp, nowS);
  } catch (err: any) {
    console.error(`FATAL: Durable replay protection failed during token consumption: ${err.message}`);
    return { valid: false, reason: `Durable replay protection failure: ${err.message}` };
  }
  if (!consumedOk) {
    return { valid: false, reason: 'Access token already consumed (replay prevented)' };
  }

  return {
    valid: true,
    record: payload,
  };
}

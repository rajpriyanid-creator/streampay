import crypto from 'crypto';
import { type Hex } from 'viem';
import { config } from './config';

const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

export interface TokenPayload {
  sid: string;
  stream: string;
  idx: number;
  exp: number;
}

const b64u = (b: Buffer) => b.toString('base64url');

export function issueToken(p: Omit<TokenPayload, 'exp'>): string {
  const payload: TokenPayload = { ...p, exp: Math.floor(Date.now() / 1000) + config.tokenTtlSec };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function mintAccessToken(sessionId: Hex, streamId: string, segmentIndex: number): string {
  return issueToken({
    sid: sessionId,
    stream: streamId,
    idx: segmentIndex,
  });
}

const consumed = new Map<string, number>();

/**
 * Verify a token's HMAC and expiry without consuming it.
 * Returns the payload if valid, null otherwise.
 */
export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    const nowS = Math.floor(Date.now() / 1000);
    if (typeof p.exp !== 'number' || p.exp < nowS) return null;
    if (consumed.has(sig)) return null;
    return p;
  } catch { return null; }
}

/**
 * Mark a token as consumed (single-use enforcement).
 */
function markConsumed(token: string): void {
  const [, sig] = String(token || '').split('.');
  if (!sig) return;
  const nowS = Math.floor(Date.now() / 1000);
  // Garbage collect expired entries
  for (const [k, e] of consumed) if (e < nowS) consumed.delete(k);
  // Parse payload for expiry
  const payload = verifyToken(token);
  consumed.set(sig, payload?.exp ?? nowS + 60);
}

/**
 * Consume an access token ONLY after all validations pass.
 * This ensures a token submitted against the wrong path is NOT burned.
 *
 * Validation order:
 * 1. Verify HMAC + expiry + single-use
 * 2. Validate stream ID matches token
 * 3. Validate segment index matches token
 * 4. Only THEN mark as consumed
 */
export function consumeAccessToken(
  token: string,
  expectedStreamId: string,
  expectedSegmentIndex: number
): { valid: boolean; reason?: string; record?: TokenPayload } {
  // Step 1: Verify token (HMAC, expiry, not already consumed)
  const payload = verifyToken(token);
  if (!payload) {
    return { valid: false, reason: 'Invalid, expired, or already consumed access token' };
  }

  // Step 2: Validate stream binding BEFORE consuming
  if (payload.stream !== expectedStreamId) {
    // DO NOT consume the token — it may be valid for the correct stream
    return { valid: false, reason: `Stream ID mismatch: token authorized for ${payload.stream}, got ${expectedStreamId}` };
  }

  // Step 3: Validate segment index binding BEFORE consuming
  if (payload.idx !== expectedSegmentIndex) {
    // DO NOT consume the token — it may be valid for the correct segment
    return { valid: false, reason: `Segment index mismatch: token authorized for ${payload.idx}, got ${expectedSegmentIndex}` };
  }

  // Step 4: All checks passed — NOW consume the token
  markConsumed(token);

  return {
    valid: true,
    record: payload,
  };
}

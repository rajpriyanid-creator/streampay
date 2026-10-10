import crypto from 'crypto';
import { type Hex } from 'viem';
import { config } from './config';

const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

export interface TokenPayload { sid: string; stream: string; idx: number; exp: number }

const b64u = (b: Buffer) => b.toString('base64url');

export function issueToken(p: Omit<TokenPayload, 'exp'>): string {
  const payload: TokenPayload = { ...p, exp: Math.floor(Date.now() / 1000) + config.tokenTtlSec };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function mintAccessToken(sessionId: Hex, segmentIndex: number): string {
  return issueToken({
    sid: sessionId,
    stream: 'demo-stream',
    idx: segmentIndex,
  });
}

const consumed = new Map<string, number>();

export function verifyToken(token: string, consume = false): TokenPayload | null {
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
    if (consume) {
      for (const [k, e] of consumed) if (e < nowS) consumed.delete(k);
      consumed.set(sig, p.exp);
    }
    return p;
  } catch { return null; }
}

export function consumeAccessToken(token: string): { valid: boolean; reason?: string; record?: { sessionId: string; segmentIndex: number } } {
  const payload = verifyToken(token, true);
  if (!payload) {
    return { valid: false, reason: 'Invalid, expired, or already consumed access token' };
  }
  return {
    valid: true,
    record: {
      sessionId: payload.sid,
      segmentIndex: payload.idx,
    },
  };
}

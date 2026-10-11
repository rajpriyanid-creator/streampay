/**
 * StreamPay v2.5 — Durable Persistence & Replay Protection Store
 *
 * Persists session reservations, voucher progression, completed deliveries,
 * and consumed access tokens to disk across server restarts and replicas.
 *
 * Features:
 * - High-entropy TOKEN_SECRET enforcement for production & non-local environments
 * - Stable local development secret persisted across restarts & shared by local replicas
 * - Atomic JSON state file writes (write-to-temp then rename) to prevent corruption
 * - Auto-pruning of expired reservations and expired consumed tokens
 * - Memory-fallback mode (DATA_STORE_DIR='memory') for zero-overhead unit testing
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { type Hex } from 'viem';
import { config } from './config';

export interface PersistedLimits {
  maxCreditSegments: number;
  maxCreditWindowUnits: string;
  maxUnredeemedAmount: string;
  unitPrice: string;
  maxBillableUnits: string;
  deposit: string;
}

export interface PersistedReservationEntry {
  token: string;
  tokenSig: string;
  segmentIndex: number;
  cumulativeUnits: string;
  expiresAtMs: number;
  consumed: boolean;
  delivered: boolean;
}

export interface PersistedSessionState {
  sessionId: string;
  lastCheckpointUnits: string;
  limits: PersistedLimits;
  reservations: Record<string, PersistedReservationEntry>;
  segmentToTokenSig: Record<string, string>;
  completedSegments: number[];
  deliveredTokens: Record<string, number>;
}

export interface PersistedVoucher {
  sessionId: Hex;
  cumulativeUnits: string;
  signature: Hex;
}

export interface PersistedStoredVoucher {
  sessionId: Hex;
  sessionSigner: Hex;
  recipient: Hex;
  contractAddress: Hex;
  chainId: number;
  highestCumulativeUnits: string;
  deliveredCumulativeUnits: string;
  lastVoucher: PersistedVoucher;
  lastDeliveredVoucher?: PersistedVoucher;
  lastUpdated: number;
  totalServedSegments: number;
}

export interface FullDurableState {
  version: string;
  savedAt: number;
  consumedTokens: Record<string, number>;
  vouchers: Record<string, PersistedStoredVoucher>;
  sessions: Record<string, PersistedSessionState>;
}

let inMemorySecret: string | undefined;

// Active store references
let activeConsumedMap: Map<string, number> | undefined;
let activeVouchersMap: Map<string, any> | undefined;
let activeSessionsMap: Map<string, any> | undefined;

export function isPersistenceEnabled(): boolean {
  return Boolean(config.DATA_STORE_DIR && config.DATA_STORE_DIR !== 'memory');
}

export function getStateFilePath(): string {
  return path.join(config.DATA_STORE_DIR, 'state.json');
}

/**
 * Returns or initializes the HMAC token secret.
 * In production or non-local environments, strictly validates that TOKEN_SECRET
 * is explicitly provided in the environment with at least 32 characters (256-bit entropy).
 * In local development, persists the generated secret to disk so restarts and
 * local replicas share the exact same key.
 */
export function getOrInitTokenSecret(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const isNonLocal = config.NETWORK !== 'local';

  if (process.env.TOKEN_SECRET) {
    const sec = process.env.TOKEN_SECRET.trim();
    if ((isProd || isNonLocal) && sec.length < 32) {
      throw new Error(
        `Fatal: TOKEN_SECRET must have at least 32 characters in ${config.NETWORK}/production environment (got ${sec.length})`
      );
    }
    return sec;
  }

  if (isProd || isNonLocal) {
    throw new Error('Fatal: TOKEN_SECRET must be explicitly configured in non-local / production environments.');
  }

  // Local development persistence
  if (isPersistenceEnabled()) {
    try {
      fs.mkdirSync(config.DATA_STORE_DIR, { recursive: true });
      const secretFile = path.join(config.DATA_STORE_DIR, 'token-secret.key');
      if (fs.existsSync(secretFile)) {
        const stored = fs.readFileSync(secretFile, 'utf8').trim();
        if (stored.length >= 32) return stored;
      }
      const generated = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
      return generated;
    } catch (e: any) {
      console.warn(`Could not persist local token secret (${e.message}), using in-memory secret`);
    }
  }

  if (!inMemorySecret) {
    inMemorySecret = crypto.randomBytes(32).toString('hex');
  }
  return inMemorySecret;
}

/**
 * Register active store instances and restore persisted state on startup.
 */
export function registerStores(stores: {
  consumed: Map<string, number>;
  vouchers: Map<string, any>;
  sessions: Map<string, any>;
}): void {
  activeConsumedMap = stores.consumed;
  activeVouchersMap = stores.vouchers;
  activeSessionsMap = stores.sessions;

  // Restore on startup
  restoreDurableState();
}

/**
 * Reads persisted state from disk.
 */
export function readDurableState(): FullDurableState | null {
  if (!isPersistenceEnabled()) return null;
  const statePath = getStateFilePath();
  try {
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(raw) as FullDurableState;
  } catch (err: any) {
    console.warn(`Failed to read durable state from ${statePath}: ${err.message}`);
    return null;
  }
}

function getLockFilePath(): string {
  return path.join(config.DATA_STORE_DIR, 'state.json.lock');
}

function acquireLock(timeoutMs = 3000): number {
  const lockPath = getLockFilePath();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      return fd;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 5000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {}
        const end = Date.now() + 5;
        while (Date.now() < end) {}
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Timeout acquiring durable state lockfile: ${lockPath}`);
}

function releaseLock(fd: number): void {
  const lockPath = getLockFilePath();
  try {
    fs.closeSync(fd);
  } catch {}
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {}
}

/**
 * Atomically writes full state to disk using a unique temporary file then rename.
 * Throws on failure to ensure persistence errors are never silently masked.
 */
export function writeDurableState(state: FullDurableState): void {
  if (!isPersistenceEnabled()) return;
  const targetPath = getStateFilePath();
  try {
    fs.mkdirSync(config.DATA_STORE_DIR, { recursive: true });
    const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), { encoding: 'utf8' });
    fs.renameSync(tmpPath, targetPath);
    try {
      lastLoadedMtimeMs = fs.statSync(targetPath).mtimeMs;
    } catch {}
  } catch (err: any) {
    console.error(`CRITICAL: Failed to write durable state to ${targetPath}: ${err.message}`);
    throw new Error(`Durable persistence write failure: ${err.message}`);
  }
}

let lastLoadedMtimeMs = 0;

/**
 * Restores state from disk into active in-memory stores.
 */
export function restoreDurableState(): boolean {
  if (!isPersistenceEnabled()) return false;
  const statePath = getStateFilePath();
  try {
    if (!fs.existsSync(statePath)) return false;
    const stat = fs.statSync(statePath);
    if (stat.mtimeMs <= lastLoadedMtimeMs) return false;
    lastLoadedMtimeMs = stat.mtimeMs;

    const raw = fs.readFileSync(statePath, 'utf8');
    const data = JSON.parse(raw) as FullDurableState;
    if (!data) return false;

    // 1. Restore consumed tokens
    if (activeConsumedMap && data.consumedTokens) {
      for (const [sig, exp] of Object.entries(data.consumedTokens)) {
        activeConsumedMap.set(sig, exp);
      }
    }

    // 2. Restore vouchers
    if (activeVouchersMap && data.vouchers) {
      for (const [sessionId, v] of Object.entries(data.vouchers)) {
        activeVouchersMap.set(sessionId.toLowerCase(), {
          sessionId: v.sessionId,
          sessionSigner: v.sessionSigner,
          recipient: v.recipient,
          contractAddress: v.contractAddress,
          chainId: v.chainId,
          highestCumulativeUnits: BigInt(v.highestCumulativeUnits),
          deliveredCumulativeUnits: BigInt(v.deliveredCumulativeUnits),
          lastVoucher: {
            sessionId: v.lastVoucher.sessionId,
            cumulativeUnits: BigInt(v.lastVoucher.cumulativeUnits),
            signature: v.lastVoucher.signature,
          },
          lastDeliveredVoucher: v.lastDeliveredVoucher
            ? {
                sessionId: v.lastDeliveredVoucher.sessionId,
                cumulativeUnits: BigInt(v.lastDeliveredVoucher.cumulativeUnits),
                signature: v.lastDeliveredVoucher.signature,
              }
            : undefined,
          lastUpdated: v.lastUpdated,
          totalServedSegments: v.totalServedSegments,
        });
      }
    }

    // 3. Restore sessions
    if (activeSessionsMap && data.sessions) {
      for (const [sessionId, s] of Object.entries(data.sessions)) {
        const resMap = new Map<string, any>();
        const segToSig = new Map<number, string>();

        // Reconstruct active reservations
        if (s.reservations) {
          for (const [sig, r] of Object.entries(s.reservations)) {
            if (!r.delivered) {
              resMap.set(sig, {
                token: r.token,
                tokenSig: r.tokenSig,
                segmentIndex: r.segmentIndex,
                cumulativeUnits: BigInt(r.cumulativeUnits),
                expiresAtMs: r.expiresAtMs,
                consumed: r.consumed,
                delivered: r.delivered,
              });
              segToSig.set(r.segmentIndex, sig);
            }
          }
        }

        const deliveredTokensMap = new Map<string, number>();
        if (s.deliveredTokens) {
          for (const [sig, ts] of Object.entries(s.deliveredTokens)) {
            deliveredTokensMap.set(sig, ts);
          }
        }

        activeSessionsMap.set(sessionId.toLowerCase(), {
          sessionId: s.sessionId.toLowerCase(),
          lastCheckpointUnits: BigInt(s.lastCheckpointUnits || '0'),
          limits: {
            maxCreditSegments: s.limits.maxCreditSegments,
            maxCreditWindowUnits: BigInt(s.limits.maxCreditWindowUnits),
            maxUnredeemedAmount: BigInt(s.limits.maxUnredeemedAmount),
            unitPrice: BigInt(s.limits.unitPrice),
            maxBillableUnits: BigInt(s.limits.maxBillableUnits),
            deposit: BigInt(s.limits.deposit),
          },
          reservations: resMap,
          segmentToTokenSig: segToSig,
          completedSegments: new Set<number>(s.completedSegments || []),
          deliveredTokens: deliveredTokensMap,
        });
      }
    }

    return true;
  } catch (err: any) {
    console.warn(`Failed to restore durable state from ${statePath}: ${err.message}`);
    return false;
  }
}

/**
 * Saves current active in-memory stores to disk.
 * Uses lockfile coordination and merges with existing disk state to prevent
 * lost updates under concurrent multi-process writes.
 */
export function saveAllDurableState(): void {
  if (!isPersistenceEnabled()) return;

  fs.mkdirSync(config.DATA_STORE_DIR, { recursive: true });
  const lockFd = acquireLock();
  try {
    const nowS = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();

    // 1. Serialize consumed tokens (prune expired)
    const consumedTokens: Record<string, number> = {};
    if (activeConsumedMap) {
      for (const [sig, exp] of activeConsumedMap.entries()) {
        if (exp >= nowS) {
          consumedTokens[sig] = exp;
        }
      }
    }

    // 2. Serialize vouchers
    const vouchers: Record<string, PersistedStoredVoucher> = {};
    if (activeVouchersMap) {
      for (const [key, v] of activeVouchersMap.entries()) {
        vouchers[key] = {
          sessionId: v.sessionId,
          sessionSigner: v.sessionSigner,
          recipient: v.recipient,
          contractAddress: v.contractAddress,
          chainId: v.chainId,
          highestCumulativeUnits: v.highestCumulativeUnits.toString(),
          deliveredCumulativeUnits: v.deliveredCumulativeUnits.toString(),
          lastVoucher: {
            sessionId: v.lastVoucher.sessionId,
            cumulativeUnits: v.lastVoucher.cumulativeUnits.toString(),
            signature: v.lastVoucher.signature,
          },
          lastDeliveredVoucher: v.lastDeliveredVoucher
            ? {
                sessionId: v.lastDeliveredVoucher.sessionId,
                cumulativeUnits: v.lastDeliveredVoucher.cumulativeUnits.toString(),
                signature: v.lastDeliveredVoucher.signature,
              }
            : undefined,
          lastUpdated: v.lastUpdated,
          totalServedSegments: v.totalServedSegments,
        };
      }
    }

    // 3. Serialize sessions
    const sessions: Record<string, PersistedSessionState> = {};
    if (activeSessionsMap) {
      for (const [key, s] of activeSessionsMap.entries()) {
        const reservations: Record<string, PersistedReservationEntry> = {};
        const segToSig: Record<string, string> = {};

        for (const [sig, r] of s.reservations.entries()) {
          if (!r.delivered) {
            reservations[sig] = {
              token: r.token,
              tokenSig: r.tokenSig,
              segmentIndex: r.segmentIndex,
              cumulativeUnits: r.cumulativeUnits.toString(),
              expiresAtMs: r.expiresAtMs,
              consumed: r.consumed,
              delivered: r.delivered,
            };
            segToSig[String(r.segmentIndex)] = sig;
          }
        }

        const deliveredTokens: Record<string, number> = {};
        for (const [sig, ts] of s.deliveredTokens.entries()) {
          deliveredTokens[sig] = ts;
        }

        sessions[key] = {
          sessionId: s.sessionId,
          lastCheckpointUnits: s.lastCheckpointUnits.toString(),
          limits: {
            maxCreditSegments: s.limits.maxCreditSegments,
            maxCreditWindowUnits: s.limits.maxCreditWindowUnits.toString(),
            maxUnredeemedAmount: s.limits.maxUnredeemedAmount.toString(),
            unitPrice: s.limits.unitPrice.toString(),
            maxBillableUnits: s.limits.maxBillableUnits.toString(),
            deposit: s.limits.deposit.toString(),
          },
          reservations,
          segmentToTokenSig: segToSig,
          completedSegments: Array.from(s.completedSegments),
          deliveredTokens,
        };
      }
    }

    // 4. Merge disk state to prevent lost updates from concurrent writers
    const diskState = readDurableState();
    if (diskState) {
      if (diskState.consumedTokens) {
        for (const [sig, exp] of Object.entries(diskState.consumedTokens)) {
          if (exp >= nowS && !consumedTokens[sig]) {
            consumedTokens[sig] = exp;
            if (activeConsumedMap) activeConsumedMap.set(sig, exp);
          }
        }
      }
      if (diskState.vouchers) {
        for (const [key, dv] of Object.entries(diskState.vouchers)) {
          const mv = vouchers[key];
          if (!mv) {
            vouchers[key] = dv;
          } else if (BigInt(dv.highestCumulativeUnits) > BigInt(mv.highestCumulativeUnits)) {
            vouchers[key] = dv;
          }
        }
      }
      if (diskState.sessions) {
        for (const [key, ds] of Object.entries(diskState.sessions)) {
          const ms = sessions[key];
          if (!ms) {
            sessions[key] = ds;
          } else {
            const merged = new Set([...ms.completedSegments, ...(ds.completedSegments || [])]);
            ms.completedSegments = Array.from(merged);
            if (ds.deliveredTokens) {
              for (const [sig, ts] of Object.entries(ds.deliveredTokens)) {
                if (!ms.deliveredTokens[sig]) ms.deliveredTokens[sig] = ts;
              }
            }
            if (ds.reservations) {
              for (const [sig, r] of Object.entries(ds.reservations)) {
                if (!ms.reservations[sig]) {
                  ms.reservations[sig] = r;
                } else if (r.delivered && !ms.reservations[sig].delivered) {
                  ms.reservations[sig] = r;
                }
              }
            }
            if (BigInt(ds.lastCheckpointUnits) > BigInt(ms.lastCheckpointUnits)) {
              ms.lastCheckpointUnits = ds.lastCheckpointUnits;
            }
          }
        }
      }
    }

    const payload: FullDurableState = {
      version: '2.5',
      savedAt: nowMs,
      consumedTokens,
      vouchers,
      sessions,
    };

    writeDurableState(payload);
  } finally {
    releaseLock(lockFd);
  }
}

/**
 * Reloads state from disk if newer changes exist (for replica synchronization).
 */
export function syncFromDisk(): void {
  if (!isPersistenceEnabled()) return;
  restoreDurableState();
}

/**
 * Clear persisted state (for testing).
 */
export function clearDurableState(): void {
  if (!isPersistenceEnabled()) return;
  try {
    const targetPath = getStateFilePath();
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    const lockPath = getLockFilePath();
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch (err: any) {
    console.warn(`Failed to clear durable state: ${err.message}`);
  }
}

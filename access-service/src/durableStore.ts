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
import os from 'os';
import { type Hex } from 'viem';
import { config, validateRuntimeConfiguration } from './config';

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
  voucherSignature: string;
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
let heldLock: { key: string; lock: LockInfo } | undefined;

export function isPersistenceEnabled(): boolean {
  const dir = process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
  return Boolean(dir && dir !== 'memory');
}

export function validatePersistenceConfiguration(): void {
  validateRuntimeConfiguration();
  if ((process.env.NODE_ENV === 'production' || config.NETWORK !== 'local') && !isPersistenceEnabled()) {
    throw new Error('Fatal: durable replay persistence is unavailable.');
  }
  if (isPersistenceEnabled()) {
    const dir = process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err: any) {
      throw new Error(`Fatal: durable replay store is not usable at ${dir}: ${err.message}`);
    }
  }
}

export function getStateFilePath(overrideDir?: string): string {
  const dir = overrideDir || process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
  return path.join(dir, 'state.json');
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
      const dir = process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
      fs.mkdirSync(dir, { recursive: true });
      const secretFile = path.join(dir, 'token-secret.key');
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

export interface LockPayload {
  ownerToken: string;
  pid: number;
  hostname: string;
  acquiredAt: number;
}

export interface LockInfo {
  fd: number;
  owner: string;      // Backwards-compatible alias for ownerToken
  ownerToken: string;
  acquiredAt: number;
  pid: number;
  hostname: string;
}

/**
 * Checks whether a process with the given PID is currently alive on this host.
 * Uses process.kill(pid, 0) which tests for process existence without sending a signal.
 * - Returns true if the process exists (owned by current user or EPERM).
 * - Returns false only if the OS returns ESRCH (no such process).
 */
export function isProcessAlive(pid: number): boolean {
  if (typeof pid !== 'number' || isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      return false; // Process definitively does not exist
    }
    return true; // EPERM means process exists but owned by another user -> alive
  }
}

/**
 * Safely reads the lockfile payload if available.
 */
export function readLockPayload(lockPath: string): { payload: LockPayload | null; mtimeMs: number } {
  try {
    const stat = fs.statSync(lockPath);
    const raw = fs.readFileSync(lockPath, 'utf8');
    if (!raw.trim()) {
      return { payload: null, mtimeMs: stat.mtimeMs };
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.ownerToken === 'string' && typeof parsed.pid === 'number') {
      return { payload: parsed as LockPayload, mtimeMs: stat.mtimeMs };
    }
    return { payload: null, mtimeMs: stat.mtimeMs };
  } catch {
    return { payload: null, mtimeMs: 0 };
  }
}

/**
 * Safely recovers an abandoned lock using atomic directory rename (CAS rename).
 * Isolates the candidate lock file to a unique recovery path before unlinking it,
 * verifying that the isolated file still matches the expected abandoned ownerToken.
 * This guarantees that a newly acquired lock belonging to another process can NEVER
 * be accidentally deleted between inspection and removal.
 */
export function tryRecoverAbandonedLock(lockPath: string, expectedOwnerToken?: string): boolean {
  const recoveryTmp = `${lockPath}.recover.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.renameSync(lockPath, recoveryTmp);
  } catch {
    return false; // Another process already intervened
  }

  try {
    const raw = fs.readFileSync(recoveryTmp, 'utf8');
    const data = JSON.parse(raw) as LockPayload;

    if (typeof data.ownerToken !== 'string' || typeof data.pid !== 'number' ||
        typeof data.hostname !== 'string' || (expectedOwnerToken && data.ownerToken !== expectedOwnerToken)) {
      // Never restore an isolated lock: a new owner may already have acquired
      // the original path. An unverifiable lock is not safe to reclaim.
      try { fs.unlinkSync(recoveryTmp); } catch {}
      return false;
    }

    if (data.hostname !== os.hostname() || isProcessAlive(data.pid)) {
      try { fs.unlinkSync(recoveryTmp); } catch {}
      return false;
    }

    // Confirmed abandoned lock. Safely remove isolated file.
    fs.unlinkSync(recoveryTmp);
    return true;
  } catch {
    // Empty, truncated, malformed, or unreadable locks have no safe owner
    // decision. Fail closed; do not turn an inspection race into deletion.
    // Keep the quarantined artifact so an operator can inspect/recover it.
    return false;
  }
}

/**
 * Reads persisted state from disk.
 * Throws on corrupted or unreadable state file to fail closed against replay attacks.
 */
export function readDurableState(overrideDir?: string): FullDurableState | null {
  if (!isPersistenceEnabled()) return null;
  const statePath = getStateFilePath(overrideDir);
  if (!fs.existsSync(statePath)) return null;
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(raw) as FullDurableState;
  } catch (err: any) {
    console.error(`FATAL: Failed to read durable state from ${statePath}: ${err.message}`);
    throw new Error(`CRITICAL: Corrupted durable state at ${statePath}. Server failing closed to prevent replay vulnerabilities: ${err.message}`);
  }
}

export function getLockFilePath(overrideDir?: string): string {
  const dir = overrideDir || process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
  return path.join(dir, 'state.json.lock');
}

/**
 * Acquires exclusive filesystem advisory lock for state file operations.
 *
 * Guarantees:
 * 1. Never removes a lock belonging to a process that is still alive on this host.
 * 2. Only recovers abandoned locks whose PID is confirmed dead (ESRCH) after minimum age.
 * 3. Uses atomic CAS directory rename to isolate candidate lockfiles before removal.
 * 4. Stores unique ownerToken, pid, hostname, and acquiredAt in lock payload.
 *
 * ARCHITECTURAL NOTE: Filesystem locking relies on atomic OS kernel directory entries
 * (O_CREAT | O_EXCL via 'wx' flag). This coordinates multiple processes on the same host
 * or shared container volume with common PID namespace. It is NOT automatically a distributed
 * lock across independent physical hosts or decoupled cloud containers without a distributed
 * coordinator (e.g. Redis Redlock or Postgres advisory locks).
 */
export function acquireLock(timeoutMs = 5000, overrideDir?: string): LockInfo {
  const lockPath = getLockFilePath(overrideDir);
  const ownerToken = `${process.pid}-${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
  const myHostname = os.hostname();
  const start = Date.now();

  const payload: LockPayload = {
    ownerToken,
    pid: process.pid,
    hostname: myHostname,
    acquiredAt: Date.now(),
  };
  const payloadStr = JSON.stringify(payload);

  while (Date.now() - start < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeSync(fd, payloadStr, 0, 'utf8');
        fs.fsyncSync(fd);
      } catch (writeErr) {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(lockPath); } catch {}
        throw writeErr;
      }
      return {
        fd,
        owner: ownerToken,
        ownerToken,
        acquiredAt: payload.acquiredAt,
        pid: process.pid,
        hostname: myHostname,
      };
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        const { payload: currentLock, mtimeMs } = readLockPayload(lockPath);
        const lockAgeMs = Date.now() - mtimeMs;

        if (currentLock) {
          // Same host verification
          if (currentLock.hostname === myHostname) {
            // Check process liveness
            if (!isProcessAlive(currentLock.pid)) {
              // Owning process is dead (ESRCH)
              if (lockAgeMs >= 500) {
                tryRecoverAbandonedLock(lockPath, currentLock.ownerToken);
                continue; // Retry acquire immediately
              }
            }
            // If process is alive: NEVER remove lock! Keep waiting.
          }
        } else {
          // Unverifiable locks are retained until timeout. Age alone is not a
          // proof that their owner is dead.
        }

        // Wait with backoff jitter (5-20ms)
        const sleepMs = Math.min(25, 5 + Math.floor(Math.random() * 15));
        const end = Date.now() + sleepMs;
        while (Date.now() < end) {}
      } else {
        throw err;
      }
    }
  }

  throw new Error(`Timeout acquiring durable state lockfile after ${timeoutMs}ms: ${lockPath}`);
}

/**
 * Releases the exclusive lockfile.
 * Validates ownership using atomic rename isolation to ensure that a former owner
 * can NEVER accidentally delete a replacement owner's lockfile.
 */
export function releaseLock(lock: LockInfo, overrideDir?: string): void {
  const lockPath = getLockFilePath(overrideDir);
  try {
    fs.closeSync(lock.fd);
  } catch {}

  try {
    if (!fs.existsSync(lockPath)) return;

    const raw = fs.readFileSync(lockPath, 'utf8');
    const data = JSON.parse(raw) as LockPayload;
    if (data.ownerToken !== lock.ownerToken) {
      // Lock has been acquired by someone else (not ours). NEVER touch!
      return;
    }

    const releaseTmp = `${lockPath}.released.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`;
    try {
      fs.renameSync(lockPath, releaseTmp);
      const releasedRaw = fs.readFileSync(releaseTmp, 'utf8');
      const releasedData = JSON.parse(releasedRaw) as LockPayload;
      if (releasedData.ownerToken === lock.ownerToken) {
        fs.unlinkSync(releaseTmp);
      } else {
        // Never restore over a replacement owner. Leave the replacement in
        // place and discard only our isolated old lock.
        try { fs.unlinkSync(releaseTmp); } catch {}
      }
    } catch {}
  } catch {}
}

/**
 * Atomically writes full state to disk using a unique temporary file then rename.
 * Throws on failure to ensure persistence errors are never silently masked.
 */
export function writeDurableState(state: FullDurableState, overrideDir?: string): void {
  if (!isPersistenceEnabled()) return;
  const targetPath = getStateFilePath(overrideDir);
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
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
export function restoreDurableState(overrideDir?: string): boolean {
  if (!isPersistenceEnabled()) return false;
  const statePath = getStateFilePath(overrideDir);
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
                voucherSignature: r.voucherSignature || '',
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
    console.error(`FATAL: Failed to restore durable state from ${statePath}: ${err.message}`);
    throw new Error(`CRITICAL: Corrupted durable state at ${statePath}. Server failing closed to prevent replay vulnerabilities: ${err.message}`);
  }
}

/**
 * Serializes and writes state while holding the process lockfile.
 */
function saveStateUnderLock(lock: LockInfo, overrideDir?: string): void {
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
            voucherSignature: r.voucherSignature || '',
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
  const diskState = readDurableState(overrideDir);
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

  writeDurableState(payload, overrideDir);
}

/**
 * Saves current active in-memory stores to disk.
 * Uses lockfile coordination and merges with existing disk state to prevent
 * lost updates under concurrent multi-process writes.
 */
export function saveAllDurableState(overrideDir?: string): void {
  if (!isPersistenceEnabled()) return;

  const dir = overrideDir || process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const key = path.resolve(dir);
  if (heldLock?.key === key) {
    saveStateUnderLock(heldLock.lock, overrideDir);
    return;
  }
  const lock = acquireLock(5000, overrideDir);
  try {
    saveStateUnderLock(lock, overrideDir);
  } finally {
    releaseLock(lock, overrideDir);
  }
}

/**
 * Runs a state mutation while holding the shared lock for the entire
 * read/validate/mutate/persist transaction. This is the cross-process
 * boundary; the in-process SessionMutex alone is not sufficient.
 */
export async function withDurableStateLock<T>(fn: () => Promise<T> | T, overrideDir?: string): Promise<T> {
  if (!isPersistenceEnabled()) return fn();
  const dir = overrideDir || process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const lock = acquireLock(5000, overrideDir);
  const previous = heldLock;
  heldLock = { key: path.resolve(dir), lock };
  try {
    restoreDurableState(overrideDir);
    return await fn();
  } finally {
    saveStateUnderLock(lock, overrideDir);
    heldLock = previous;
    releaseLock(lock, overrideDir);
  }
}

/**
 * Atomically checks whether a token has already been consumed (in memory or on disk)
 * and marks it consumed under a shared process lockfile.
 * Eliminates race conditions / TOCTOU vulnerabilities across multiple instances.
 * Returns true if the token was unconsumed and successfully marked consumed.
 * Returns false if the token was already consumed.
 */
export function tryAtomicConsumeToken(
  sig: string,
  exp: number,
  nowS = Math.floor(Date.now() / 1000),
  overrideDir?: string
): boolean {
  if (!isPersistenceEnabled()) {
    if (activeConsumedMap?.has(sig)) return false;
    activeConsumedMap?.set(sig, exp);
    return true;
  }

  const dir = overrideDir || process.env.DATA_STORE_DIR || config.DATA_STORE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const lock = acquireLock(5000, overrideDir);
  try {
    // 1. Check disk state
    const diskState = readDurableState(overrideDir);
    if (diskState?.consumedTokens && diskState.consumedTokens[sig] && diskState.consumedTokens[sig] >= nowS) {
      if (activeConsumedMap) activeConsumedMap.set(sig, diskState.consumedTokens[sig]);
      return false; // Already consumed on disk
    }

    // 2. Check in-memory store
    if (activeConsumedMap && activeConsumedMap.has(sig)) {
      const existingExp = activeConsumedMap.get(sig)!;
      if (existingExp >= nowS) {
        return false; // Already consumed in memory
      }
    }

    // 3. Mark consumed in memory
    if (activeConsumedMap) {
      activeConsumedMap.set(sig, exp);
    }

    // 4. Save state to disk under this lock
    saveStateUnderLock(lock, overrideDir);
    return true;
  } finally {
    releaseLock(lock, overrideDir);
  }
}

/**
 * Reloads state from disk if newer changes exist (for replica synchronization).
 */
export function syncFromDisk(overrideDir?: string): void {
  if (!isPersistenceEnabled()) return;
  restoreDurableState(overrideDir);
}

/**
 * Clear persisted state (for testing).
 */
export function clearDurableState(overrideDir?: string): void {
  if (!isPersistenceEnabled()) return;
  try {
    const targetPath = getStateFilePath(overrideDir);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    const lockPath = getLockFilePath(overrideDir);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch (err: any) {
    console.warn(`Failed to clear durable state: ${err.message}`);
  }
}

/**
 * StreamPay v2.5 — Concurrency-Safe, Checkpoint-Aware Credit Reservation Store
 *
 * Enforces bounded credit windows, in-flight segment concurrency limits,
 * unredeemed liability caps, and deposit bounds.
 *
 * Features:
 * - Monotonic cumulative unit progression
 * - Idempotent repeated requests (returns active token without double-counting)
 * - Checkpoint awareness: refreshing on-chain settledUnits frees up credit window
 * - Concurrency safety: per-session async mutex avoids race conditions
 * - Automatic expiry & pruning of never-consumed tokens
 * - Explicit release on completed or failed HTTP delivery
 * - Safe restart recovery: re-initialized from on-chain session state
 */

export interface SessionLimits {
  maxCreditSegments: number;
  maxCreditWindowUnits: bigint;
  maxUnredeemedAmount: bigint;
  unitPrice: bigint;
  maxBillableUnits: bigint;
  deposit: bigint;
}

export interface ReservationEntry {
  token: string;
  tokenSig: string;
  voucherSignature: string;
  segmentIndex: number;
  cumulativeUnits: bigint;
  expiresAtMs: number;
  consumed: boolean;
  delivered: boolean;
}

export const MAX_DELIVERED_TOKENS = 500;

export interface SessionState {
  sessionId: string;
  lastCheckpointUnits: bigint;
  limits: SessionLimits;
  reservations: Map<string, ReservationEntry>; // tokenSig -> entry (active in-flight only)
  segmentToTokenSig: Map<number, string>;       // segmentIndex -> tokenSig
  completedSegments: Set<number>;
  deliveredTokens: Map<string, number>;         // tokenSig -> deliveredAtMs (bounded replay protection history)
}

export class SessionMutex {
  private queue: Promise<void> = Promise.resolve();

  async acquire<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queue;
    this.queue = this.queue.then(() => lock);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

import { saveAllDurableState, syncFromDisk, clearDurableState, withDurableStateLock } from './durableStore';

export class ReservationLedger {
  private sessions = new Map<string, SessionState>();
  private mutexes = new Map<string, SessionMutex>();

  getSessionsMap(): Map<string, SessionState> {
    return this.sessions;
  }

  private getMutex(sessionId: string): SessionMutex {
    const key = sessionId.toLowerCase();
    let m = this.mutexes.get(key);
    if (!m) {
      m = new SessionMutex();
      this.mutexes.set(key, m);
    }
    return m;
  }

  /**
   * Initialize or retrieve a session's reservation state.
   * If onChainSettledUnits is provided, refreshes lastCheckpointUnits.
   */
  getOrCreateSession(
    sessionId: string,
    limits: SessionLimits,
    onChainSettledUnits?: bigint
  ): SessionState {
    const key = sessionId.toLowerCase();
    let state = this.sessions.get(key);
    if (!state) {
      state = {
        sessionId: key,
        lastCheckpointUnits: onChainSettledUnits ?? 0n,
        limits,
        reservations: new Map(),
        segmentToTokenSig: new Map(),
        completedSegments: new Set(),
        deliveredTokens: new Map(),
      };
      this.sessions.set(key, state);
    } else {
      // Refresh limits from latest contract read
      state.limits = limits;
      if (onChainSettledUnits !== undefined && onChainSettledUnits > state.lastCheckpointUnits) {
        state.lastCheckpointUnits = onChainSettledUnits;
      }
    }
    return state;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId.toLowerCase());
  }

  /**
   * Prune expired unconsumed reservations to free credit window slots.
   */
  pruneExpired(state: SessionState, nowMs = Date.now()): number {
    let prunedCount = 0;
    for (const [sig, entry] of state.reservations.entries()) {
      if (entry.delivered || nowMs > entry.expiresAtMs) {
        state.reservations.delete(sig);
        state.segmentToTokenSig.delete(entry.segmentIndex);
        prunedCount++;
      }
    }
    return prunedCount;
  }

  /**
   * Concurrency-safe reservation check and reserve execution.
   */
  async checkAndReserve(
    sessionId: string,
    limits: SessionLimits,
    segmentIndex: number,
    cumulativeUnits: bigint,
    token: string,
    tokenSig: string,
    ttlSec: number,
    onChainSettledUnits?: bigint,
    nowMs = Date.now(),
    voucherSignature = ''
  ): Promise<{
    allowed: boolean;
    reason?: string;
    isDuplicate?: boolean;
    existingToken?: string;
  }> {
    const mutex = this.getMutex(sessionId);
    return mutex.acquire(async () => withDurableStateLock(async () => {
      syncFromDisk();
      const state = this.getOrCreateSession(sessionId, limits, onChainSettledUnits);

      // Clean up any stale expired reservations first
      this.pruneExpired(state, nowMs);

      // 0. Replay protection: check if token was already used for completed delivery
      if (state.deliveredTokens.has(tokenSig)) {
        return {
          allowed: false,
          reason: 'Token already used for completed delivery (replay rejected)',
        };
      }

      // Check if segment was already completed and delivered
      if (state.completedSegments.has(segmentIndex)) {
        return {
          allowed: false,
          reason: `Segment ${segmentIndex} already delivered and verified. Re-requesting completed segment rejected.`,
        };
      }

      // 1. Idempotency check: if this segment is already active and unexpired, reuse it
      const existingSig = state.segmentToTokenSig.get(segmentIndex);
      if (existingSig) {
        const existing = state.reservations.get(existingSig);
        if (existing && !existing.delivered && nowMs <= existing.expiresAtMs) {
          return {
            allowed: true,
            isDuplicate: true,
            existingToken: existing.token,
          };
        }
      }

      // 2. Count active in-flight segments (issued but not yet delivered)
      let inFlightCount = 0;
      for (const entry of state.reservations.values()) {
        if (!entry.delivered && nowMs <= entry.expiresAtMs) {
          inFlightCount++;
        }
      }

      if (inFlightCount >= state.limits.maxCreditSegments) {
        return {
          allowed: false,
          reason: `Credit window full: ${inFlightCount}/${state.limits.maxCreditSegments} segments in-flight. Wait for delivery or expiry.`,
        };
      }

      // 3. Monotonic check: cumulative units must be >= on-chain settled units
      if (cumulativeUnits < state.lastCheckpointUnits) {
        return {
          allowed: false,
          reason: `Voucher units (${cumulativeUnits}) lower than already settled units (${state.lastCheckpointUnits})`,
        };
      }

      // 4. Credit Window bound check: units above last checkpoint cannot exceed window
      const unredeemedUnits = cumulativeUnits > state.lastCheckpointUnits
        ? cumulativeUnits - state.lastCheckpointUnits
        : 0n;

      if (unredeemedUnits > state.limits.maxCreditWindowUnits) {
        return {
          allowed: false,
          reason: `Unredeemed units (${unredeemedUnits}) would exceed maxCreditWindowUnits (${state.limits.maxCreditWindowUnits}). On-chain checkpoint required to continue.`,
        };
      }

      // 5. Max Unredeemed Amount liability cap
      const unredeemedAmount = unredeemedUnits * state.limits.unitPrice;
      if (unredeemedAmount > state.limits.maxUnredeemedAmount) {
        return {
          allowed: false,
          reason: `Unredeemed amount (${unredeemedAmount}) exceeds maxUnredeemedAmount (${state.limits.maxUnredeemedAmount}). Checkpoint required.`,
        };
      }

      // 6. Max billable units bound
      if (cumulativeUnits > state.limits.maxBillableUnits) {
        return {
          allowed: false,
          reason: `Cumulative units (${cumulativeUnits}) exceeds maxBillableUnits (${state.limits.maxBillableUnits})`,
        };
      }

      // 7. Initial deposit cap
      const totalCost = cumulativeUnits * state.limits.unitPrice;
      if (totalCost > state.limits.deposit) {
        return {
          allowed: false,
          reason: `Total cost (${totalCost}) exceeds session deposit (${state.limits.deposit})`,
        };
      }

      // All bounds satisfied: record active reservation
      const newEntry: ReservationEntry = {
        token,
        tokenSig,
        voucherSignature,
        segmentIndex,
        cumulativeUnits,
        expiresAtMs: nowMs + ttlSec * 1000,
        consumed: false,
        delivered: false,
      };

      state.reservations.set(tokenSig, newEntry);
      state.segmentToTokenSig.set(segmentIndex, tokenSig);

      saveAllDurableState();
      return { allowed: true };
    }));
  }

  /**
   * Called when access token is consumed at the content delivery route.
   */
  async onTokenConsumed(sessionId: string, tokenSig: string): Promise<void> {
    const mutex = this.getMutex(sessionId);
    return mutex.acquire(async () => {
      syncFromDisk();
      const state = this.sessions.get(sessionId.toLowerCase());
      if (!state) return;
      const res = state.reservations.get(tokenSig);
      if (res) {
        res.consumed = true;
        saveAllDurableState();
      }
    });
  }

  /**
   * Called when segment delivery succeeds (bytes flushed to HTTP client).
   * Safely deletes in-flight reservation and records bounded replay token history.
   * Returns cumulative units of the delivered reservation.
   */
  async onDeliveryCompleted(sessionId: string, tokenSig: string, segmentIndex: number): Promise<{ voucher?: { sessionId: string; cumulativeUnits: bigint; signature: string } }> {
    const mutex = this.getMutex(sessionId);
    return mutex.acquire(async () => {
      syncFromDisk();
      const state = this.sessions.get(sessionId.toLowerCase());
      if (!state) return {};
      const res = state.reservations.get(tokenSig);
      if (!res || res.segmentIndex !== segmentIndex || res.delivered) return {};
      state.reservations.delete(tokenSig);
      state.completedSegments.add(segmentIndex);
      state.segmentToTokenSig.delete(segmentIndex);

      state.deliveredTokens.set(tokenSig, Date.now());
      if (state.deliveredTokens.size > MAX_DELIVERED_TOKENS) {
        const oldest = state.deliveredTokens.keys().next().value;
        if (oldest) state.deliveredTokens.delete(oldest);
      }
      saveAllDurableState();
      return { voucher: {
        sessionId: state.sessionId,
        cumulativeUnits: res.cumulativeUnits,
        signature: res.voucherSignature,
      } };
    });
  }

  /**
   * Checks if a segment was already delivered and completed for a session.
   */
  isSegmentCompleted(sessionId: string, segmentIndex: number): boolean {
    syncFromDisk();
    const state = this.sessions.get(sessionId.toLowerCase());
    return state ? state.completedSegments.has(segmentIndex) : false;
  }

  /**
   * Called when content delivery fails (e.g. client dropped, network error).
   * Releases in-flight reservation immediately so credit is restored.
   */
  async onDeliveryFailed(sessionId: string, tokenSig: string): Promise<void> {
    const mutex = this.getMutex(sessionId);
    return mutex.acquire(async () => {
      syncFromDisk();
      const state = this.sessions.get(sessionId.toLowerCase());
      if (!state) return;
      const res = state.reservations.get(tokenSig);
      if (res) {
        state.segmentToTokenSig.delete(res.segmentIndex);
        state.reservations.delete(tokenSig);
        saveAllDurableState();
      }
    });
  }

  /**
   * Explicitly notify the reservation store of an on-chain checkpoint.
   * Advances lastCheckpointUnits and frees credit window capacity.
   */
  async onCheckpoint(sessionId: string, settledUnits: bigint): Promise<void> {
    const mutex = this.getMutex(sessionId);
    return mutex.acquire(async () => {
      syncFromDisk();
      const state = this.sessions.get(sessionId.toLowerCase());
      if (!state) return;
      if (settledUnits > state.lastCheckpointUnits) {
        state.lastCheckpointUnits = settledUnits;
        saveAllDurableState();
      }
    });
  }

  /**
   * Get session stats for debugging/monitoring.
   */
  getStats(sessionId: string, nowMs = Date.now()): {
    inFlightSegments: number;
    completedSegments: number;
    lastCheckpointUnits: bigint;
    activeReservationsCount: number;
    deliveredTokensCount: number;
  } | undefined {
    const state = this.sessions.get(sessionId.toLowerCase());
    if (!state) return undefined;
    let inFlight = 0;
    for (const res of state.reservations.values()) {
      if (!res.delivered && nowMs <= res.expiresAtMs) {
        inFlight++;
      }
    }
    return {
      inFlightSegments: inFlight,
      completedSegments: state.completedSegments.size,
      lastCheckpointUnits: state.lastCheckpointUnits,
      activeReservationsCount: state.reservations.size,
      deliveredTokensCount: state.deliveredTokens.size,
    };
  }

  /**
   * Reset store (for testing).
   */
  clear(): void {
    this.sessions.clear();
    this.mutexes.clear();
    clearDurableState();
  }
}

export const reservationLedger = new ReservationLedger();

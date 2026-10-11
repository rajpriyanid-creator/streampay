# StreamPay v2.5 — Security & Threat Model

## 1. Threat Model & Security Controls

### Replay Attacks
- **Session Nonces**: Payer nonces use an unordered bitmap (`nonceBitmap[account][wordPos]`) preventing duplicate session openings with the same nonce.
- **EIP-712 Domain Separation**: Every voucher and offer is strictly bound to `name`, `version`, `chainId`, and `verifyingContract`. A voucher signed for Monad Testnet cannot be replayed on another chain or contract instance.

### Over-Billing & Excessive Lead Claims
- **Elapsed-Plus-Lead Bound**: The contract enforces `cumulativeUnits <= effectiveElapsed + maxLeadUnits`. A malicious session signer cannot sign a maximum-value voucher immediately after opening the session.

### Reentrancy & Token Failure Fallbacks
- **Checks-Effects-Interactions (CEI)**: State updates (`settledUnits`, `settledAmount`, `status`) are completed before token transfers.
- **ReentrancyGuard**: All state-mutating functions incorporate OpenZeppelin `nonReentrant` modifier.
- **Push-with-Pull Fallback**: If an ERC-20 token transfer to creator or payer fails (e.g. blacklisted address, fee-on-transfer, reverting transfer), funds are safely credited to `claimable[token][account]` for pull withdrawal via `claim(address token)`.

### Access Gate & Content Auth
- **Single-Use Timed Access Tokens**: Segment content downloads require an HMAC-SHA256 access token with a 60-second TTL. Tokens are single-use and invalid after initial segment delivery.
- **Merkle Proof Verification**: Video segments are verified against the creator-signed `manifestRoot` before any micro-voucher is generated.

## 2. Durable Persistence & Concurrency Architecture

### Race-Safe Filesystem Locking
State file mutations (`state.json`) and token consumption claims are protected by exclusive advisory lockfiles (`state.json.lock`) with the following safety properties:
1. **Liveness-Preserving Retention**: A lock held by a live process (`process.kill(pid, 0)` is successful) is NEVER stolen, regardless of duration. Slow I/O, heavy load, or GC pauses will not cause an active process's lock to be reclaimed.
2. **Safe Abandonment Recovery**: Locks are only recovered if the lock owner PID is confirmed dead (`ESRCH`), the lock is older than 500ms, and the hostname matches `os.hostname()`.
3. **Atomic Owner Isolation**: Abandoned lock reclamation isolates only a validated lock owned by a confirmed-dead local process. It never restores an isolated lock over a replacement owner. Empty, malformed, truncated, or unreadable locks are retained and acquisition fails closed until an operator resolves them.
4. **Owner-Isolated Release**: Releasing a lock validates the unique `ownerToken` and isolates the lockfile via atomic rename before unlinking. A former owner can never delete or corrupt a replacement owner's lockfile.
5. **Fail-Closed Durability**: Corrupted or unreadable state files cause the service to fail closed (refusing startup or token consumption with exit code 1 or 500 status), preventing replay attacks resulting from blank or partial state resets.
6. **Transaction-Wide Reservation Locking**: Reservation read/validate/mutate/persist operations hold the shared lock for the complete transaction, not only for the final JSON write. A filesystem lock remains a same-host/shared-volume primitive, not a distributed lock.

### Filesystem vs. Distributed Locking Boundary
> **Architectural Notice:** Filesystem advisory locking coordinates multiple processes on the same host or containers sharing a POSIX-compliant filesystem volume with a shared PID namespace. Filesystem locking is **not** automatically a distributed lock across independent physical hosts, network filesystems without atomic rename semantics (e.g., standard NFS), or decoupled container replicas across cloud availability zones. For multi-host horizontal clustering, StreamPay requires a distributed coordination layer (such as Redis Redlock or PostgreSQL advisory locks).

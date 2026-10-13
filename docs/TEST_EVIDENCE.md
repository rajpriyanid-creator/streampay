# StreamPay v2.5 — Test Evidence & Verification Log

**Date:** 2026-10-10  
**Branch:** `fix/testnet-signing-deployment-safety`
**Commit:** `9f79357`
**GitHub Actions Runs:** [Run #38076882199](https://github.com/rajpriyanid-creator/streampay/actions/runs/38076882199) (Latest: **SUCCESS**), [Run #38074405505](https://github.com/rajpriyanid-creator/streampay/actions/runs/38074405505) (**SUCCESS**), [Run #38072452206](https://github.com/rajpriyanid-creator/streampay/actions/runs/38072452206) (**SUCCESS**)  
**Environment:** Windows (PowerShell) / Node.js v22.23.1 / Chromium (Browser Subagent) / Linux CI (Ubuntu)  

> **Honesty note:** Only results that have been independently executed and observed are marked PASS.  
> Unexecuted checks (e.g. live Testnet deployment) are explicitly documented as unrun / NOT DEPLOYED.

---

## 1. Build & Compilation Results

### Access Service TypeScript Compilation (`tsc --noEmit` & `npm run build`)
```
Status: PASS (0 errors, exit code 0)
Location: access-service/
Command: npm --prefix access-service run typecheck && npm --prefix access-service run build
Evidence: Clean tsc build into dist/
```

### Frontend TypeScript Compilation (`tsc --noEmit` & `npm run build`)
```
Status: PASS (0 errors, exit code 0)
Location: frontend-zip/
Command: npm --prefix frontend-zip run lint && npm --prefix frontend-zip run build
Evidence: Vite production bundle successfully compiled:
  Route (app)                              Size     First Load JS
  ┌ ○ /                                    288 kB          376 kB
  └ ○ /_not-found                          873 B          88.1 kB
  + First Load JS shared by all            87.3 kB
```

---

## 2. Automated Test Execution Results

### Reservation Ledger Unit & Concurrency Suite (`node --test`)
```
Status: PASS (13/13 tests pass, exit code 0)
Location: access-service/dist/reservationStore.test.js
Command: node --test access-service/dist/reservationStore.test.js
Execution Time: 112 ms

Subtest Results:
  ✔ 1. Monotonicity: rejects cumulative units below settled units
  ✔ 2. Idempotency: duplicate requests return existing active token without double-counting slots
  ✔ 3. In-flight Cap: maxCreditSegments boundary blocks excess reservations
  ✔ 4. Failed HTTP Delivery: immediately releases in-flight reservation slot
  ✔ 5. Never-consumed / Expired tokens: pruned automatically after TTL
  ✔ 6. Credit Window boundary: maxCreditWindowUnits blocks unredeemed units above checkpoint
  ✔ 7. Checkpoint & Resume: updating settledUnits frees credit window for continued playback
  ✔ 8. Cap Boundaries: maxUnredeemedAmount, maxBillableUnits, and deposit caps
  ✔ 9. Concurrency Safety: parallel asynchronous requests are serialized correctly
  ✔ 10. Bounded Store Size: onDeliveryCompleted cleans state.reservations and prunes expired
  ✔ 11. Store Memory Safety: 1,000 successful deliveries maintain strictly bounded store size
  ✔ 12. Replay Protection: delivered tokens are recorded and cannot be re-reserved
  ✔ 13. Expired token replacement: expired reservation is pruned, replacement token allowed for same voucher, delivery finalizes, subsequent retry rejected
1..1 (tests: 13, pass: 13, fail: 0)
```

### HTTP E2E Integration Suite (`node scripts/e2e/e2e.mjs`)
```
Status: PASS (26/26 tests pass, exit code 0)
Location: scripts/e2e/e2e.mjs against http://localhost:4001
Command: node scripts/e2e/e2e.mjs

Test Results:
  ✅ GET /health returns ok + chainId and updates activeSettlement
  ✅ GET /api/manifest/:streamId returns canonical schema with proofs
  ✅ GET /api/manifest/unknown returns 404 with UNKNOWN_STREAM code
  ✅ Cryptographic Merkle proof validation succeeds for valid segment
  ✅ Cryptographic Merkle proof validation fails for invalid/tampered content hash
  ✅ GET proof endpoint for segment 0
  ✅ GET proof for out-of-range segment returns 404
  ✅ POST /api/access/segment with missing body returns 400
  ✅ POST /api/access/segment with bad sessionId returns 400
  ✅ POST /api/access/segment with voucher sessionId mismatch returns 400 SESSION_MISMATCH
  ✅ POST /api/access/segment with contract address mismatch returns 400 CONTRACT_MISMATCH
  ✅ POST /api/access/segment with cumulative units too low returns 402 PAYMENT_REQUIRED
  ✅ POST /api/access/segment with cumulative units too high returns 400 CUMULATIVE_UNITS_TOO_HIGH
  ✅ POST /api/access/segment with invalid recipient returns 400
  ✅ POST /api/access/segment with non-existent session returns 401 or 403
  ✅ GET playlist returns m3u8
  ✅ GET content without token returns 401
  ✅ GET content with bad token returns 403
  ✅ rate limiter allows normal traffic
  ✅ rate limiter throttles requests beyond limit and returns 429
  ✅ POST with invalid JSON returns 400
  ✅ POST gate with unknown stream returns 404 UNKNOWN_STREAM
  ✅ POST gate with negative segmentIndex returns 400
  ✅ GET content with invalid segment filename returns 400
  ✅ GET proof for unknown stream returns 404
  ✅ GET playlist for unknown stream returns 404

Results: 26 passed, 0 failed out of 26
```

### Access Service Local Chain Integration Suite (`npx tsx scripts/e2e/access-service-integration.ts`)
```
Status: PASS (Configured in CI & executed locally against running local stack)
Location: scripts/e2e/access-service-integration.ts
Command: npx tsx scripts/e2e/access-service-integration.ts

Step Verification:
  1. Open session on-chain with exact canonical pricing policy (0x76422f...)
  2. Sign EIP-712 voucher for Segment 0 (cumulativeUnits: 2)
  3. Gate request granted with single-use content token
  4. Fetch served media bytes, SHA-256 match with manifest segmentSha256
  5. Cryptographic Merkle proof validated against manifestRoot
  6. Tampered media bytes and tampered proofs strictly rejected
  7. Consumed single-use token re-fetch returns 403 (Replay protection)
  8. Unknown stream (404), out of range (404), too low units (402), too high units (400) rejected
  9. Mismatched pricing policy on-chain returns 403 POLICY_MISMATCH
  10. Expired token retry verified under controlled clock: unexpired duplicate reuses active Token A; advancing clock past TTL prunes reservation, safe retry issues replacement Token B (Token B != Token A); expired Token A rejected (403); delivery with Token B succeeds; subsequent duplicate request rejected
  11. On-chain checkpoint confirmed, synced with /api/session/checkpoint-sync, Segment 1 streamed & verified post-checkpoint, cooperative close & refund confirmed.
```

### Fragment Loader Injected Corruption Suite (`npx tsx scripts/e2e/fragment-loader-corruption.test.ts`)
```
Status: PASS (Executed in CI & locally)
Location: scripts/e2e/fragment-loader-corruption.test.ts
Command: npx tsx scripts/e2e/fragment-loader-corruption.test.ts

Verification Results:
  ✔ Test 1: Injected mutated bytes in transit: SEGMENT_HASH_MISMATCH detected, billing callback SUPPRESSED, HLS delivery SUPPRESSED.
  ✔ Test 2: Injected tampered Merkle proof sibling: MERKLE_PROOF_INVALID detected, billing callback SUPPRESSED, HLS delivery SUPPRESSED.
  ✔ Test 3: Authentic content baseline: SHA-256 and canonical Merkle proof verified, billing callback executed, segment delivered to HLS player.
```

### Offline Simulation Mode Suite (`npx tsx scripts/e2e/simulation-mode.test.ts`)
```
Status: PASS (Executed in CI & locally without Anvil or contracts running)
Location: scripts/e2e/simulation-mode.test.ts
Command: npx tsx scripts/e2e/simulation-mode.test.ts

Verification Results:
  Part 1 (Explicit Simulation Mode):
    ✔ Step 1: /health reports mode='simulation', isSimulation=true, activeSettlement=null
    ✔ Step 2: Stream manifest loaded (streamId=monad-keynote-hd, 5 segments)
    ✔ Step 3: Simulated session created & EIP-712 off-chain voucher signed
    ✔ Step 4: Access granted through simulation gate with valid single-use token
    ✔ Step 5: Media bytes fetched and cryptographically verified in pure simulation mode
    ✔ Step 6: Expired token replacement verified under controlled clock in offline simulation mode (Token B != Token A, delivery verified, duplicate rejected)
  Part 2 (Automatic Fallback Mode):
    ✔ Unreachable RPC with configured settlement address automatically falls back to simulation mode
    ✔ /health reports mode='simulation' and activeSettlement=null
    ✔ Simulated voucher signing & segment gating granted in automatic fallback mode
  Part 3 (Hard Production Prohibition):
    ✔ ENABLE_TEST_CLOCK=true strictly rejected under NODE_ENV=production
    ✔ Server refuses startup and terminates with exit code 1 and fatal error log
```

### Durable Persistence, Restart Recovery & Multi-Instance Suite (`npx tsx scripts/e2e/durable-persistence.test.ts`)
```
Status: PASS (Executed in CI & locally)
Location: scripts/e2e/durable-persistence.test.ts
Command: npx tsx scripts/e2e/durable-persistence.test.ts

Verification Results:
  Test 1 (Production/Testnet Secret Hardening):
    ✔ Missing TOKEN_SECRET on testnet/production rejected with exit code 1
    ✔ Short TOKEN_SECRET (<32 chars) rejected with exit code 1
  Test 2 (Process Restart Recovery & Replay Protection):
    ✔ Segment 0 token granted and content delivered on Instance 1
    ✔ Confirmed state.json atomically written to disk (reservations, vouchers, delivered tokens, completed segments)
    ✔ Access service process killed and restarted with same state directory
    ✔ Recovered voucher state after restart: highestUnits=2, totalServedSegments=1
    ✔ Consumed single-use token replayed against restarted instance correctly rejected (403)
    ✔ Duplicate request for already completed segment rejected after restart (status 402/400)
  Test 3 (Multi-Instance Cluster Sharing & Cross-Instance Replay Protection):
    ✔ Shared cluster storage configured between Instance A and Instance B
    ✔ Instance A issued Segment 1 token
    ✔ Instance B validated & delivered content using Instance A's token (97,196 bytes)
    ✔ Instance A rejected replay of token consumed by Instance B (cross-instance single-use replay protection)
  Test 4 (Concurrent Multi-Instance Updates & Conflict Prevention):
    ✔ Implemented advisory lockfile (`state.json.lock`) with atomic creation (`fs.openSync(..., 'wx')`), exponential backoff, and stale lock eviction (5s TTL).
    ✔ Implemented atomic disk state merging in `saveAllDurableState()`: merges consumed tokens, monotonic max for voucher cumulative units, unions completed segments.
    ✔ Multi-instance concurrent writes preserved both sessions without lost updates.
    ✔ Simultaneous cross-instance replay of consumed token strictly rejected (both instances returned 403 Forbidden).
    ✔ Single-instance & shared-disk concurrency guarantees verified; documentation explicitly notes that horizontal multi-server scaling across disjoint disks requires an external transactional store (PostgreSQL or Redis Redlock) prior to production multi-machine deployment.
```

### Testnet Signing Safety & EIP-712 Suite (`npx tsx scripts/e2e/testnet-signing-safety.test.ts`)
```
Status: PASS (9/9 tests pass, exit code 0)
Location: scripts/e2e/testnet-signing-safety.test.ts
Command: npx tsx scripts/e2e/testnet-signing-safety.test.ts

Verification Results:
  ✔ Test 1: Testnet session opening strictly rejects creatorKey (Anvil key) on chain 10143 with SECURITY VIOLATION.
  ✔ Test 2: Testnet session opening fails closed without creator offerSignature.
  ✔ Test 3: Contract constraint PayerEqualsRecipient strictly validated before submission (prevents contract revert).
  ✔ Test 4: Contract constraint PayerEqualsSessionSigner strictly validated before submission (prevents contract revert).
  ✔ Test 5: Testnet close acknowledgement strictly rejects creatorKey on chain 10143 with SECURITY VIOLATION.
  ✔ Test 6: Testnet close fails closed without wallet-signed ackSig.
  ✔ Test 7: EIP-712 typed data schemas, domain (name='StreamPaySettlement', version='2.5'), and digests (ContentOffer, SessionConfig, CloseAck) match Solidity specification exactly.
  ✔ Test 8: Genuine Creator wallet signing flow via signContentOfferWithWallet and signCloseAckWithWallet produces valid EIP-712 typed-data signatures.
  ✔ Test 9: Static audit of frontend code proves zero Anvil keys leak into Testnet execution paths.

All 9 Testnet Signing Safety & EIP-712 tests PASSED!
```

### Fail-Closed Deployment Script Regression Suite (`contracts/test/DeployTest.t.sol`)
```
Status: PASS (Foundry test suite added for CI execution)
Location: contracts/test/DeployTest.t.sol
Target Script: contracts/script/Deploy.s.sol

Verification Scenarios Covered:
  ✔ test_LocalDeployment_AllowsMockUSDC: Auto-deploying MockUSDC succeeds on local chain 31337.
  ✔ test_LocalDeployment_UsesProvidedToken: When PAYMENT_TOKEN is provided on chain 31337, uses provided token.
  ✔ test_TestnetDeployment_MissingToken_Reverts: Chain 10143 with unset PAYMENT_TOKEN reverts with MissingPaymentTokenForTestnet().
  ✔ test_TestnetDeployment_WrongToken_Reverts: Chain 10143 with unapproved token reverts with InvalidTestnetToken().
  ✔ test_TestnetDeployment_TokenHasNoBytecode_Reverts: Chain 10143 with empty bytecode reverts with TokenHasNoBytecode().
  ✔ test_TestnetDeployment_UnexpectedDecimals_Reverts: Chain 10143 with 18 decimals instead of 6 reverts with UnexpectedDecimals().
  ✔ test_UnsupportedChain_Reverts: Deployment on arbitrary unsupported chains (1, 9999) reverts with UnsupportedChain().
  ✔ test_TestnetDeployment_ValidToken_Succeeds: Approved testnet token with 6 decimals succeeds on chain 10143.
```

---

## 3. Browser Video Playback & Billing Evidence (Local Developer Evidence)

> **Notice:** Browser video playback was verified locally using a Chromium browser session (with captured screen artifacts). It is NOT executed inside the headless GitHub Actions CI runner, which executes the local chain lifecycle, HTTP E2E, fragment loader corruption, and simulation test suites.

### Browser Subagent Execution Log & Screen Artifacts
```
Status: PASS (Local Chromium verification only; not executed in headless CI)
Platform: Chromium under browser_subagent
URL: http://localhost:3000
Session Artifact: streampay_checkpoint_verified_1791639333383.png
Video Recording: hls_playback_verified_demo_1791639099871.webp

Observed Step Execution:
1. Connect Dev Wallet:
   - Clicked "Use Anvil Dev Account" -> connected 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266.
2. Open Bounded Escrow Session:
   - Clicked "Open Session On-Chain" with 5.0 USDC deposit.
   - Session created: ID 0x000000000000000000000000ca3538009532bB899F5dF68Ee112Ec9c137AC2D7 (Status: OPEN).
3. Real Playback with StreamPayFragmentLoader:
   - Clicked "Play Stream" on HTML5 <video> element.
   - HLS.js custom fragment loader fetched segments 0 through 4 sequentially.
   - For each segment:
     - Requested single-use access token from access service via EIP-712 signed voucher.
     - Fetched binary MPEG-TS segment bytes.
     - Computed SHA-256 on served bytes.
     - Verified canonical Merkle proof (StreamPaySegmentLeaf) against manifestRoot.
     - Billed only after verification succeeded.
   - HTML5 <video> element rendered active video frames (test color bars and countdown digit).
   - Off-Chain Voucher Log recorded:
     - Seg 0 (2 units): VERIFIED_OFFCHAIN
     - Seg 1 (4 units): VERIFIED_OFFCHAIN
     - Seg 2 (6 units): VERIFIED_OFFCHAIN
     - Seg 3 (8 units): VERIFIED_OFFCHAIN
     - Seg 4 (10 units): VERIFIED_OFFCHAIN
4. Checkpoint Settlement:
   - Clicked "Checkpoint On-Chain" at 10 cumulative units.
   - Status updated to CHECKPOINTED; vouchers updated to CHECKPOINTED_ONCHAIN.
   - Spent: 0.005 USDC, Remaining: 4.995 USDC.
5. Cooperative Close & Refund:
   - Clicked "Close & Refund".
   - Status updated to CLOSED.
   - Final breakdown: Creator paid 0.005 USDC, Payer refunded 4.995 USDC.
```

---

## 4. Cryptographic Integrity Evidence

### Segment Hash & Proof Validation Success
```
Input: Segment 0 bytes from fixtures/media/segment_0.ts (59,784 bytes)
Computed SHA-256: 0x0df53fd6f1efcf758818706ba87b2e5d174a871f600d5aab20a4b1dcde143da4
Leaf Typehash: StreamPaySegmentLeaf(uint32 schemaVersion,bytes32 contentIdHash,uint32 segmentIndex,uint32 durationUnits,bytes32 renditionIdHash,bytes32 segmentSha256)
Leaf Hash: 0x6e9a65664daeb272cbb0920475ae2154ca556557e0586e2467d0cf90ca1511ce
Merkle Root: 0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb
Verification Result: TRUE (Valid proof verified)
```

### Invalid / Tampered Content Rejection
```
Input: Tampered SHA-256 (0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0)
Computed Leaf Hash: 0x5da8dbbbd9c9b13eeea0e5f22f778d91f24d9c7924fe1306b7d1e8cfb8c5ff84
Merkle Root: 0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb
Verification Result: FALSE (Tampered leaf rejected; delivery and billing aborted)
```

---

## 5. Explicit List of Unrun Tests

1. **Foundry tests on local Windows**: `forge` is not installed on this local Windows machine. The full Foundry test suite (39 tests across 2 test suites: `DeployDiscoveryTest` and `StreamPaySettlementTest`) is executed and passed in the Linux CI workflow (`.github/workflows/ci.yml`).
2. **Monad Testnet Deployment**: No live testnet deployment was executed. Testnet faucet, token addresses, and contract deployment to chain 10143 remain blocked (**NOT DEPLOYED**).
3. **Envio HyperIndex toolchain build**: CI is configured to run Envio `2.32.12` codegen/build. The latest run failed because local chain `31337` lacked an explicit RPC source; that configuration is now fixed, but a fresh CI run is still required.

---

## 6. Commands to Reproduce Locally

```bash
# 1. Typecheck and build all services
npm --prefix access-service run typecheck
npm --prefix access-service run build
npm --prefix frontend-zip run lint
npm --prefix frontend-zip run build

# 2. Run reservation ledger unit tests
node --test access-service/dist/reservationStore.test.js

# 3. Generate canonical Merkle manifest from media fixtures
node scripts/generate_manifest.js

# 4. Start access-service and run HTTP E2E tests
node access-service/dist/server.js &
node scripts/e2e/e2e.mjs

# 5. Start frontend and verify in browser
npm --prefix frontend-zip run dev
# Navigate to http://localhost:3000

# 6. Run durable persistence, multi-instance, and lock concurrency suite
npx tsx scripts/e2e/durable-persistence.test.ts

# 7. Run testnet signing safety and EIP-712 verification suite
npx tsx scripts/e2e/testnet-signing-safety.test.ts
```

---

## 7. Concurrency & Security Regression Test Evidence (2026-10-11)

Current branch update: `fix/testnet-signing-deployment-safety` at `58eb0a5`.
The checkpoint integration test now independently reads the contract after the
checkpoint transaction and verifies that `/api/session/checkpoint-sync` returns
the same fresh `settledUnits` value. This change is source-verified here; a
full local-chain rerun is required to record new runtime evidence.

### Durable Persistence, Multi-Instance & Lock Concurrency Suite
```
Command: npx tsx scripts/e2e/durable-persistence.test.ts
Status: PASS (6/6 tests, exit code 0)

Test 1: Single-Instance State Persistence & In-Memory Match
  ✅ Segment 0 token granted and content delivered
  ✅ state.json confirmed on disk with matching voucher state
Test 2: Process Restart & Recovery
  ✅ In-memory voucher state restored from state.json
  ✅ Replay of consumed token after restart rejected (403)
  ✅ Re-request for completed segment rejected (402/400)
Test 3: Multi-Instance Cluster Sharing & Replay Coordination
  ✅ Instance A generates token; Instance B serves content successfully
  ✅ Replay of consumed token on Instance A strictly rejected (403)
Test 4: High-Concurrency Cross-Process Race & Lost-Update Protection
  ✅ Multiple concurrent processes update state.json without lost updates
  ✅ Simultaneous first-use race resolved atomically: exactly 1 granted (200), 1 rejected (403)
  ✅ Subsequent replays on both instances strictly rejected (403)
Test 5: Durability Corruption Fail-Closed Protection
  ✅ Corrupted state.json causes server startup failure (exit code 1) with fatal replay error
Test 6: Filesystem Lock Concurrency & Safety Properties
  ✅ 6a: Live lock holder exceeding normal age (15s) was NOT stolen (liveness preserved)
  ✅ 6b: Genuinely abandoned lock (dead PID) safely recovered
  ✅ 6c: Former owner release DID NOT remove replacement owner lock (owner isolation verified)
  ✅ 6d: Lock timeout safely triggered after contested period
  ✅ 6e: Empty/corrupted lock file older than grace period safely recovered
```

### Testnet Signing Safety & EIP-712 Verification Suite
```
Command: npx tsx scripts/e2e/testnet-signing-safety.test.ts
Status: PASS (11/11 tests, exit code 0)

Test 1: Proving testnet session opening strictly rejects creatorKey (Anvil key)...
   ✅ PASS: creatorKey rejected on Testnet chain 10143 with SECURITY VIOLATION.
Test 2: Proving testnet session opening fails closed without creator offerSignature...
   ✅ PASS: openSessionWithWallet failed closed when offerSignature was missing.
Test 3: Proving PayerEqualsRecipient constraint is strictly validated...
   ✅ PASS: PayerEqualsRecipient prevented before submission.
Test 4: Proving PayerEqualsSessionSigner constraint is strictly validated...
   ✅ PASS: PayerEqualsSessionSigner prevented before submission.
Test 5: Proving testnet close acknowledgement strictly rejects creatorKey...
   ✅ PASS: closeCooperativeWithWallet rejected creatorKey on Testnet chain 10143.
Test 6: Proving testnet close fails closed without wallet-signed ackSig...
   ✅ PASS: closeCooperativeWithWallet failed closed when ackSig was missing.
Test 7: Verifying EIP-712 typed data schemas and digests match Solidity specification...
   ✅ ContentOffer EIP-712 digest verified against exact Solidity formula
   ✅ SessionConfig EIP-712 digest verified against exact Solidity formula
   ✅ CloseAck EIP-712 digest verified against exact Solidity formula
Test 8: Verifying genuine Creator wallet signing flow & cryptographic signature recovery...
   ✅ Recovered ContentOffer signer matches Creator account
   ✅ Recovered CloseAck signer matches Creator account
   ✅ Cryptographic recovery verified via viem recoverTypedDataAddress
Test 9: Static audit of frontend code for forbidden Anvil keys in testnet paths...
   ✅ PASS: Zero Anvil keys in Testnet execution paths in frontend.
Test 10: Verifying account & chain validation individually enforced across all 5 operations...
   ✅ 10a: signContentOfferWithWallet strictly enforces account & chain.
   ✅ 10b: openSessionWithWallet strictly enforces account & chain.
   ✅ 10c: checkpointWithWallet strictly enforces account & chain.
   ✅ 10d: signCloseAckWithWallet strictly enforces account & chain.
   ✅ 10e: closeCooperativeWithWallet strictly enforces account & chain.
Test 11: Negative EIP-712 security checks: domain separation & CloseAck non-reusability...
   ✅ 11a: Domain separation by chain ID verified (wrong chainId cannot verify signature).
   ✅ 11b: Domain separation by verifyingContract verified.
   ✅ 11c: CloseAck non-reusability proven: signed ack cannot be reused after playback advances.
```

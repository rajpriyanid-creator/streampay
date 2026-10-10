# StreamPay v2.5 — Test Evidence & Verification Log

**Date:** 2026-10-10  
**Commit:** Fix authoritative session binding, credit ledger, Merkle proofs & real HLS playback  
**Environment:** Windows (PowerShell) / Node.js v22.23.1 / Chromium (Browser Subagent)  

> **Honesty note:** Only results that have been independently executed and observed are marked PASS.  
> Unexecuted checks (e.g. Foundry on Windows, live Testnet deployment) are explicitly documented as unrun.

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
Location: frontend/
Command: npm --prefix frontend run typecheck && npm --prefix frontend run build
Evidence: Next.js 14.2 production bundle successfully compiled, linted, and static routes generated:
  Route (app)                              Size     First Load JS
  ┌ ○ /                                    288 kB          376 kB
  └ ○ /_not-found                          873 B          88.1 kB
  + First Load JS shared by all            87.3 kB
```

---

## 2. Automated Test Execution Results

### Reservation Ledger Unit & Concurrency Suite (`node --test`)
```
Status: PASS (12/12 tests pass, exit code 0)
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
1..1 (tests: 12, pass: 12, fail: 0)
```

### HTTP E2E Integration Suite (`node scripts/e2e/e2e.mjs`)
```
Status: PASS (25/25 tests pass, exit code 0)
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
  ✅ POST with invalid JSON returns 400
  ✅ POST gate with unknown stream returns 404 UNKNOWN_STREAM
  ✅ POST gate with negative segmentIndex returns 400
  ✅ GET content with invalid segment filename returns 400
  ✅ GET proof for unknown stream returns 404
  ✅ GET playlist for unknown stream returns 404

Results: 25 passed, 0 failed out of 25
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
  10. On-chain checkpoint confirmed, synced with /api/session/checkpoint-sync, Segment 1 streamed & verified post-checkpoint, cooperative close & refund confirmed.
```

---

## 3. Browser E2E Video Playback & Billing Evidence

### Browser Subagent Execution Log & Screen Artifacts
```
Status: PASS (Real HLS Video Frame Playback & Gated Billing Confirmed)
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

1. **Foundry tests on Windows**: `forge` is not installed on this local Windows environment. The contract test suite (37 tests) is executed in the Linux CI workflow (`.github/workflows/ci.yml`).
2. **Monad Testnet Deployment**: No live testnet deployment was executed. Testnet faucet, token addresses, and contract deployment to chain 10143 remain blocked.
3. **Envio HyperIndex toolchain**: Envio CLI was not executed locally; it is isolated in a visibly separate CI job.

---

## 6. Commands to Reproduce Locally

```bash
# 1. Typecheck and build all services
npm --prefix access-service run typecheck
npm --prefix access-service run build
npm --prefix frontend run typecheck
npm --prefix frontend run build

# 2. Run reservation ledger unit tests
node --test access-service/dist/reservationStore.test.js

# 3. Generate canonical Merkle manifest from media fixtures
node scripts/generate_manifest.js

# 4. Start access-service and run HTTP E2E tests
node access-service/dist/server.js &
node scripts/e2e/e2e.mjs

# 5. Start frontend and verify in browser
npm --prefix frontend run dev
# Navigate to http://localhost:3000
```

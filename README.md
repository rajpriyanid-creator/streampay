# StreamPay — Monad Pay-Per-Second Video Streaming Protocol (v2.5)

[![CI](https://github.com/rajpriyanid-creator/streampay/actions/workflows/ci.yml/badge.svg)](https://github.com/rajpriyanid-creator/streampay/actions/workflows/ci.yml)
[![Foundry Tests](https://img.shields.io/badge/Foundry%20Tests-47%20Passed-brightgreen)](contracts/test/StreamPaySettlement.t.sol)
[![Ledger Tests](https://img.shields.io/badge/Ledger%20Tests-13%20Passed-brightgreen)](access-service/src/reservationStore.test.ts)
[![HTTP E2E](https://img.shields.io/badge/HTTP%20E2E-26%20Passed-brightgreen)](scripts/e2e/e2e.mjs)
[![Signing Safety](https://img.shields.io/badge/Signing%20Safety-11%20Passed-brightgreen)](scripts/e2e/testnet-signing-safety.test.ts)
[![Network](https://img.shields.io/badge/Network-Monad%20Testnet%20(10143)-836EF9)](https://testnet-rpc.monad.xyz)
[![Payment Token](https://img.shields.io/badge/Token-USDC%20(6%20Decimals)-2775CA)](https://testnet.monadvision.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3)

> **One-Line Pitch:** StreamPay is a sub-cent, pay-per-second media streaming protocol built on Monad, combining off-chain EIP-712 micro-vouchers with SHA-256 Merkle proofs for zero-trust content verification and instant micro-settlement.

---

### 🏆 Monad "Metropolis" Hackathon Submission Details

- **Primary Track:** `Track 02 — Consumer Products & Payments` ($30,000 USD Track Pool)
  > *"Products whose primary user is a consumer who may not identify as a crypto user, and whose core value is a financial experience rather than a trading or market making product (e.g., second-by-second streaming subscriptions with seamless, invisible on-chain rails)."*
- **Sponsor Bounties:**
  - `Best Use of Dynamic` ($5,000 USD) — Native Dynamic React SDK embedded auth & EVM wallet sessions (`@dynamic-labs/sdk-react-core`, `@dynamic-labs/ethereum`) providing zero-friction email/social/wallet onboarding.
  - `Best Use of Envio` ($1,000 USD + $5,000 Cloud Hosting) — Production Envio HyperIndex configuration (`indexer/config.testnet.yaml`) and real-time frontend telemetry client (`frontend-zip/src/lib/envioClient.ts`) tracking live settlement events from block `70464119`.
  - `Best Community Team Project` ($5,000 USD) — Open-source community project advancing consumer micro-payments on Monad.
- **Official Hackathon Dossier:** Detailed track fit, bounty alignment, and rubric self-assessment in [`docs/HACKATHON.md`](docs/HACKATHON.md).

---

### 🌐 Live Public Deployments & Verified On-Chain Artifacts

- **Live Web Player:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com) (Deployed via Render Blueprint from `frontend-zip/`)
- **Live Access Service:** [https://streampay-access-service.onrender.com/health](https://streampay-access-service.onrender.com/health) (Reports `status: ok`, `activeMode: onchain`, `chainId: 10143`)
- **Settlement Contract:** [`0x3E016fa87f7149971F65Df413b667C5355c5B060`](https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060) on Monad Testnet (Chain ID `10143`)
- **Deployment Transaction:** [`0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`](https://testnet.monadscan.com/tx/0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d), Block `70464119`
- **Official Payment Token:** [`0x534b2f3A21130d7a60830c2Df862319e593943A3`](https://testnet.monadvision.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3) (Official Monad Testnet USDC, 6 Decimals)

---

## ⚡ Why Monad?

Real-time video streaming micro-payments are economically and computationally impossible on legacy chains:
- **Ethereum L1:** Gas fees of $2–$10 and 12-second block times make second-by-second micro-payments completely unfeasible.
- **Traditional Rollups:** Sequencer bottlenecks and multi-second confirmation times cannot scale to hundreds of thousands of concurrent video viewers streaming simultaneous 2-second segments.

### How StreamPay Leverages Monad's Architecture:
1. **10,000 TPS & MonadBFT 1-Second Finality:** Viewers open and close streaming channels with sub-second confirmation. Creators checkpoint accumulated revenue instantly on-chain without waiting minutes for finality.
2. **Parallel Execution Engine:** High concurrent volume from thousands of viewers checkpointing their independent streaming sessions runs in parallel without state lock contention.
3. **Sub-Cent Micro-Transactions:** Monad's low gas costs make bounded escrow checkpoints and cooperative session closeouts economically viable even for small $0.50–$2.00 streaming sessions.

---

## 📊 Subscription vs. Pay-Per-Second Comparison

Traditional streaming platforms force consumers into predatory monthly recurring subscriptions regardless of actual consumption. StreamPay aligns pricing directly with consumption.

| Model | Monthly Cost | 4 Hours Consumed | 10-Minute Video | 1-Minute Tutorial | Unused Escrow |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Traditional Subscription** | **$22.99 / mo** | $22.99 ($5.75/hr) | $22.99 | $22.99 | Sunk cost (Lost forever) |
| **StreamPay (Pay-Per-Second)** | **$0.00 / mo** | **$7.20** ($1.80/hr) | **$0.30** | **$0.03** | **100% Refunded Instantly** |

### Real-World Cost Example:
- **Rate:** 500 base units per second ($0.0005 USDC/sec = $1.80/hour).
- **Session:** User deposits 2.50 USDC into bounded escrow.
- **Playback:** User watches an 8-minute tutorial (480 seconds).
  - Total Billed: `480s × $0.0005 = $0.24 USDC`.
  - Gas During Streaming: **$0.00 (Zero Gas)** via off-chain EIP-712 vouchers.
- **Closure:** User pauses and closes the session.
  - Creator Receives: **$0.24 USDC**.
  - Payer Refunded: **$2.26 USDC** returned immediately to user wallet.
  - Total Savings vs. $15 Monthly Paywall: **$14.76 saved (98.4%)**.

---

## 🛡️ Zero-Trust Cryptographic Media Delivery

StreamPay guarantees that **no viewer ever pays for corrupted, altered, or injected media**.

### Leaf Hashing Formula:
Every video segment downloaded must be mathematically validated before rendering:
```solidity
leaf = keccak256(
    abi.encodePacked(
        uint32(segmentIndex),
        uint64(durationUnits),
        bytes32(contentIdHash),
        bytes32(renditionIdHash),
        bytes32(segmentSha256)
    )
);
```

### Try the Automated Cryptographic Failure Demo:
```bash
npx tsx scripts/failure-demo.ts
```
- **Scenario 1 (Authentic):** Segment byte SHA-256 matches manifest leaf and on-chain Merkle root. Media is decrypted/decoded, and a micro-voucher is released.
- **Scenario 2 (Byte Tamper):** Injects a 1-byte mutation into media transit. Client instantly detects mismatch (`SEGMENT_HASH_MISMATCH`), halts decoder, and bills **$0.00**.
- **Scenario 3 (Forged Proof):** Injects tampered Merkle proof. Mathematical derivation fails against root, and delivery is aborted.

---

## 🧭 Judging Criteria Mapping

| Hackathon Criterion | How StreamPay Meets It | File / Evidence Link |
| :--- | :--- | :--- |
| **1. Product Quality & Completeness (20%)** | Instant video playback, zero-gas streaming, cooperative close, instant escrow refund, simulation mode, and responsive 3-column UI with pinned navigation. | [`frontend-zip/src/App.tsx`](frontend-zip/src/App.tsx)<br>[`frontend-zip/src/components/Sidebar.tsx`](frontend-zip/src/components/Sidebar.tsx)<br>[`frontend-zip/src/components/PaymentsView.tsx`](frontend-zip/src/components/PaymentsView.tsx) |
| **2. Technical Excellence (20%)** | OpenZeppelin v5.0 bounded escrow (`ReentrancyGuard`, `Ownable2Step`, `SafeERC20`, EIP-712), replay bitmaps, single-use HMAC tokens, and SHA-256 + Merkle leaf verification. | [`contracts/src/StreamPaySettlement.sol`](contracts/src/StreamPaySettlement.sol)<br>[`access-service/src/server.ts`](access-service/src/server.ts)<br>[`scripts/e2e/durable-persistence.test.ts`](scripts/e2e/durable-persistence.test.ts) |
| **3. Monad Integration (20%)** | Deployed contract on Monad Testnet (`0x3E016fa8...`), official USDC allowlist (`0x534b2f3A...`), Envio HyperIndex telemetry, and 1-second finality micro-settlement. | [`contracts/script/Deploy.s.sol`](contracts/script/Deploy.s.sol)<br>[`indexer/config.testnet.yaml`](indexer/config.testnet.yaml)<br>[`docs/TESTNET_EVIDENCE.md`](docs/TESTNET_EVIDENCE.md) |
| **4. Track Fit & Problem Relevance (20%)** | Benchmark Track 02 Consumer Product: eliminates predatory monthly subscriptions with second-by-second micro-metering and invisible crypto UX via Dynamic SDK. | [`frontend-zip/src/components/Header.tsx`](frontend-zip/src/components/Header.tsx)<br>[`docs/SUBMISSION.md`](docs/SUBMISSION.md) |
| **5. Innovation & Impact (20%)** | Hybrid zero-trust streaming architecture: viewers verify cryptographic segment proofs before issuing payment vouchers, aligning incentives between creators, CDNs, and viewers. | [`scripts/failure-demo.ts`](scripts/failure-demo.ts)<br>[`docs/PROTOCOL.md`](docs/PROTOCOL.md) |

---

## 🚀 Quick Start (Try It in 2 Minutes)

### Option A: Simulation Mode (Instant — No wallet or chain funds required)
Runs Access Gateway and Frontend UI in pure simulation mode:
```bash
npm run quickstart:sim
```
- Open `http://localhost:3000` in your browser.
- Stream video immediately with simulated micro-vouchers!

### Option B: Monad Testnet Mode (Live Network)
Runs Access Gateway and Frontend UI connected directly to Monad Testnet (Chain ID 10143):
```bash
npm run quickstart:testnet
```
- Open `http://localhost:3000` in your browser.
- Connect MetaMask or Dynamic embedded wallet to Monad Testnet (`https://testnet-rpc.monad.xyz`).

---

## 🧪 Comprehensive Verification Suite

Execute the complete test suite locally:

```bash
# 1. Smart Contract Tests (47 tests across 3 suites)
cd contracts && forge test -vvv && cd ..

# 2. Reservation Ledger Concurrency & Leak Tests (13 tests)
node --test access-service/dist/reservationStore.test.js

# 3. HTTP Gateway & Security E2E Suite (26 tests)
node scripts/e2e/e2e.mjs

# 4. Frontend Typecheck & Unit Tests (0 errors, 3 passed)
npm --prefix frontend-zip test

# 5. On-Chain Complete Lifecycle Test
npx tsx scripts/e2e/lifecycle-test.ts

# 6. Offline Simulation Mode Suite
npx tsx scripts/e2e/simulation-mode.test.ts

# 7. Durable Persistence & Concurrency Suite (6 tests)
npx tsx scripts/e2e/durable-persistence.test.ts

# 8. Testnet Signing Safety & EIP-712 Suite (11 tests)
npx tsx scripts/e2e/testnet-signing-safety.test.ts

# 9. Cryptographic Tamper Demo Suite
npx tsx scripts/failure-demo.ts
```

---

## 🏗️ Production Architecture & Scaling Roadmap

StreamPay is engineered with a modular separation between settlement, content verification, and state coordination:

```
┌────────────────────────────────────────────────────────┐
│                   Viewer Web Client                    │
│   (Vite/React + Dynamic Auth + HLS.js Fragment Loader) │
└──────────┬─────────────────────────────┬───────────────┘
           │ 1. Signs EIP-712 Voucher    │ 2. Downloads Media Segment
           ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│       Access Service      │ │        Media CDN /        │
│  (Node.js / Express API)  │ │     HLS Origin Storage    │
└──────────┬────────────────┘ └──────────┬────────────────┘
           │ 3. Verifies Reservation     │ 4. Validates SHA-256
           │    & Issues Token           │    & Merkle Leaf Proof
           ▼                             ▼
┌────────────────────────────────────────────────────────┐
│          Monad Testnet Settlement Contract             │
│      (StreamPaySettlement.sol - Bounded Escrow)        │
└──────────────────────────┬─────────────────────────────┘
                           │ 5. Indexes On-Chain Events
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Envio HyperIndex                     │
│         (Real-time GraphQL Event Telemetry)            │
└────────────────────────────────────────────────────────┘
```

### Production Scaling Roadmap:
1. **Multi-Region Cluster Coordination:** Transition local filesystem reservation locks to a distributed Redis Redlock / DynamoDB conditional-write layer for multi-region active-active deployments.
2. **Edge Worker Verification:** Offload segment token verification to Cloudflare Workers / Fastly Compute@Edge using Ed25519 JWT verification for sub-10ms global edge delivery.
3. **Live RTMP/HLS Transcoding Pipeline:** Automated FFmpeg worker service to ingest live RTMP streams, generate 2-second HLS segments, calculate rolling Merkle roots, and update on-chain policy roots dynamically.

---

## 📚 External Libraries & Attribution (Section 4.1.1 Compliance)

| Component / Library | Source / Author | License | Usage in StreamPay |
| :--- | :--- | :--- | :--- |
| **OpenZeppelin Contracts v5.0** | OpenZeppelin | MIT | `ReentrancyGuard`, `Ownable2Step`, `SafeERC20`, EIP-712 structured data hashing in `StreamPaySettlement.sol`. |
| **Dynamic SDK** | Dynamic Labs | Proprietary / Apache 2.0 | `@dynamic-labs/sdk-react-core` & `@dynamic-labs/ethereum` for embedded wallet onboarding & EVM authentication. |
| **Envio HyperIndex** | Envio | Apache 2.0 | Real-time event indexing configuration (`config.testnet.yaml`) and HyperSync telemetry client. |
| **Viem & Ox** | Wevm | MIT | Typed EIP-712 signing, Merkle proof hashing, contract ABI encoding, and RPC client connectivity. |
| **HLS.js** | Dailymotion | Apache 2.0 | Media decoding engine with custom `StreamPayFragmentLoader` for cryptographic segment inspection. |
| **Lucide Icons** | Lucide Contributors | ISC | Modern UI iconography across dashboard, player, and inspector modals. |

---

## 🤖 AI Coding Tools Disclosure (Section 4.1.4 Compliance)

In accordance with Section 4.1.4 of the Metropolis Hackathon Rules & Guidelines, AI coding assistance tools (including Gemini, Antigravity, and Claude) were utilized as engineering aids during the hackathon build window for:
- Writing automated regression test suites and fuzzing harnesses;
- Assisting with TypeScript strict-type alignment and lint resolution;
- Generating documentation, flowcharts, and verification matrices.

All smart contract logic, architectural designs, security constraints, and deployment credentials were fully reviewed, verified, deployed, and tested by the project author.

---

## 📁 Repository Documentation Index

- [`docs/HACKATHON.md`](docs/HACKATHON.md) — Comprehensive Metropolis Hackathon dossier, track alignment, and rubric self-assessment.
- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) — Copy-paste hackathon submission text and form answers.
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — 3-minute video presentation script with exact timestamps.
- [`docs/TESTNET_EVIDENCE.md`](docs/TESTNET_EVIDENCE.md) — Real on-chain transaction hashes, block numbers, and negative security outputs.
- [`docs/SECURITY.md`](docs/SECURITY.md) — Threat model, race-safe locking, and defense-in-depth architecture.
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — Deep dive into EIP-712 vouchers, Merkle proofs, and settlement states.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Render Blueprint configuration and live verification guide.
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — Comprehensive environment variables and configuration reference.

---

## ⚖️ License
MIT License. Created for the Monad "Metropolis" Hackathon.

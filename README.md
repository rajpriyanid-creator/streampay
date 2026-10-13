# StreamPay — Monad Pay-Per-Second Video Streaming Protocol (v2.5)

[![CI](https://github.com/rajpriyanid-creator/streampay/actions/workflows/ci.yml/badge.svg)](https://github.com/rajpriyanid-creator/streampay/actions/workflows/ci.yml)
[![Foundry Tests](https://img.shields.io/badge/Foundry%20Tests-47%20Passed-brightgreen)](contracts/test/StreamPaySettlement.t.sol)
[![Ledger Tests](https://img.shields.io/badge/Ledger%20Tests-13%20Passed-brightgreen)](access-service/src/reservationStore.test.ts)
[![HTTP E2E](https://img.shields.io/badge/HTTP%20E2E-26%20Passed-brightgreen)](scripts/e2e/e2e.mjs)
[![Network](https://img.shields.io/badge/Network-Monad%20Testnet%20(10143)-836EF9)](https://testnet-rpc.monad.xyz)
[![Payment Token](https://img.shields.io/badge/Token-USDC%20(6%20Decimals)-2775CA)](https://testnet.monadvision.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3)

> **One-Line Pitch:** StreamPay is a sub-cent, pay-per-second media streaming protocol built on Monad, combining off-chain EIP-712 micro-vouchers with SHA-256 Merkle proofs for zero-trust content verification and instant micro-settlement.

- **Hackathon Track:** `02 Consumer Products & Payments` (Monad "Metropolis" Hackathon)
- **Live Contract:** [`0x3E016fa87f7149971F65Df413b667C5355c5B060`](https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060) on Monad Testnet.
- **Deployment transaction:** [`0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`](https://testnet.monadscan.com/tx/0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d), block `70464119`.
- **Payment Token:** [`0x534b2f3A21130d7a60830c2Df862319e593943A3`](https://testnet.monadvision.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3) (Official Monad Testnet USDC)
- Demo video: coming (link added before deadline)
- Live demo: coming (link added before deadline)
- **Audit Status:** *Testnet only, not audited.* See [Known Limitations](docs/KNOWN_LIMITATIONS.md).

## 🌐 Public Deployment

The active web app is the Vite application in `frontend-zip/`; the retired Next.js `frontend/` directory is not the deployment target. For Vercel, import this repository and set **Root Directory** to `frontend-zip`, **Framework Preset** to Vite, **Build Command** to `npm run build`, and **Output Directory** to `dist`.

Required Vercel variables:

```text
VITE_NETWORK=testnet
VITE_STREAM_SIMULATION=false
VITE_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
VITE_SETTLEMENT_ADDRESS=0x3E016fa87f7149971F65Df413b667C5355c5B060
VITE_ACCESS_SERVICE_URL=https://<public-access-service-host>
```

The Access Service is a separate Node/Express process and must be hosted at a public HTTPS URL; Vercel hosts the static frontend only. Set its `CORS_ORIGIN` to the deployed Vercel origin and configure `NETWORK=monad-testnet`, `RPC_URL`, and `SETTLEMENT_ADDRESS`. Do not enable simulation mode for the live deployment.

## AI Disclosure

Codex was used as an engineering assistant for code inspection, implementation support, test execution, documentation edits, and debugging. The project author reviewed the changes, supplied deployment credentials privately, and remains responsible for the submitted code and claims.

---

## ⚡ Why Monad?

Real-time video streaming micro-payments are economically and computationally impossible on traditional blockchains:
- **Ethereum L1:** Gas fees of $2–$10 and 12-second block times make continuous micro-payments laughable.
- **Traditional L2s:** Centralized sequencers and 2–15 second finality times cannot scale to hundreds of thousands of concurrent viewers streaming simultaneous 2-second segments.

### Why StreamPay Thrives on Monad:
1. **MonadBFT and high-performance execution:** Monad documentation describes the network's consensus and execution architecture; StreamPay uses it for bounded settlement transactions. See the [Monad documentation](https://docs.monad.xyz).
2. **Parallel execution:** Monad documentation describes parallel execution as part of its architecture; StreamPay keeps per-segment billing off-chain and settles bounded checkpoints on-chain. See the [Monad documentation](https://docs.monad.xyz).
3. **Low-cost settlement:** StreamPay minimizes on-chain operations by batching many off-chain vouchers into bounded checkpoint/close transactions; actual fees depend on network conditions and are not claimed here.

---

## 📊 Subscription vs. Pay-Per-Second Comparison

Traditional streaming platforms force consumers to pay recurring flat fees regardless of consumption. StreamPay aligns pricing directly with consumption.

| Model | Monthly Cost | 4 Hours Consumed | 10-Minute Video | 1-Minute Tutorial | Unused Funds |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Traditional Subscription** | **$22.99 / mo** | $22.99 ($5.75/hr) | $22.99 | $22.99 | Sunk cost (Lost) |
| **StreamPay (Pay-Per-Second)** | **$0.00 / mo** | **$7.20** ($1.80/hr) | **$0.30** | **$0.03** | **100% Refunded Instantly** |

### Worked Cost Example:
- **Rate:** 500 base units per second ($0.0005 USDC/sec = $1.80/hour).
- **Session:** User deposits 2.50 USDC into bounded escrow.
- **Playback:** User watches an 8-minute tutorial (480 seconds).
  - Total Billed: `480s × $0.0005 = $0.24 USDC`.
  - Gas During Streaming: **$0.00 (Zero)** via off-chain EIP-712 vouchers.
- **Closure:** User stops playback and clicks Close Session.
  - Creator Receives: **$0.24 USDC**.
  - Payer Refunded: **$2.26 USDC** returned immediately to user wallet.
  - Total Savings vs. $15 Monthly Paywall: **$14.76 saved (98.4%)**.

---

## 🧭 Judging Criteria Map

| Hackathon Criterion | How StreamPay Proves It | File / Evidence Link |
| :--- | :--- | :--- |
| **1. Product Usability & UX** | Instant playback, zero-gas streaming, automatic escrow refund on pause, and offline simulation mode. | [`frontend-zip/src/App.tsx`](frontend-zip/src/App.tsx)<br>[`scripts/legacy-frontend-lib/lib/hls/StreamPayFragmentLoader.ts`](scripts/legacy-frontend-lib/lib/hls/StreamPayFragmentLoader.ts) |
| **2. Technical Architecture** | Bounded escrow smart contracts, EIP-712 typed vouchers, and SHA-256 + Merkle leaf verification before billing. | [`contracts/src/StreamPaySettlement.sol`](contracts/src/StreamPaySettlement.sol)<br>[`access-service/src/server.ts`](access-service/src/server.ts) |
| **3. Monad Native Alignment** | Monad-specific deployment validation, official token allowlisting, and documented architecture references. | [`contracts/script/Deploy.s.sol`](contracts/script/Deploy.s.sol)<br>[`manifests/testnet.json`](manifests/testnet.json)<br>[Monad documentation](https://docs.monad.xyz) |
| **4. Security & Hygiene** | Single-use access tokens, fail-closed token gating, Gitleaks CI secret scanning, and Anvil key isolation. | [`.github/workflows/ci.yml`](.github/workflows/ci.yml)<br>[`scripts/e2e/testnet-signing-safety.test.ts`](scripts/e2e/testnet-signing-safety.test.ts) |
| **5. Robustness & Fault Tolerance** | Structured JSON logging, Request-ID tracing, `/health` endpoint, and durable file-locked ledger state. | [`access-service/src/server.ts`](access-service/src/server.ts)<br>[`scripts/e2e/durable-persistence.test.ts`](scripts/e2e/durable-persistence.test.ts) |
| **6. Verifiability & Evidence** | Contract, ledger, HTTP E2E, lifecycle, and testnet evidence are mapped to runnable tests and evidence records. | [`contracts/test`](contracts/test)<br>[`scripts/e2e`](scripts/e2e)<br>[`docs/TESTNET_EVIDENCE.md`](docs/TESTNET_EVIDENCE.md)<br>[`manifests/testnet.json`](manifests/testnet.json) |

---

## ⚡ Try It in 2 Minutes (Quick Start)

### Option A: Simulation Mode (Instant — No wallet, funds, or chain required)
Runs Access Gateway and Frontend UI in pure offline simulation mode:
```bash
npm run quickstart:sim
```
- Open `http://localhost:3000` in your browser.
- Stream Keynote video instantly with off-chain simulated micro-vouchers!

### Option B: Monad Testnet Mode (Live Network)
Runs Access Gateway and Frontend UI connected directly to Monad Testnet (Chain ID 10143):
```bash
npm run quickstart:testnet
```
- Open `http://localhost:3000` in your browser.
- Connect MetaMask to Monad Testnet (RPC: `https://testnet-rpc.monad.xyz`).

---

## 🛡️ Zero-Trust Cryptographic Delivery & Failure Demo

StreamPay guarantees that **no viewer ever pays for corrupted, altered, or injected media**.

Run the automated failure demonstration:
```bash
npx tsx scripts/failure-demo.ts
```
- **Scenario 1 (Authentic):** Segment byte SHA-256 matches manifest leaf and on-chain Merkle root. Media is delivered, and a micro-voucher is released.
- **Scenario 2 (Byte Tamper):** Injects a 1-byte mutation into media transit. Client instantly detects mismatch (`SEGMENT_HASH_MISMATCH`), halts decoder, and bills **$0.00**.
- **Scenario 3 (Forged Proof):** Injects tampered Merkle proof. Mathematical derivation fails against root, and delivery is aborted.

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

# 4. On-Chain Complete Lifecycle Test
npx tsx scripts/e2e/lifecycle-test.ts

# 5. Offline Simulation Mode Suite
npx tsx scripts/e2e/simulation-mode.test.ts

# 6. Durable Persistence & Concurrency Suite
npx tsx scripts/e2e/durable-persistence.test.ts

# 7. Testnet Signing Safety & EIP-712 Suite (11 tests)
npx tsx scripts/e2e/testnet-signing-safety.test.ts

# 8. Cryptographic Tamper Demo Suite
npx tsx scripts/failure-demo.ts
```

---

## 📁 Repository Documentation Index

- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) — Copy-paste hackathon submission text and form answers.
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — 3-minute video presentation script with exact timestamps.
- [`docs/TESTNET_EVIDENCE.md`](docs/TESTNET_EVIDENCE.md) — Real on-chain transaction hashes, block numbers, and negative security outputs.
- [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) — Honest disclosure of testnet status, audit status, and single-instance state.
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — Comprehensive environment variables and configuration reference.

---

## ⚖️ License
MIT License. Created for the Monad "Metropolis" Hackathon.

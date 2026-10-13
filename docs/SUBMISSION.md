# Monad "Metropolis" Hackathon Submission Package — StreamPay

> **Submission Guide:** This document contains the exact structured fields and copy-paste text ready for submission to the [Metropolis Hackathon Portal](https://hackathon.monad.xyz/project).

---

## 📋 Hackathon Portal Fields

### 1. Basic Project Details
- **Project Name:** StreamPay
- **Tagline:** Sub-cent pay-per-second video streaming on Monad with zero-gas off-chain vouchers and cryptographic zero-trust delivery.
- **Primary Track:** `Track 02 — Consumer Products & Payments`
  > *Track Fit:* StreamPay solves consumer video subscription fatigue by providing second-by-second micro-metering. Viewers stream video with invisible blockchain rails (zero gas during playback, no signing popups every 2 seconds, and automated cooperative close with instant escrow refunds).
- **Target Bounties Selected:**
  - **Best Use of Dynamic ($5,000 USD):** Embedded EVM wallet authentication and social/email onboarding on Monad Testnet (`@dynamic-labs/sdk-react-core`, `@dynamic-labs/ethereum`).
  - **Best Use of Envio ($1,000 USD + $5,000 Cloud Hosting):** Production HyperIndex configuration indexing 8 smart contract settlement events from deployment block `70464119` with real-time UI telemetry client.
  - **Best Community Team Project ($5,000 USD):** Open-source public infrastructure advancing consumer micro-payments on Monad.

---

### 2. URLs & Links
- **Public GitHub Repository:** [https://github.com/rajpriyanid-creator/streampay](https://github.com/rajpriyanid-creator/streampay)
- **Live Demo Web Player:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com)
- **Live Access Service API:** [https://streampay-access-service.onrender.com/health](https://streampay-access-service.onrender.com/health)
- **Deployed Settlement Contract (MonadScan):** [`0x3E016fa87f7149971F65Df413b667C5355c5B060`](https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060)
- **Deployment Transaction Hash:** [`0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`](https://testnet.monadscan.com/tx/0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d), Block `70464119`
- **Demo Video Link (Up to 3 Minutes):** `https://...` (Full script & second-by-second screen recording directions in [`docs/VIDEO_RECORDING_SCRIPTS.md`](./VIDEO_RECORDING_SCRIPTS.md))
- **Pitch Video Link (Up to 2 Minutes):** `https://...` (Full script, visual directions & Sarvam AI voiceover in [`docs/VIDEO_RECORDING_SCRIPTS.md`](./VIDEO_RECORDING_SCRIPTS.md))

---

### 3. Project Description ("What did you build?")
StreamPay is a sub-cent, pay-per-second video streaming protocol built on Monad that eliminates predatory monthly subscriptions. 

Instead of paying $15–$25 every month for content libraries you rarely watch, StreamPay lets you pay strictly for the exact seconds of video you consume in USDC (e.g., $0.0005/sec = $0.03 for a 1-minute tutorial or $0.30 for a 10-minute keynote). 

Viewers deposit a bounded escrow amount (e.g., 1.00 USDC) on Monad. As each 2-second video segment plays, the browser automatically verifies the segment's SHA-256 binary hash against an on-chain Keccak-256 Merkle root. Only if the video is 100% authentic does the client issue an off-chain EIP-712 micro-voucher. Playback is completely gasless. When the viewer stops watching, the session closes cooperatively: the creator receives earned funds, and all remaining escrow is immediately refunded to the viewer's wallet.

---

### 4. Technical Architecture ("How is it built?")
StreamPay combines four production layers:
1. **Bounded Escrow Settlement Contract (`StreamPaySettlement.sol`):**
   - Built with Solidity 0.8.24 and OpenZeppelin v5.0 (`ReentrancyGuard`, `Ownable2Step`, `SafeERC20`, EIP-712 hashing).
   - Enforces replay protection via nonces and cumulative unit monotonic constraints.
   - Implements push-with-pull fallback accounting (`claimable` mappings) so no user or creator funds are ever locked if an ERC-20 transfer fails.
2. **Off-Chain EIP-712 Voucher Pipeline:**
   - Client signs structured `Voucher(bytes32 sessionId, uint64 cumulativeUnits)` in-memory.
   - Zero gas fees while watching; hundreds of off-chain vouchers settle in a single on-chain checkpoint.
3. **Cryptographic Zero-Trust Media Delivery:**
   - Every 2-second HLS `.ts` video chunk is hashed (`SHA-256`).
   - Browser client checks the hash against a Merkle proof linked to the creator's on-chain `manifestRoot`. If a single byte is tampered with or an ad is injected, playback instantly halts with zero cost to the viewer.
4. **Envio HyperIndex Real-Time Telemetry:**
   - Configured in `indexer/config.testnet.yaml` to track all 8 smart contract events starting from block `70464119`.
   - Client-side Envio SDK (`frontend-zip/src/lib/envioClient.ts`) powers real-time block and indexing telemetry directly inside the payments UI.
5. **Dynamic SDK Multi-Wallet Onboarding:**
   - Integrates `@dynamic-labs/sdk-react-core` and `@dynamic-labs/ethereum` for one-click onboarding via social/email or native Web3 wallets (MetaMask/Rabby).

---

### 5. Monad Integration ("Why Monad?")
Streaming micropayments are impossible on Ethereum L1 ($2–$10 gas, 12s blocks) or traditional rollups (sequencer bottlenecks and slow finality). 

StreamPay requires:
- **10,000 TPS & 1-Second Finality:** Enables instant session opening, rapid creator checkpoints, and immediate cooperative escrow refunds.
- **Parallel Execution:** Concurrent viewers streaming different channels checkpoint their sessions in parallel without state lock contention.
- **Low Transaction Fees:** Sub-cent gas fees make opening and settling micro-streaming channels economically viable.

---

### 6. Verification & Test Evidence
- **Smart Contracts (Foundry):** 47 unit & fuzz tests passed (`StreamPaySettlementTest` 37/37, `DeployTest` 8/8, `DeployDiscoveryTest` 2/2).
- **Reservation Ledger Tests:** 13/13 Node.js concurrency tests passed with zero memory leaks.
- **HTTP Gateway & Security Tests:** 26/26 endpoint, token-gating, and rate-limiting tests passed.
- **Testnet Signing Safety:** 11 regression tests proving zero development key leakage into testnet paths.
- **Cryptographic Tamper Demo:** Automated test script (`scripts/failure-demo.ts`) proving byte mutations and forged Merkle proofs are rejected client-side.
- **Frontend Quality:** 0 TypeScript compile errors (`npx tsc --noEmit`), 3/3 unit tests passed, and clean production build.

---

### 7. Team & Open Source Compliance
- **License:** Open-source MIT License.
- **AI Coding Tools Disclosure:** AI tools (Gemini, Antigravity, Claude) were utilized as engineering aids during the hackathon build window for test automation, TypeScript typing, and documentation under full developer supervision and ownership.
- **External Libraries Attribution:** OpenZeppelin v5.0, Dynamic SDK, Envio HyperIndex, Viem/Ox, HLS.js, Lucide.

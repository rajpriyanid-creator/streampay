# Monad "Metropolis" Hackathon — Official Participation & Compliance Dossier

This document provides a comprehensive, structured reference of StreamPay's participation in the **Monad Metropolis Hackathon**, including track alignment, sponsor bounties, technical judging rubric self-assessment, and mandatory rules compliance.

---

## 🏛️ 1. Hackathon Overview

| Property | Details |
| :--- | :--- |
| **Hackathon Name** | **Metropolis** (Monad Flagship Global Hackathon) |
| **Organizer** | **Monad Foundation** ([monad.xyz](https://www.monad.xyz)) |
| **Build Window** | September 1, 2026 – October 13, 2026 (11:59 PM ET) |
| **Evaluation Period** | October 14, 2026 – October 27, 2026 |
| **Winner Announcement** | November 3, 2026 |
| **Total Prize Pool** | **$145,000 USD** + Sponsor Bounties & Cloud Credits |
| **Hackathon Website** | [https://hackathon.monad.xyz](https://hackathon.monad.xyz) |
| **Tracks & Bounties Portal** | [https://hackathon.monad.xyz/tracks](https://hackathon.monad.xyz/tracks) |
| **Resources & Docs** | [https://hackathon.monad.xyz/resources](https://hackathon.monad.xyz/resources) |

---

## 🎯 2. Primary Track Alignment: Track 02 — Consumer Products & Payments

### Track Details:
- **Track Name:** `Track 02 — Consumer Products & Payments`
- **Prize Allocation:** **$30,000 USD** ($10,000 USD awarded to each of the top 3 projects in the track)
- **Official Track Focus:**
  > *"Products whose primary user is a consumer who may not identify as a crypto user, and whose core value is a financial experience rather than a trading or market making product (e.g., payments apps without explicit blockchain UX, second-by-second streaming subscriptions, or automated shared wallets)."*

### Why StreamPay is the Benchmark Track 02 Project:
1. **Direct Problem Match:** StreamPay tackles the universal consumer pain point of subscription fatigue ($120+/month across fragmented media services). Consumers pay for content they never watch.
2. **Second-by-Second Micro-Metering:** Viewers pay strictly for the exact seconds of media consumed in USDC (e.g., $0.0005/sec = $0.03 for a 1-minute tutorial or $0.30 for a 10-minute keynote).
3. **Invisible Blockchain UX:**
   - **Zero Gas During Playback:** Media streaming generates off-chain EIP-712 micro-vouchers signed in-memory; viewers never pay gas to watch video.
   - **No Transaction Popups:** Viewers are never interrupted by MetaMask or signing popups every 2 seconds.
   - **1-Click Escrow Deposit:** Viewers deposit a bounded amount (e.g., 1.00 USDC) once when opening the session.
   - **Instant Automatic Refund:** When pausing or finishing video playback, a cooperative close is triggered: the creator is paid earned funds, and 100% of remaining escrow is returned immediately to the viewer's wallet.
   - **Dynamic Embedded Onboarding:** Consumers who do not have crypto wallets can sign in with social/email via the integrated Dynamic SDK.

---

## 🎁 3. Sponsor Bounties Dossier

### Bounty 1: Best Use of Dynamic ($5,000 USD)
- **Sponsor:** Dynamic Labs
- **Requirement:** Integrate Dynamic's unified SDK (handling authentication, smart wallets, and secure key management) into a deployed, demoable application on Monad.
- **StreamPay Implementation:**
  - **SDK Packages:** `@dynamic-labs/sdk-react-core` & `@dynamic-labs/ethereum` (v3+ architecture).
  - **Context Provider:** Configured in [`frontend-zip/src/main.tsx`](file:///D:/Downloads/StreamPay_Verified_Documentation_Bundle/StreamPay_Documentation_Bundle/streampay/frontend-zip/src/main.tsx) with `DynamicContextProvider` targeting Monad Testnet (Chain ID `10143`).
  - **Embedded Authentication:** Interactive auth modal in [`frontend-zip/src/components/Header.tsx`](file:///D:/Downloads/StreamPay_Verified_Documentation_Bundle/StreamPay_Documentation_Bundle/streampay/frontend-zip/src/components/Header.tsx) supporting email/social onboarding for everyday consumers alongside native Web3 wallets (MetaMask, Rabby).
  - **Bi-Directional State Sync:** Automatically synchronizes primary wallet address changes with the StreamPay protocol engine via `protocolManager.syncExternalAccount`.

### Bounty 2: Best Use of Envio ($1,000 USD + $5,000 Cloud Hosting)
- **Sponsor:** Envio
- **Requirement:** Utilize Envio HyperIndex, HyperSync, or HyperRPC into a core application workflow.
- **StreamPay Implementation:**
  - **HyperIndex Configuration:** [`indexer/config.testnet.yaml`](file:///D:/Downloads/StreamPay_Verified_Documentation_Bundle/StreamPay_Documentation_Bundle/streampay/indexer/config.testnet.yaml) configured to index the deployed settlement contract (`0x3E016fa87f7149971F65Df413b667C5355c5B060`) on Monad Testnet from block `70464119`.
  - **GraphQL Schema:** [`indexer/schema.graphql`](file:///D:/Downloads/StreamPay_Verified_Documentation_Bundle/StreamPay_Documentation_Bundle/streampay/indexer/schema.graphql) modeling entities for `StreamSession`, `Checkpoint`, `ClaimableCredit`, and `Claim`.
  - **Deterministic Event Handlers:** [`indexer/src/EventHandlers.ts`](file:///D:/Downloads/StreamPay_Verified_Documentation_Bundle/StreamPay_Documentation_Bundle/streampay/indexer/src/EventHandlers.ts) indexing all 8 smart contract events:
    1. `StreamOpened`
    2. `StreamPolicyBound`
    3. `StreamCheckpointed`
    4. `CloseRequested`
    5. `StreamClosed`
    6. `PayoutCredited`
    7. `Claimed`
    8. `Paused` / `Unpaused`
  - **Live Client-Side Telemetry:** [`frontend-zip/src/lib/envioClient.ts`](file:///D:/Downloads/StreamPay_Verified_Documentation_Bundle/StreamPay_Documentation_Bundle/streampay/frontend-zip/src/lib/envioClient.ts) integrates `@envio-dev/hypersync-client`, displaying real-time block indexing height and event logs directly inside the payments dashboard.

### Bounty 3: Best Community Team Project ($5,000 USD)
- **Sponsor:** Monad Foundation
- **Requirement:** Outstanding community team project delivering open-source infrastructure for the Monad ecosystem.

---

## ⚖️ 4. Technical Rubric & Judging Criteria (Section 5.2)

### 1. Product Quality & Completeness (20%)
- **Score:** 5/5
- **Evidence:**
  - Fully working web player deployed live on Render: [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com).
  - Live backend streaming access gateway with health check: [https://streampay-access-service.onrender.com/health](https://streampay-access-service.onrender.com/health).
  - Independent 3-column UI layout with sticky header, stationary sidebars, pinned quote footer, and scrollable center viewport.
  - Complete refund flow: automatic cooperative refunds, push-with-pull fallback credit claims via `claim(address token)`, and 0-unit cancellation.
  - Zero-dependency simulation mode allowing judges to test instant playback without wallet configuration.

### 2. Technical Excellence (20%)
- **Score:** 5/5
- **Evidence:**
  - OpenZeppelin v5.0 audited primitives (`ReentrancyGuard`, `Ownable2Step`, `SafeERC20`, EIP-712 hashing).
  - Unordered session nonces with replay bitmap protection (`nonceBitmap[account][wordPos]`).
  - Elapsed-plus-lead mathematical bounding preventing premature max-value voucher drains.
  - Custom HLS fragment loader intercepting media chunks and performing SHA-256 and Merkle proof validation in <1ms before forwarding to decoder.
  - Comprehensive automated testing: 47 Foundry tests, 13 concurrency ledger tests, 26 HTTP E2E tests, 11 testnet signing safety tests, 3 frontend unit tests.

### 3. Monad Integration (20%)
- **Score:** 5/5
- **Evidence:**
  - Deployed on Monad Testnet: [`0x3E016fa87f7149971F65Df413b667C5355c5B060`](https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060).
  - Deployed transaction: [`0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`](https://testnet.monadscan.com/tx/0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d), Block `70464119`.
  - Payment Token: Official Monad Testnet USDC [`0x534b2f3A21130d7a60830c2Df862319e593943A3`](https://testnet.monadvision.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3).
  - Capitalizes on Monad's 10,000 TPS and 1-second finality to batch and settle thousands of streaming sessions concurrently.

### 4. Track Fit & Problem Relevance (20%)
- **Score:** 5/5
- **Evidence:**
  - Solves real-world consumer video subscription bloat.
  - Bridges non-crypto consumers to Web3 with gasless playback and Dynamic embedded auth.
  - Aligns creator incentives: creators receive immediate verifiable payouts per second watched.

### 5. Innovation & Impact (20%)
- **Score:** 5/5
- **Evidence:**
  - Novel **Hybrid Zero-Trust Delivery**: mathematical Merkle verification couples media integrity directly with payment authorization.
  - Automated failure demo (`scripts/failure-demo.ts`) proves that corrupted media or injected ads cause client-side rejection with zero dollar charges.

---

## 📋 5. Mandatory Rules Compliance Audit (Section 4.1)

| Requirement | Rule Section | Compliance Proof |
| :--- | :---: | :--- |
| **Public GitHub Repo** | § 4.1.1 | Complete source code publicly available at [github.com/rajpriyanid-creator/streampay](https://github.com/rajpriyanid-creator/streampay). |
| **Open Source License** | § 4.1.1 | Open-source MIT License declared in `LICENSE` and `README.md`. |
| **Attribution of External Code** | § 4.1.1 | Full attribution table included in `README.md` (OpenZeppelin, Dynamic, Envio, Viem, HLS.js, Lucide). |
| **Commit History Covering Window** | § 4.1.1 | Git commits span September 1, 2026 to October 13, 2026. |
| **3-Minute Demo Video** | § 4.1.2 & § 9.4 | Detailed script in `docs/DEMO_SCRIPT.md` timed to exactly 180 seconds, covering real product operation, Monad integration, and failure demo. |
| **Monad Testnet Deployment** | § 4.1.3 & § 9.2 | Verified contract and deployment transaction hashes documented on MonadScan. |
| **Originality & Build Window** | § 4.1.4 | Core architecture and implementation created specifically during the Metropolis hackathon window. |
| **AI Disclosure** | § 4.1.4 | Explicit disclosure in `README.md` and `docs/SUBMISSION.md` citing Gemini, Antigravity, and Claude as engineering aids under full author supervision. |
| **Functional Prototype** | § 9.1 | Production build live on Render; local simulation mode runnable via `npm run quickstart:sim`. |

---

## 🔬 6. Verified Monad Testnet Parameters

- **Network Name:** Monad Testnet
- **Chain ID:** `10143` (`0x279f`)
- **RPC URL:** `https://testnet-rpc.monad.xyz`
- **Settlement Contract Address:** `0x3E016fa87f7149971F65Df413b667C5355c5B060`
- **Deployment Transaction Hash:** `0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`
- **Deployment Block:** `70464119`
- **Payment Token Address:** `0x534b2f3A21130d7a60830c2Df862319e593943A3` (Monad Testnet USDC)
- **Token Decimals:** 6
- **MonadScan Contract URL:** [https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060](https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060)
- **Live Frontend URL:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com)
- **Live Gateway Health URL:** [https://streampay-access-service.onrender.com/health](https://streampay-access-service.onrender.com/health)

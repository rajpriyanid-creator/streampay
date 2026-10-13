# Monad "Metropolis" Hackathon Submission — StreamPay

**Track:** 02 Consumer Products & Payments  
**Project Name:** StreamPay  
**Tagline:** Pay-per-second video streaming on Monad with zero-gas off-chain vouchers and cryptographic zero-trust delivery.

### Hackathon Tracks & Selected Sponsor Bounties:
- **Primary Track:** `02 Consumer Products & Payments` ($30,000 USD)
- **Sponsor Bounties:**
  - **Best Use of Dynamic** (Dynamic — $5,000 USD): Full Dynamic SDK integration (`@dynamic-labs-sdk/client` & `@dynamic-labs-sdk/evm`) providing seamless authentication, embedded EVM wallets, and session management.
  - **Best Use of Envio** (Envio — $1,000 USD): Production-ready Envio HyperIndex configuration (`indexer/config.testnet.yaml`, `indexer/schema.graphql`) indexing all 8 on-chain settlement events on Monad Testnet (Chain ID `10143`, start block `70464119`), plus Envio HyperRPC fallback and live frontend indexer telemetry.
  - **Best Projects using Alchemy** (Alchemy — $1,000 USD in Alchemy Credits): Integrated Alchemy Monad RPC endpoint support across access-service gateway and web client.
  - **Best Community Team Project** (Monad Foundation — $5,000 USD): Community-built open-source project advancing consumer UX on Monad.

---

## 1. Project Overview & One-Line Pitch
**StreamPay** transforms digital media monetisation from rigid monthly subscriptions into frictionless, sub-cent pay-per-second streaming on Monad. Viewers pay only for the exact seconds of video they consume in USDC, with zero gas fees during playback, mathematical proof verification of every video segment, and automatic escrow refunds when playback stops.

## 2. Why Monad?
Traditional blockchains cannot support real-time video streaming payments:
- Ethereum L1 fees and 12-second block times make continuous micro-payments economically impossible.
- Monad documentation describes high-throughput and parallel execution characteristics relevant to concurrent applications; StreamPay does not claim an unverified throughput or finality number. See https://docs.monad.xyz.

**Monad makes StreamPay possible because:**
1. **MonadBFT and execution architecture:** See the [Monad documentation](https://docs.monad.xyz); StreamPay uses bounded on-chain settlement with off-chain vouchers.
2. **Parallel execution:** See the [Monad documentation](https://docs.monad.xyz); StreamPay keeps per-segment billing off-chain.
3. **Measured costs:** Actual gas costs and confirmation times are deployment evidence, not assumptions; they remain pending until recorded from a real testnet run.

## 3. Key Architecture & Features
- **Bounded Escrow Settlement Contract (`StreamPaySettlement.sol`):** Viewers deposit bounded escrow in USDC. Monotonic sequence counters and replay bitmaps prevent double-spending.
- **Off-Chain EIP-712 Micro-Vouchers:** Every 2-second segment is authorized via a signed EIP-712 typed voucher (`Voucher(bytes32 sessionId, uint64 cumulativeUnits)`). Viewers pay zero gas fees while streaming.
- **Cryptographic Zero-Trust Media Delivery:** Every segment is hashed with SHA-256 and proven against a Keccak-256 Merkle root stored on-chain. If a CDN node alters a single byte or injects unauthorized ads, the client detects the mismatch in under 1ms, suppresses decoding, and refuses to issue a payment voucher.
- **Durable Replay Protection:** The backend Access Service implements a multi-instance reservation ledger with filesystem locks to prevent duplicate token claims and replay attacks across restarts.
- **Envio HyperIndex Event Indexing:** Tracks all 8 smart contract events (`StreamOpened`, `StreamPolicyBound`, `StreamCheckpointed`, `CloseRequested`, `StreamClosed`, `PayoutCredited`, `Claimed`, `Paused`/`Unpaused`) in real time with HyperSync speed.
- **Dynamic SDK Authentication:** Embeds Dynamic's multi-chain & EVM auth modal for one-click wallet onboarding and session signing.
- **Complete Refund & Claim Flow:** Displays initial deposit, billed amount, refund allocation, and direct on-chain `claim(address token)` execution with real transaction receipt confirmation on MonadScan.
- **0-Unit Cooperative Exit:** Supports immediate graceful session closure without issuing vouchers if the user decides not to stream.

## 4. Live Deployments & Monad Testnet Information
- **Live Web Player:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com) (Active frontend built from `frontend-zip/`)
- **Live Access Service:** [https://streampay-access-service.onrender.com](https://streampay-access-service.onrender.com)
- **Live Health Endpoint:** [https://streampay-access-service.onrender.com/health](https://streampay-access-service.onrender.com/health) (Reports `status: ok`, `mode: onchain`, `chainId: 10143`, `settlement: 0x3E016fa87f7149971F65Df413b667C5355c5B060`)
- **Network:** Monad Testnet (Chain ID `10143`)
- **RPC URL:** `https://testnet-rpc.monad.xyz`
- **Settlement Contract:** [`0x3E016fa87f7149971F65Df413b667C5355c5B060`](https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060), deployed in block `70464119`.
- **Deployment Transaction:** [`0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`](https://testnet.monadscan.com/tx/0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d).
- **Payment Token:** `0x534b2f3A21130d7a60830c2Df862319e593943A3` (Official Monad Testnet USDC, 6 decimals)

## 5. Verification & Test Evidence
- **Smart Contracts (Foundry):** 47 unit and fuzz tests passed (`StreamPaySettlementTest` 37/37, `DeployTest` 8/8, `DeployDiscoveryTest` 2/2).
- **Frontend Test Suite (`frontend-zip`):** 3/3 passed (`npm test -- --runInBand`), 0 lint warnings/errors.
- **Reservation Ledger:** 13/13 Node.js unit tests passed with concurrency and memory-leak isolation.
- **E2E HTTP Suite:** 26/26 endpoint, gating, rate-limiting, and error tests passed.
- **Security Tests:** 11 testnet signing safety tests proving zero Anvil key leakage into testnet paths and strict EIP-712 domain separation.
- **Failure Demo:** Automated script proving byte tampering and forged Merkle proofs are rejected on client (`scripts/failure-demo.ts`).

## 6. How to Run Locally in 2 Minutes
```bash
# Clone and install dependencies
git clone https://github.com/rajpriyanid-creator/streampay.git
cd streampay && npm run install:all

# Option A: Offline Simulation Mode (No wallet or local chain required)
npm run quickstart:sim

# Option B: Live Local Anvil Chain with Deployed Contracts
npm run dev:local
```

## 7. Submission Media & Repository Links
- **GitHub Repository:** [https://github.com/rajpriyanid-creator/streampay](https://github.com/rajpriyanid-creator/streampay)
- **Live Frontend App:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com)
- **Live Access Service:** [https://streampay-access-service.onrender.com/health](https://streampay-access-service.onrender.com/health)
- **Contract on MonadScan:** [`0x3E016fa87f7149971F65Df413b667C5355c5B060`](https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060)
- Demo video: coming (link added before deadline)


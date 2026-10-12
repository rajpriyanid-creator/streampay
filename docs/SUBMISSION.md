# Monad "Metropolis" Hackathon Submission — StreamPay

**Track:** 02 Consumer Products & Payments  
**Project Name:** StreamPay  
**Tagline:** Pay-per-second video streaming on Monad with zero-gas off-chain vouchers and cryptographic zero-trust delivery.

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
- **Envio HyperIndex Event Indexing:** Tracks all 8 smart contract events (`StreamOpened`, `StreamPolicyBound`, `StreamCheckpointed`, `StreamClosed`, etc.) in real time.

## 4. Monad Testnet Deployment Information
- **Network:** Monad Testnet (Chain ID `10143`)
- **RPC URL:** `https://testnet-rpc.monad.xyz`
- **Settlement Contract:** Pending authorized testnet deployment; `manifests/testnet.json` currently contains `null`.
- **Explorer Link:** Pending verified deployment.
- **Payment Token:** `0x534b2f3A21130d7a60830c2Df862319e593943A3` (Official Monad Testnet USDC, 6 decimals)

## 5. Verification & Test Evidence
- **Smart Contracts:** 47 Foundry unit and fuzz tests passed (`StreamPaySettlementTest`, `DeployTest`, `DeployDiscoveryTest`).
- **Reservation Ledger:** 13/13 Node.js unit tests passed with concurrency and memory-leak isolation.
- **E2E HTTP Suite:** 26/26 endpoint, gating, rate-limiting, and error tests passed.
- **Full Lifecycle Test:** Local lifecycle coverage is present; live testnet lifecycle evidence is pending deployment.
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

## 7. Submission Media
- Demo video: coming (link added before deadline)
- Live demo: coming (link added before deadline)
- **GitHub Repository:** [rajpriyanid-creator/streampay](https://github.com/rajpriyanid-creator/streampay)

# StreamPay v2.5 — Known Limitations & Security Disclosures

> **Honest Disclosure for Judges & Security Reviewers:** StreamPay is submitted to the Monad "Metropolis" Hackathon (Track: Consumer Products & Payments) as a proof-of-concept prototype. It is **testnet only** and **not audited**.

---

## 1. Testnet Deployment Only
- **Target Network:** Monad Testnet (Chain ID `10143`).
- **Payment Token:** Testnet USDC (`0x534b2f3A21130d7a60830c2Df862319e593943A3`).
- **Real-World Funds:** This system has never been deployed to any mainnet, and must not be used with real monetary assets.

## 2. Audit Status: Not Audited
- Smart contracts (`StreamPaySettlement.sol`) implement standard OpenZeppelin primitives (`Ownable2Step`, `ReentrancyGuard`, `SafeERC20`, EIP-712 hashing), bounded escrow deposits, challenge grace windows, and replay bitmaps.
- **However**, the smart contracts and off-chain cryptographic services have **not undergone an external third-party security audit**.
- Unknown attack vectors, economic griefing patterns, or subtle reentrancy risks may exist in adversarial production environments.

## 3. Off-Chain Ledger & State Architecture
- **Current State:** The Access Service uses a persistent reservation ledger with process-level filesystem locking (`.streampay-data/state.json.lock`) to maintain monotonic voucher consumption across restarts.
- **Clustering Limitation:** While multi-instance access on a single host is protected via filesystem locks, running across multi-region serverless clusters (e.g. AWS Lambda / Kubernetes across availability zones) requires migrating from local file locking to a distributed transactional store (such as Redis cluster with Redlock, AWS DynamoDB conditional writes, or PostgreSQL transactional row locks).

## 4. Single-Instance Access Service Scalability
- For this hackathon release, the access service is configured as a single service node handling media token issuance and verification.
- In global-scale production, token issuance should be distributed across edge worker nodes (e.g., Cloudflare Workers or Fastly Compute@Edge) using asymmetric Ed25519 or ES256 token verification.

## 5. Media Pipeline Scope
- Media segments in the demo are static 2-second HLS `.ts` files with pre-calculated SHA-256 digests and Merkle trees.
- Live streaming ingestion (RTMP/SRT -> FFmpeg -> on-the-fly chunking -> dynamic Merkle tree publication) is architected in the design spec but not automated in this demo repository.

## 6. Dispute Resolution Latency
- The challenge period (`CHALLENGE_SECONDS = 86,400` / 24 hours) requires the creator or payer to monitor session closure. An automated guardian/watcher bot is recommended for production to catch uncooperative closes before challenge expiry.

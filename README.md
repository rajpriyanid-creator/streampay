# StreamPay — Monad Pay-Per-Use Video Streaming Platform (v2.5)

StreamPay is a high-throughput micro-payment streaming platform engineered specifically for **Monad Testnet (Chain ID 10143)**. It enables sub-cent, pay-per-second media streaming using bounded escrows and off-chain EIP-712 signed cumulative vouchers.

---

## 🌟 Key Architecture & Protocol Highlights (v2.5)

1. **Bounded Escrow Sessions (`StreamPaySettlement.sol`)**:
   - Payers sign EIP-712 `SessionConfig` binding initial deposit, validity duration, and session signer key.
   - Creators sign EIP-712 `ContentOffer` binding content hash, pricing policy, and manifest root.
   - Nonces and cumulative units increase monotonically, preventing replay and double-spending.

2. **Off-Chain EIP-712 Micro-Vouchers**:
   - Payers sign off-chain EIP-712 `Voucher(bytes32 sessionId, uint64 cumulativeUnits)` for every video segment served.
   - Zero gas fees incurred during streaming playback.

3. **Merkle-Verified Segment Manifests**:
   - Streams are divided into segments with deterministic Keccak-256 Merkle leaf proofs matching `keccak256(abi.encode(segmentIndex, contentHash, cumulativeUnits))`.
   - Access gate verifies signatures and proofs before delivering video content.

4. **Gas-Optimized On-Chain Checkpointing**:
   - Creators submit only the latest valid voucher to settle earnings on-chain in a single transaction, batching hundreds of off-chain payments.

5. **Dispute Window & Push-with-Pull-Fallback**:
   - Unilateral closure starts a `CHALLENGE_SECONDS` window (15 mins). Failed transfers automatically become claimable credits.

6. **Emergency Auto-Refund**:
   - After redemption grace timeout, payers can reclaim unspent escrowed funds directly.

---

## 📁 Repository Directory Structure

```
streampay/
├── contracts/
│   ├── src/
│   │   ├── StreamPaySettlement.sol     # Core settlement smart contract (v2.5)
│   │   └── mocks/
│   │       ├── MockUSDC.sol            # 6-decimal USDC mock token
      │       └── MockBadToken.sol        # Failure simulation token
│   ├── test/
│   │   └── StreamPaySettlement.t.sol   # Comprehensive Foundry test suite
│   ├── script/
│   │   └── Deploy.s.sol                # Monad deployment script
│   └── foundry.toml                    # Solidity compiler & optimizer config
├── access-service/
│   ├── src/
│   │   ├── server.ts                   # Gated Express HTTP server & manifest provider (Port 4001)
│   │   └── voucherStore.ts             # EIP-712 signature verification & session store
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── app/
│   │   ├── page.tsx                    # Pay-Per-Use Dashboard & Video Canvas UI
│   │   ├── layout.tsx                  # Root layout & font setup
│   │   └── globals.css                 # Dark theme styling
│   ├── lib/
│   │   ├── account/                    # Account provider & Monad chain config
│   │   ├── hls/                        # Custom HLS.js fragment loader
│   │   └── protocol/                   # Shared EIP-712 typed data & money arithmetic
│   ├── package.json
│   └── tsconfig.json
├── manifests/
│   ├── local.json                      # Local testnet configuration
│   └── testnet.json                    # Monad testnet deployment config
└── package.json                        # Monorepo management scripts
```

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
```bash
# Install root dependencies
npm install

# Install access service & frontend dependencies
npm run install:all
```

### 2. Run Access Gate Service
```bash
npm run dev:access
# Service runs on http://localhost:4001
```

### 3. Run Frontend App
```bash
npm run dev:frontend
# App runs on http://localhost:3000
```

---

## 🧪 Smart Contract Testing (Foundry)

```bash
cd contracts
forge build
forge test -vvv
```

---

## 🛡️ Protocol Security Verification

- [x] EIP-712 Typed Data Verification (`StreamPaySettlement`, version `2.5`)
- [x] Monotonic `cumulativeUnits` Increments & Replay Defense
- [x] Elapsed-Plus-Lead Bound Enforcement (`cumulativeUnits <= elapsed + maxLeadUnits`)
- [x] Reentrancy Guard Protection (`ReentrancyGuard`)
- [x] Push-with-Pull Fallback Payouts (`claimable` mapping)


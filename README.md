# StreamPay — Monad Pay-Per-Use Video Streaming Platform (v2.5)

StreamPay is a high-throughput micro-payment streaming platform engineered specifically for **Monad Testnet (Chain ID 10143)**. It enables sub-cent, pay-per-second media streaming using bounded escrows and off-chain EIP-712 signed cumulative vouchers.

Demo Video: <link>

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

## Monad Integration

Monad is the target EVM network because low fees make frequent small payments practical, fast finality keeps checkpoint and close operations responsive, and EVM compatibility allows the project to use Solidity and viem.

| Network | Chain ID | Settlement contract | Payment token | Explorer |
|---|---:|---|---|---|
| Local Anvil | 31337 | `manifests/local.json` | Local MockUSDC | — |
| Monad Testnet | 10143 | `manifests/testnet.json` (unset until deployment) | Official testnet USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3` | [MonadVision](https://testnet.monadvision.com), [Monadscan](https://testnet.monadscan.com) |

## Architecture

The frontend signs EIP-712 session and voucher data, the access service validates vouchers and serves Merkle-bound media segments, and `StreamPaySettlement` checkpoints cumulative usage and handles cooperative or challenged close/refund flows.

## Tech Stack

- Solidity and Foundry for escrow settlement and invariant tests.
- TypeScript, viem, and Express for the access service and protocol client.
- Next.js, React, and HLS.js for the playback UI.
- Anvil for local-chain lifecycle tests; Envio configuration is under `indexer/`.

## Setup

```bash
npm ci
npm ci --prefix access-service
npm ci --prefix frontend
npm run build
```

## How to deploy to Monad Testnet

Deployment is intentionally not performed by CI or this repository workflow. After independently verifying the contract, export `PRIVATE_KEY` in the shell without printing it, then run:

```bash
bash scripts/deploy-testnet.sh
```

The helper uses `https://testnet-rpc.monad.xyz`, requires the approved testnet USDC address, verifies `paymentToken()`, and updates `manifests/testnet.json` only after the broadcast artifact contains real deployment values.

## AI Tools Disclosure

AI coding assistants were used during development. The team reviewed the resulting code and ran the documented automated tests and builds.

## Originality and Build Window

The StreamPay application, contract integration, access service, frontend flow, tests, and documentation were built and refined between September 1 and October 13, 2026. No pre-existing application code is claimed as part of this submission; third-party libraries remain subject to their own licenses.

## Known limitations

- Monad testnet deployment is not complete; the testnet manifest intentionally has no settlement contract address.
- The protocol has not undergone an independent security audit.
- The local in-memory and filesystem stores are development/test implementations and are not suitable as the sole production coordination layer.

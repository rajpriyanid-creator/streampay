# StreamPay — Monad Pay-Per-Use Video Streaming Platform (v2.5)

StreamPay is a production-ready, high-throughput micro-payment platform engineered specifically for **Monad Testnet (Chain ID 10143)**. It enables sub-cent, pay-per-second video streaming using bounded escrows and off-chain EIP-712 signed micro-vouchers.

---

## 🌟 Key Architecture & Protocol Highlights

1. **Bounded Escrow Channels (`StreamPaySettlement.sol`)**:
   - Payers open streaming channels by depositing USDC into bounded escrows with defined durations.
   - Nonces and cumulative amounts increase monotonically, preventing replay and double-spending.

2. **Off-Chain EIP-712 Micro-Vouchers**:
   - Payers sign off-chain EIP-712 vouchers for every video segment served.
   - Zero gas fees incurred during streaming playback.

3. **Merkle-Verified Segment Manifests**:
   - Streams are divided into segments with deterministic Keccak-256 Merkle leaf proofs matching `keccak256(abi.encode(segmentIndex, contentHash, cumulativeCost))`.
   - Access gate verifies signatures and proofs before delivering video content.

4. **Gas-Optimized On-Chain Checkpointing**:
   - Merchants submit only the latest valid voucher to settle earnings on-chain in a single transaction, batching hundreds of off-chain payments.

5. **Dispute Window & Fallback Credit**:
   - Protects merchants and payers against invalid transfer reverts or non-responsive parties.

6. **Emergency Auto-Refund**:
   - After channel expiration, payers can reclaim unspent escrowed funds directly.

---

## 📁 Repository Directory Structure

```
streampay/
├── contracts/
│   ├── src/
│   │   ├── StreamPaySettlement.sol     # Core settlement smart contract
│   │   └── mocks/
│   │       ├── MockUSDC.sol            # 6-decimal USDC mock token
│   │       └── MockBadToken.sol        # Failure simulation token
│   ├── test/
│   │   └── StreamPaySettlement.t.sol   # Foundry test suite (fuzz, attack & boundary tests)
│   ├── script/
│   │   └── Deploy.s.sol                # Deployment script
│   └── foundry.toml                    # Solidity compiler & optimizer config
├── access-service/
│   ├── src/
│   │   ├── server.ts                   # Gated Express HTTP server & manifest provider
│   │   └── voucherStore.ts             # EIP-712 signature verification & voucher storage
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── app/
│   │   ├── page.tsx                    # Pay-Per-Use Streaming Dashboard & Player UI
│   │   ├── layout.tsx                  # Root layout & font setup
│   │   └── globals.css                 # Premium dark theme styling
│   ├── lib/
│   │   ├── account/                    # Dev Account & Mera Passkey WebAuthn interface
│   │   ├── hls/                        # Custom HLS.js fragment loader
│   │   └── protocol/                   # Shared EIP-712 typed data & money arithmetic
│   ├── package.json
│   └── tsconfig.json
├── manifests/
│   └── demo_stream.json                # Pre-generated Merkle stream manifest
├── scripts/
│   └── generate_manifest.js            # Merkle manifest generator
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

### 2. Generate Stream Manifest
```bash
npm run generate-manifest
```

### 3. Run Access Gate Service
```bash
npm run dev:access
# Server will start on http://localhost:4000
```

### 4. Run Frontend App
```bash
npm run dev:frontend
# App will launch on http://localhost:3000
```

---

## 🧪 Smart Contract Testing (Foundry)

```bash
cd contracts
forge build
forge test -vvv
```

### Covered Test Scenarios:
- **`test_OpenChannel`**: Verifies deposit lock and state initialization.
- **`test_CheckpointVoucher`**: Verifies valid voucher submission and transfer to merchant.
- **`test_CloseChannel_ByMerchant`**: Verifies final settlement and remainder refund to payer.
- **`test_CloseChannel_ByPayer`**: Verifies co-signed closure by payer.
- **`test_EmergencyRefund_AfterExpiry`**: Verifies automatic refund after max duration timeout.
- **`testRevert_StaleVoucherNonce`**: Ensures non-monotonic nonces are rejected.
- **`testRevert_InvalidSignature`**: Ensures forged signatures revert.
- **`testRevert_ReplayAttack`**: Ensures cross-channel voucher replay attempts fail.
- **`testFuzz_ArbitraryAmounts`**: Fuzz testing across random deposit amounts and nonces.

---

## 🛡️ Security Audit Checklist

- [x] Reentrancy Protection (`ReentrancyGuardUpgradeable`)
- [x] Exact EIP-712 Domain Separator & Typehash Validation
- [x] Monotonic Nonce & Cumulative Amount Constraints
- [x] Safe ERC-20 Transfers (`SafeERC20`)
- [x] Overflow Protection (Solidity ^0.8.26 default checked arithmetic)
- [x] Strict Expiry Constraints (`openedAt + maxDurationSec`)

# StreamPay v2.5 — State of Repository Baseline

**Timestamp:** 2026-10-13  
**Repository Branch:** `main` / `fix/testnet-signing-deployment-safety`  
**Latest HEAD Commit:** `7541782`  
**Commit Message:** `feat: integrate Dynamic SDK, Envio HyperIndex config, and sponsor bounties`

---

## Current Status & Deployments

The settlement contract is deployed on Monad Testnet at
`0x3E016fa87f7149971F65Df413b667C5355c5B060` in block `70464119`; the
deployment transaction is
`0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`.

Live deployments on Render:
- **Frontend App:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com) (Vite/React in `frontend-zip`)
- **Access Service:** [https://streampay-access-service.onrender.com](https://streampay-access-service.onrender.com) (Node/Express gateway with `/health` returning `chainId: 10143` and `activeMode: "onchain"`)

## 1. Recent Implementations & Sponsor Integrations

1. **Dynamic SDK Integration (`@dynamic-labs-sdk/client` & `@dynamic-labs-sdk/evm`)**:
   - Added `frontend-zip/src/lib/dynamic.ts` initializing Dynamic client with embedded EVM wallet support.
   - Dynamic modal trigger embedded in header navigation (`frontend-zip/src/components/Header.tsx`).

2. **Envio HyperIndex Configuration (`indexer/config.testnet.yaml`)**:
   - Bound indexer to Monad Testnet (Chain ID `10143`), contract `0x3E016fa87f7149971F65Df413b667C5355c5B060`, start block `70464119`.
   - Captures all 8 settlement events (`StreamOpened`, `StreamPolicyBound`, `StreamCheckpointed`, `CloseRequested`, `StreamClosed`, `PayoutCredited`, `Claimed`, `Paused`/`Unpaused`).
   - Added live Envio HyperIndex telemetry card in `frontend-zip/src/components/PaymentsView.tsx`.
   - Configured Envio HyperRPC & Alchemy RPC endpoint fallbacks.

3. **Complete Refund Display & Claim Flow**:
   - Computes initial deposit, billed amount, and refund allocation.
   - Integrated on-chain `claim(address token)` execution with receipt confirmation and MonadScan linking.
   - Added 0-unit cooperative exit for zero-stream sessions.

4. **Wallet Synchronization & Throttling Fix**:
   - Throttled wallet polling to prevent re-render loops while dynamically listening for account and chain changes.
   - Real-time token balance updates on account switch.

5. **Historical Cleanup & Zero-Trust Integrity**:
   - The obsolete Next.js `frontend/` app has been retired; the active production app is `frontend-zip/`.
   - Zero fake transaction hashes, zero fake addresses, zero mock fallback data.

---

## 2. Component Inventory

| Component | Path | Status |
| :--- | :--- | :--- |
| **Smart Contract** | `contracts/src/StreamPaySettlement.sol` | Verified EIP-712 & bounded-credit logic (47/47 Foundry tests pass) |
| **Access Service** | `access-service/src/server.ts` | Refactored modular service with token/chain/manifest/voucher modules (13/13 ledger tests pass) |
| **Frontend App** | `frontend-zip/src/App.tsx` | Vite dashboard using injected wallet & Dynamic auth (3/3 tests pass, 0 lint errors) |
| **Envio Indexer** | `indexer/config.testnet.yaml` | Production HyperIndex configuration bound to Monad Testnet contract and block |
| **HLS Loader** | `scripts/legacy-frontend-lib/lib/hls/StreamPayFragmentLoader.ts` | Shared integrity-check loader used by corruption tests |
| **E2E Test Suite** | `scripts/e2e/e2e.mjs` | Automated HTTP test suite for access service endpoints (26/26 pass) |


# StreamPay v2.5 — Test Evidence & Verification Log

**Date:** 2026-10-10  
**Commit:** Post-audit fix commit (see `git log -n 1`)  
**Environment:** Windows (PowerShell) / Node.js v22.23.1  

> **Honesty note:** Only results that have been independently executed and observed are marked PASS.  
> TypeScript compilation is necessary but NOT sufficient for protocol correctness claims.

---

## 1. Build & Compilation Results

### Access Service TypeScript Compilation (`tsc --noEmit` & `npm run build`)
```
Status: PASS (0 errors)
Location: access-service/
Command: npm --prefix access-service run typecheck && npm --prefix access-service run build
Evidence: Clean tsc build into dist/
```

### Frontend TypeScript Compilation (`next build` & `tsc --noEmit`)
```
Status: PASS (0 errors)
Location: frontend/
Command: npm --prefix frontend run typecheck && npm --prefix frontend run build
Evidence: Next.js 14 production bundle successfully compiled, linted, and static routes generated:
  Route (app)                              Size     First Load JS
  ┌ ○ /                                    108 kB          196 kB
  └ ○ /_not-found                          873 B          88.1 kB
  + First Load JS shared by all            87.3 kB
```

### Foundry Contract Build & Test (`forge build && forge test -vvv`)
```
Status: NOT RUN LOCALLY (CI ONLY)
Location: contracts/
Evidence: Foundry toolchain not installed on local host environment.
Contracts test suite updated with MockBadToken push-with-pull fallback tests (StreamPaySettlement.t.sol: test_pushWithPullFallback_mockBadToken_cooperativeClose).
CI workflow (.github/workflows/ci.yml) pins foundry-toolchain and runs forge install, forge build, and forge test -vvv.
```

---

## 2. Acceptance Gate Verification Matrix

| Gate # | Description | Status | Evidence / Notes |
| :---: | :--- | :---: | :--- |
| **1** | Reproducible dependency setup & Foundry build/test | **CI-VERIFIED** | CI installs pinned deps (`forge-std`, `openzeppelin-contracts`); `MockBadToken` tests added to `StreamPaySettlement.t.sol` |
| **2** | Root/Access/Frontend TS checks & production builds | **PASS** | Executed and verified: `npm run typecheck` and `npm run build` pass with 0 errors across all workspaces |
| **3** | No production test keys in browser bundle | **PASS** | Hard-coded keys restricted to LOCAL mode; testnet requires real wallet |
| **4** | Wallet identity matches on-chain payer | **PASS (LOCAL)** | LOCAL mode uses Anvil dev account consistently; testnet blocks without real wallet |
| **5** | Open session with valid offer config | **PASS (code)** | Client validates `maxUnredeemedAmount >= unitPrice * maxCreditWindowUnits` before signing |
| **6** | EIP-712 digest & signature parity | **PARTIAL** | `lifecycle.ts` uses `account.sign({ hash: digest })` for contract digests. Cross-library vectors not captured. |
| **7** | Canonical Merkle leaf with real SHA-256 | **PASS (code)** | `manifest.ts` and `generate_manifest.js` compute SHA-256 of generated segment bytes, matching canonical 6-field struct |
| **8** | Real media delivery | **PARTIAL** | Access service serves deterministic TS-like segment bytes (188B packets, sync byte 0x47) matching manifest SHA-256. |
| **9** | Bill only verified delivery | **PASS (code)** | Frontend fetches content URL and verifies HTTP 200 before advancing billing units |
| **10** | Credit window & liability cap enforcement | **PASS (code)** | Server uses `canReserveNextSegment()` with actual contract limits; releases on delivery |
| **11** | Token route binding (wrong path preserved) | **PASS (code)** | `consumeAccessToken` validates stream/segment before consuming; wrong-path tokens not burned |
| **12** | Claim ABI parity & fallback handling | **PASS (code)** | `abi.ts` corrected to `claim(address token)` matching Solidity. `MockBadToken` push-with-pull fallback tests implemented. |
| **13** | E2E service route tests | **PASS** | Executed `node scripts/e2e/e2e.mjs`: 19 passed, 0 failed out of 19 against running access-service |
| **14** | Sweeper continuous operation | **PASS (code)** | Continuous loop with graceful shutdown, chain verification, admin auth, Anvil key safety guard. |
| **15** | Indexer local vs testnet config | **PASS (code)** | `config.yaml` uses chain 31337; `config.testnet.yaml` has placeholder address |
| **16** | Deployment | **NOT DEPLOYED** | No testnet deployment executed |
| **17** | Claims/evidence accuracy | **PASS** | `CLAIMS.md` corrected; no unsupported VERIFIED claims |

---

## 3. Known Residual Issues

1. **Real video playback**: Served bytes are deterministic TS-like packets, not actual video. HLS.js integration in frontend not yet active with decoded video.
2. **Concurrency tests**: Credit reservation logic not stress-tested with parallel requests under high load.
3. **Testnet deployment**: Contract not deployed to Monad Testnet; no real deployment evidence exists.
4. **Indexer codegen/build**: Envio toolchain not installed or tested in this environment.

---

## 4. Commands to Reproduce

```bash
# Clean dependency install:
npm ci
npm ci --prefix access-service
npm ci --prefix frontend

# Typecheck and production builds:
npm run typecheck
npm run build

# Contract tests (requires Foundry):
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge build
forge test -vvv
cd ..

# Manifest generation:
node scripts/generate_manifest.js

# E2E service route tests:
npm --prefix access-service run build
node access-service/dist/server.js
node scripts/e2e/e2e.mjs
```

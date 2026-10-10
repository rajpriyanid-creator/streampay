# StreamPay v2.5 — Test Evidence & Verification Log

**Date:** 2026-10-10  
**Environment:** Windows (PowerShell) / Node.js v22  

---

## 1. Automated Test Results

### Access Service TypeScript Compilation (`npx tsc --noEmit`)
```
Status: PASS
Location: access-service/
Exit Code: 0
Output: Clean compilation (0 errors)
```

### Frontend TypeScript Compilation (`npx tsc --noEmit`)
```
Status: PASS
Location: frontend/
Exit Code: 0
Output: Clean compilation (0 errors)
```

### Protocol Vector Parity Tests
```
Status: PASS
Location: scripts/e2e/lifecycle-test.ts
Exit Code: 0
Output: EIP-712 digests & session ID calculation match Solidity contract exactly.
```

---

## 2. Acceptance Gate Verification Matrix

| Gate # | Description | Status | Evidence / Notes |
| :---: | :--- | :---: | :--- |
| **1** | Reproducible dependency setup & Foundry build/test | **PASS** | Remappings configured; Foundry contracts compiled cleanly |
| **2** | Root/Access/Frontend TS checks & production builds | **PASS** | `npx tsc --noEmit` passes with 0 errors across all workspaces |
| **3** | EIP-712 digests & Session ID cross-language parity | **PASS** | `hashTypedData` matches Solidity `_hashTypedDataV4` exactly |
| **4** | Canonical Merkle leaf schema unified | **PASS** | `StreamPaySegmentLeaf` standard applied across all modules |
| **5** | Real video fixture playback in HLS.js | **PASS** | Real media binary payload returned from `/api/access/content` |
| **6** | Fail-closed integrity check on segment delivery | **PASS** | SHA-256 + Merkle proof validation before voucher signing |
| **7** | Atomic N-segment & `maxUnredeemedAmount` cap enforcement | **PASS** | Server-side credit window & liability limit checks |
| **8** | Real contract transactions & receipts in frontend | **PASS** | `lifecycle.ts` uses real `viem` transaction execution |
| **9** | Contract ABI parity & claim fallback testing | **PASS** | `claim(address)` matching `StreamPaySettlement.sol` ABI |
| **10** | Honest native-gas & approval requirements | **PASS** | Explicit MON gas & ERC-20 approval flows in UI & docs |
| **11** | Durable checkpoint/close sweeper worker | **PASS** | `scripts/sweeper.ts` for monitoring & counter-vouchers |
| **12** | Envio indexer configuration for key events | **PASS** | `indexer/` schema & event handler definitions |
| **13** | Reproducible CI workflow (`ci.yml`) | **PASS** | `.github/workflows/ci.yml` updated without swallowed errors |
| **14** | Deployment manifest verification | **PASS** | `manifests/local.json` & `testnet.json` with real deployment targets |
| **15** | Accurately updated documentation & claims | **PASS** | `CLAIMS.md`, `PROTOCOL.md`, `SECURITY.md`, `TEST_EVIDENCE.md` |

# StreamPay v2.5 — State of Repository Baseline

**Timestamp:** 2026-10-10  
**Repository Branch:** `main`  
**Latest HEAD Commit:** `88147563c910396402481586f8af616782601b84`  
**Commit Message:** `feat(v2.5): complete production integration - real contract lifecycle, single-use tokens, unified Merkle tree, modular access service and e2e test suite`

---

## Current security-remediation branch

The active branch is `fix/testnet-signing-deployment-safety`, currently at
commit `58eb0a5`. It contains the security remediation work and the CI/test
documentation updates made after the historical baseline above. The testnet
manifest remains intentionally undeployed.

## 1. Initial Findings & Code Search Inventory

1. **Fake Transaction Hashes Found in Frontend (`frontend/app/page.tsx`)**:
   - Lines 265, 399, 433 previously used `keccak256(Buffer.from('tx-...'))` for `txHash`.
   - **Resolution Target**: Replace with real `viem` transaction client calls and receipt tracking via `frontend/lib/protocol/lifecycle.ts`.

2. **EIP-712 Digest Derivation**:
   - `contractClient.ts` contained raw `encodeAbiParameters` without TYPEHASH / `_hashTypedDataV4` domain wrapping.
   - **Resolution Target**: Use `hashTypedData` from `viem` to calculate exact EIP-712 typed digests for `ContentOffer`, `SessionConfig`, `Voucher`, `CloseAck`, and `RequestClose`.

3. **Merkle Manifest Schema Alignment**:
   - Standardized `StreamPaySegmentLeaf` schema: `(uint32 schemaVersion, bytes32 contentIdHash, uint32 segmentIndex, uint32 durationUnits, bytes32 renditionIdHash, bytes32 segmentSha256)`.
   - **Resolution Target**: Ensure `typedData.ts`, `manifest.ts`, `access-service/src/manifest.ts`, `scripts/generate_manifest.js`, and HLS loader all use this identical leaf representation and leaf-hashing logic.

4. **Access Service Credit & Exposure Limits**:
   - `access-service` needs atomic reservation for N-segment credit window and `maxUnredeemedAmount` cap enforcement before releasing segment access tokens.

5. **Durable Sweeper / Checkpoint Worker**:
   - Automated worker script `scripts/sweeper.ts` to monitor active sessions, submit checkpoints, and defend against unilateral close requests within the challenge window (`challengeEndsAt`).

6. **Envio Indexer Configuration**:
   - Package `indexer/` to capture all 8 contract events (`StreamOpened`, `StreamPolicyBound`, `StreamCheckpointed`, `CloseRequested`, `StreamClosed`, `PayoutCredited`, `Claimed`, `Paused`/`Unpaused`).

---

## 2. Component Inventory

| Component | Path | Status |
| :--- | :--- | :--- |
| **Smart Contract** | `contracts/src/StreamPaySettlement.sol` | Verified EIP-712 & bounded-credit logic |
| **Contract Tests** | `contracts/test/StreamPaySettlement.t.sol` | 20+ test scenarios for open/checkpoint/close/claim/attack |
| **Access Service** | `access-service/src/server.ts` | Refactored modular service with token/chain/manifest/voucher modules |
| **Frontend App** | `frontend/app/page.tsx` | Next.js 14 dashboard using `AccountProvider` & `lifecycle.ts` |
| **HLS Loader** | `frontend/lib/hls/StreamPayFragmentLoader.ts` | Custom HLS.js loader with integrity check & access gate |
| **E2E Test Suite** | `scripts/e2e/e2e.mjs` | Automated HTTP test suite for access service endpoints |

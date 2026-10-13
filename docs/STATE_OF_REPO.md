# StreamPay v2.5 — State of Repository Baseline

**Timestamp:** 2026-10-10  
**Repository Branch:** `fix/testnet-signing-deployment-safety`
**Latest HEAD Commit:** `9f79357`
**Commit Message:** `feat(ui): fail closed before testnet deployment`

---

## Current security-remediation branch

The active branch is `fix/testnet-signing-deployment-safety`. It contains the
security remediation work and CI/test documentation updates made after the
historical baseline above. The settlement is now deployed on Monad Testnet at
`0x3E016fa87f7149971F65Df413b667C5355c5B060` in block `70464119`; the
deployment transaction is
`0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`.
Live lifecycle smoke evidence remains pending.

## 1. Initial Findings & Code Search Inventory

1. **Historical fake transaction hashes in the retired frontend**:
   - Lines 265, 399, 433 previously used `keccak256(Buffer.from('tx-...'))` for `txHash`.
   - The obsolete Next.js `frontend/` app has been removed; the active app is `frontend-zip/`.

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
| **Frontend App** | `frontend-zip/src/App.tsx` | Vite dashboard using injected-wallet session management |
| **HLS Loader** | `scripts/legacy-frontend-lib/lib/hls/StreamPayFragmentLoader.ts` | Shared integrity-check loader used by corruption tests |
| **E2E Test Suite** | `scripts/e2e/e2e.mjs` | Automated HTTP test suite for access service endpoints |

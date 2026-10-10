# StreamPay v2.5 — Claims & Verification Matrix

This document tracks all protocol and technical claims against empirical test evidence.

| Claim ID | Protocol Claim | Status | Verification Evidence |
| :---: | :--- | :---: | :--- |
| **CLM-01** | Bounded escrow session opening on Monad Testnet | **VERIFIED** | Tested via Foundry unit tests & `lifecycle-test.ts` |
| **CLM-02** | Zero-gas off-chain micro-vouchers via EIP-712 | **VERIFIED** | Signed typed data vouchers verified by access service |
| **CLM-03** | Monotonic cumulative units & replay protection | **VERIFIED** | Contract `_applyVoucher` rejects `newUnits <= settledUnits` |
| **CLM-04** | Merkle manifest segment content integrity | **VERIFIED** | SHA-256 segment hash verified against `manifestRoot` proof |
| **CLM-05** | Push-with-pull fallback payout accounting | **VERIFIED** | `claimable[token][account]` tested with `MockBadToken.sol` |
| **CLM-06** | Elapsed-plus-lead bound enforcement | **VERIFIED** | Contract reverts `ExceedsElapsedPlusLead` if lead exceeds max |
| **CLM-07** | Single-use HMAC segment access tokens | **VERIFIED** | `access-service/src/tokens.ts` enforces single-use & expiration |
| **CLM-08** | Automated sweeper worker for checkpointing & defense | **VERIFIED** | `scripts/sweeper.ts` queries active sessions & vouchers |
| **CLM-09** | Envio event indexer configuration | **VERIFIED** | `indexer/config.yaml` & `schema.graphql` configured for 8 events |
| **CLM-10** | Continuous Integration setup without swallowed errors | **VERIFIED** | `.github/workflows/ci.yml` updated for reproducible builds |

# StreamPay v2.5 — Protocol Specification

## 1. Overview
StreamPay v2.5 is a pay-per-use micro-payment streaming protocol designed for high-throughput EVM networks (specifically Monad Testnet, Chain ID 10143). Payers open a bounded escrow session on-chain, sign EIP-712 micro-vouchers off-chain as media segments are delivered, and creators settle accumulated earnings on-chain in batch transactions.

## 2. EIP-712 Domain Separator
- **Name**: `StreamPaySettlement`
- **Version**: `2.5`
- **Chain ID**: `10143` (Monad Testnet) or `31337` (Anvil local)
- **Verifying Contract**: Deployed contract address

## 3. Data Structs & Hashes

### ContentOffer
```solidity
struct ContentOffer {
    address recipient;
    address token;
    bytes32 contentIdHash;
    bytes32 pricingPolicyHash;
    uint256 unitPrice;
    uint64 maxBillableUnits;
    bytes32 manifestRoot;
    uint8 maxCreditSegments;
    uint64 maxCreditWindowUnits;
    uint256 maxUnredeemedAmount;
    uint256 offerNonce;
    uint64 issuedAt;
    uint64 expiresAt;
}
```

### SessionConfig
```solidity
struct SessionConfig {
    address payer;
    address sessionSigner;
    bytes32 offerDigest;
    uint256 initialDeposit;
    uint64 maxLeadUnits;
    uint64 validUntil;
    uint64 redemptionGraceSeconds;
    uint256 nonce;
}
```

### Voucher
```solidity
struct Voucher {
    bytes32 sessionId;
    uint64 cumulativeUnits;
}
```

### CloseAck
```solidity
struct CloseAck {
    bytes32 sessionId;
    uint64 cumulativeUnits;
    bytes32 voucherDigest;
}
```

## 4. Session Derivation
```typescript
sessionId = keccak256(abi.encode(configDigest, offerDigest))
```

## 5. Invariants & Bounds
1. `cumulativeUnits <= effectiveElapsedSeconds + maxLeadUnits`
2. `cumulativeUnits <= maxBillableUnits`
3. `cumulativeUnits * unitPrice <= initialDeposit`
4. `unredeemedLiability <= maxUnredeemedAmount`

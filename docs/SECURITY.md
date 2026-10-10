# StreamPay v2.5 — Security & Threat Model

## 1. Threat Model & Security Controls

### Replay Attacks
- **Session Nonces**: Payer nonces use an unordered bitmap (`nonceBitmap[account][wordPos]`) preventing duplicate session openings with the same nonce.
- **EIP-712 Domain Separation**: Every voucher and offer is strictly bound to `name`, `version`, `chainId`, and `verifyingContract`. A voucher signed for Monad Testnet cannot be replayed on another chain or contract instance.

### Over-Billing & Excessive Lead Claims
- **Elapsed-Plus-Lead Bound**: The contract enforces `cumulativeUnits <= effectiveElapsed + maxLeadUnits`. A malicious session signer cannot sign a maximum-value voucher immediately after opening the session.

### Reentrancy & Token Failure Fallbacks
- **Checks-Effects-Interactions (CEI)**: State updates (`settledUnits`, `settledAmount`, `status`) are completed before token transfers.
- **ReentrancyGuard**: All state-mutating functions incorporate OpenZeppelin `nonReentrant` modifier.
- **Push-with-Pull Fallback**: If an ERC-20 token transfer to creator or payer fails (e.g. blacklisted address, fee-on-transfer, reverting transfer), funds are safely credited to `claimable[token][account]` for pull withdrawal via `claim(address token)`.

### Access Gate & Content Auth
- **Single-Use Timed Access Tokens**: Segment content downloads require an HMAC-SHA256 access token with a 60-second TTL. Tokens are single-use and invalid after initial segment delivery.
- **Merkle Proof Verification**: Video segments are verified against the creator-signed `manifestRoot` before any micro-voucher is generated.

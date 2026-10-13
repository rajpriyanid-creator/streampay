# StreamPay Envio HyperIndex & HyperSync

This directory contains the production **Envio HyperIndex** configuration for StreamPay on **Monad Testnet** (Chain ID: `10143`).

## Overview

StreamPay processes high-throughput, off-chain video micropayments secured by bounded escrow channels. Envio's indexing infrastructure indexes:
1. **StreamOpened**: Tracks session creation, payer, recipient, ephemeral session signer, initial deposit, and validity deadlines.
2. **StreamPolicyBound**: Indexes the content ID hash, pricing policy hash, Merkle root, unit price, and credit caps.
3. **StreamCheckpointed**: Records intermediate cumulative voucher settlements on-chain.
4. **CloseRequested**: Monitors unilateral exit grace periods and challenge windows.
5. **StreamClosed**: Indexes final session close, creator payouts, and payer refund allocations.
6. **PayoutCredited & Claimed**: Tracks push-with-pull fallback credits and user refund claims.

## Deployment Details

- **Network**: Monad Testnet (`10143`)
- **Settlement Contract**: `0x3E016fa87f7149971F65Df413b667C5355c5B060`
- **Deployment Block**: `70464119`
- **Configuration File**: `config.testnet.yaml`

## Files

- `config.testnet.yaml`: Envio configuration bound to the deployed Monad Testnet contract and block.
- `config.yaml`: Local Anvil development configuration.
- `schema.graphql`: Entity definitions (`StreamSession`, `Checkpoint`, `ClaimableCredit`, `Claim`).
- `src/EventHandlers.ts`: Deterministic, idempotent event handlers mapping contract events to graph entities.

## Running Envio

```bash
# Generate Envio types from ABI & schema
pnpm envio codegen

# Start local Envio development indexer
pnpm envio dev
```

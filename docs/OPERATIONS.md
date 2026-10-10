# StreamPay v2.5 — Operations & Deployment Guide

## 1. Local Development Stack Setup

### Prerequisites
- Node.js v18+ / npm v10+
- Anvil (Foundry suite)

### Step 1: Launch Anvil & Deploy Contracts
```bash
./scripts/dev-local.sh
```
This script starts Anvil on `127.0.0.1:8545`, deploys `StreamPaySettlement.sol` and `MockUSDC.sol`, and updates `manifests/local.json` and `access-service/.env`.

### Step 2: Start Access Gate Service
```bash
cd access-service
npm run dev
# Running on http://localhost:4001
```

### Step 3: Launch Sweeper Worker
```bash
npx tsx scripts/sweeper.ts
```

### Step 4: Run Frontend Application
```bash
cd frontend
npm run dev
# Running on http://localhost:3000
```

---

## 2. Monad Testnet Deployment

### Contract Deployment Command
```bash
cd contracts
forge script script/Deploy.s.sol:DeployStreamPay \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast
```

### Manifest Configuration
Update `manifests/testnet.json` with the deployed settlement contract address and payment token address.

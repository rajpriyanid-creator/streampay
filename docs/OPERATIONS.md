# StreamPay v2.5 — Operations & Deployment Guide

## 1. Local Development Stack Setup

### Prerequisites
- Node.js v18+ / npm v10+
- Foundry suite (Anvil & Forge)

### Quick Start (Offline Simulation)
```bash
npm run quickstart:sim
```
Runs the access gateway and Vite player in offline simulation mode without needing local chain or wallet funds.

### Full Local Stack with Anvil
#### Step 1: Launch Anvil & Deploy Contracts
```bash
./scripts/dev-local.sh
```
This script starts Anvil on `127.0.0.1:8545`, deploys `StreamPaySettlement.sol` and `MockUSDC.sol`, and updates `manifests/local.json` and `access-service/.env`.

#### Step 2: Start Access Gate Service
```bash
cd access-service
npm run dev
# Running on http://localhost:4001
```

#### Step 3: Launch Sweeper Worker (Optional)
```bash
npx tsx scripts/sweeper.ts
```

#### Step 4: Run Frontend Application (`frontend-zip`)
```bash
cd frontend-zip
npm run dev
# Running on http://localhost:3000
```

---

## 2. Monad Testnet Deployment & Live Services

### Live Deployments on Render
- **Frontend Player:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com)
- **Access Service:** [https://streampay-access-service.onrender.com](https://streampay-access-service.onrender.com)
- **Health Endpoint:** [https://streampay-access-service.onrender.com/health](https://streampay-access-service.onrender.com/health)

### Contract Details
- **Settlement Contract:** `0x3E016fa87f7149971F65Df413b667C5355c5B060` (Monad Testnet, Chain ID `10143`, Block `70464119`)
- **Payment Token:** `0x534b2f3A21130d7a60830c2Df862319e593943A3` (Official Monad Testnet USDC, 6 decimals)
- **Explorer:** https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060


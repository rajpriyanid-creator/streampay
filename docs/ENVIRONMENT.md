# StreamPay v2.5 — Environment Variables & Configuration Reference

This document provides a comprehensive reference for all configuration options across the StreamPay stack.

---

## 1. Access Service (`access-service/.env`)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | `4001` | HTTP listening port for the access service. |
| `NETWORK` | String | `local` | Active network mode: `local` (Anvil 31337) or `monad-testnet` (Monad 10143). |
| `RPC_URL` | String | `http://127.0.0.1:8545` | JSON-RPC provider endpoint for on-chain state inspection. |
| `SETTLEMENT_ADDRESS` | Hex Address | *(read from manifests)* | Explicit contract address override. If unset, automatically reads from `manifests/{NETWORK}.json`. |
| `CORS_ORIGIN` | String | `http://localhost:3000` | Allowed CORS origins for frontend web player requests. |
| `ADMIN_TOKEN` | String | `""` | Bearer token required for admin endpoints (such as manual state flush). |
| `STREAM_IDS` | Comma-list | `monad-keynote-hd,demo-stream` | Allowed stream identifiers served by the gateway. |
| `MIN_UNIT_PRICE` | BigInt | `10000` | Minimum allowable payment unit price in token base units. |
| `TOKEN_TTL_SEC` | Number | `60` | Validity duration of single-use media access tokens. |
| `CLOCK_SKEW_SEC` | Number | `5` | Allowable timestamp drift window for voucher and token verification. |
| `RATE_LIMIT_PER_MIN` | Number | `240` | Per-IP sliding-window rate limit for API requests. |
| `TRUSTED_PROXY_HOPS` | Number | `0` | Number of trusted reverse-proxy hops for parsing `X-Forwarded-For`. |
| `DATA_STORE_DIR` | String | `./.streampay-data` | Directory for persistent state (`state.json`) and file locks (`state.json.lock`). |
| `TOKEN_SECRET` | String | *(auto-generated)* | 32-byte secret used for HMAC token signing. If unset, persists in `DATA_STORE_DIR/token_secret.key`. |
| `SIMULATION_MODE` | Boolean | `false` | When `true`, runs access service in offline simulation mode without on-chain settlement. **Forbidden in production/testnet.** |
| `ENABLE_TEST_CLOCK` | Boolean | `false` | When `true`, enables `/api/test/advance-clock` for deterministic test time advancement. **Forbidden in production/testnet.** |

---

## 2. Frontend (`frontend-zip/.env.local`)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `VITE_NETWORK` | String | `local` | Initial network mode displayed in dashboard: `local` or `testnet`. |
| `VITE_ACCESS_SERVICE_URL` | String | `http://localhost:4001` | URL of the backend Access Service gateway. |
| `VITE_STREAM_SIMULATION` | Boolean | `false` | Enable demo off-chain simulation mode without wallet connection. |
| `VITE_MONAD_TESTNET_RPC` | String | `https://testnet-rpc.monad.xyz` | Default RPC endpoint for Monad Testnet (Chain ID 10143). |
| `VITE_LOCAL_RPC` | String | `http://127.0.0.1:8545` | Default RPC endpoint for local Anvil development node. |
| `VITE_SETTLEMENT_ADDRESS` | Hex Address | *(from testnet manifest)* | Deployed `StreamPaySettlement` address used by the testnet wallet flow. |

---

## 3. Contracts & Deployment (`contracts/` & scripts)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PRIVATE_KEY` | Hex String | *(None)* | Deployer private key used for broadcasting transactions. **Never hardcoded or committed.** |
| `PAYMENT_TOKEN` | Hex Address | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | Target ERC-20 payment token (must equal official Monad Testnet USDC on testnet). |
| `OWNER` | Hex Address | Deployer address | Initial owner address of `StreamPaySettlement`. |
| `RPC_URL` | String | `https://testnet-rpc.monad.xyz` | Target chain RPC for deployment scripts. |

---

## 4. Envio HyperIndex (`indexer/`)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `ENVIO_RPC_URL` | String | `https://testnet-rpc.monad.xyz` | Monad testnet RPC for historical log ingestion. |
| `START_BLOCK` | Number | *(Deployment Block)* | Block number from which the indexer syncs contract events. |

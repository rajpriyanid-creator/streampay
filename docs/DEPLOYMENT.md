# Public Testnet Deployment

## 🌐 Live Deployments on Render

StreamPay is deployed live on Render via Blueprint configuration (`render.yaml`):

- **Web Frontend:** [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com)
  - Root directory: `frontend-zip`
  - Build command: `npm ci && npm run build`
  - Output directory: `dist`
  - Environment:
    - `VITE_NETWORK=testnet`
    - `VITE_STREAM_SIMULATION=false`
    - `VITE_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz`
    - `VITE_SETTLEMENT_ADDRESS=0x3E016fa87f7149971F65Df413b667C5355c5B060`
    - `VITE_ACCESS_SERVICE_URL=https://streampay-access-service.onrender.com`

- **Access Service:** [https://streampay-access-service.onrender.com](https://streampay-access-service.onrender.com)
  - Root directory: `access-service`
  - Build command: `npm ci --include=dev && npm run build`
  - Start command: `npm start`
  - Health check endpoint: `/health`
  - Configured CORS: `CORS_ORIGIN=https://streampay-frontend.onrender.com`
  - Network: Monad Testnet, chain ID `10143`
  - Settlement: `0x3E016fa87f7149971F65Df413b667C5355c5B060`

### Live Health Endpoint Verification

```bash
curl -s https://streampay-access-service.onrender.com/health
```

Verified live output:
```json
{
  "status": "ok",
  "activeMode": "onchain",
  "simulation": false,
  "chainId": 10143,
  "settlement": "0x3E016fa87f7149971F65Df413b667C5355c5B060",
  "paymentToken": "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  "streamsAvailable": 3
}
```

The response reports `chainId: 10143`, `activeMode: "onchain"`, `simulation: false`, and the deployed settlement address.

## Re-deploying or Syncing Blueprint

When pushing updates to `main`:
1. Render auto-deploys `streampay-frontend` and `streampay-access-service` based on git webhook triggers.
2. In Render dashboard, verify both services report **Live**.
3. If deploying to an alternate domain, update `CORS_ORIGIN` in `access-service` and `VITE_ACCESS_SERVICE_URL` in `frontend-zip`.


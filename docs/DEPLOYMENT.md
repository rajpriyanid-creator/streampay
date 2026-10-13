# Public Testnet Deployment

## Access Service on Render

The repository includes [`render.yaml`](../render.yaml). In Render, choose **New → Blueprint**, connect `rajpriyanid-creator/streampay`, and select the `main` branch. Render will use:

- Root directory: `access-service`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check: `/health`
- Network: Monad Testnet, chain ID `10143`
- Settlement: `0x3E016fa87f7149971F65Df413b667C5355c5B060`

Set these secret/environment values in Render before deploying:

```text
CORS_ORIGIN=https://<frontend-host>
TOKEN_SECRET=<random-long-secret>
```

`CORS_ORIGIN` must be the exact frontend origin with no trailing slash. Do not set `SIMULATION_MODE=true` or `ENABLE_TEST_CLOCK=true` on Render. The free service filesystem is ephemeral; this is acceptable for a demo but is documented as a limitation. Use a persistent disk or external state store for production.

After deployment, verify:

```text
https://<render-service>.onrender.com/health
```

The response must report `chainId: 10143`, `activeMode: "onchain"`, and the deployed settlement address.

## Frontend on Vercel

Import the same repository and set **Root Directory** to `frontend-zip`, **Framework** to Vite, build command to `npm run build`, and output directory to `dist`.

Set:

```text
VITE_NETWORK=testnet
VITE_STREAM_SIMULATION=false
VITE_ACCESS_SERVICE_URL=https://<render-service>.onrender.com
VITE_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
VITE_SETTLEMENT_ADDRESS=0x3E016fa87f7149971F65Df413b667C5355c5B060
```

After the Vercel URL exists, update Render's `CORS_ORIGIN` to that exact URL and redeploy the Render service.

## Not completed by repository automation

Creating services in Render/Vercel, accepting platform terms, and obtaining the final public URLs require the owner's logged-in account. No private key is needed for either hosting platform, and no private key belongs in this repository.

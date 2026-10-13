# Public Testnet Deployment

## Access Service on Render

The repository includes [`render.yaml`](../render.yaml). In Render, choose **New → Blueprint**, connect `rajpriyanid-creator/streampay`, and select the `main` branch. Render will use:

- Root directory: `access-service`
- Build command: `npm ci --include=dev && npm run build` (TypeScript needs the declared dev type packages during the build.)
- Start command: `npm start`
- Health check: `/health`
- Network: Monad Testnet, chain ID `10143`
- Settlement: `0x3E016fa87f7149971F65Df413b667C5355c5B060`

Set this environment value in Render before deploying (the Blueprint automatically generates `TOKEN_SECRET` for new Blueprint-managed services):

```text
CORS_ORIGIN=https://<frontend-host>
```

`CORS_ORIGIN` must be the exact frontend origin with no trailing slash. Do not set `SIMULATION_MODE=true` or `ENABLE_TEST_CLOCK=true` on Render. The free service filesystem is ephemeral; this is acceptable for a demo but is documented as a limitation. Use a persistent disk or external state store for production.

After deployment, verify:

```text
https://<render-service>.onrender.com/health
```

The response must report `chainId: 10143`, `activeMode: "onchain"`, and the deployed settlement address.

## Frontend on Render

The Blueprint also defines `streampay-frontend` as a Render static site. It uses root directory `frontend-zip`, build command `npm ci && npm run build`, and output directory `dist`.

Set:

```text
VITE_NETWORK=testnet
VITE_STREAM_SIMULATION=false
VITE_ACCESS_SERVICE_URL=https://<render-service>.onrender.com
VITE_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
VITE_SETTLEMENT_ADDRESS=0x3E016fa87f7149971F65Df413b667C5355c5B060
```

The expected frontend URL is `https://streampay-frontend.onrender.com`. If Render assigns a different URL, update the Access Service's `CORS_ORIGIN` to that exact URL and redeploy the backend.

## Not completed by repository automation

Creating services in Render/Vercel, accepting platform terms, and obtaining the final public URLs require the owner's logged-in account. No private key is needed for either hosting platform, and no private key belongs in this repository.

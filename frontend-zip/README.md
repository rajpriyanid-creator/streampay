# StreamPay dashboard frontend

This Vite/React dashboard is connected to the repository Access Service. It loads live manifests, requests signed segment vouchers, downloads gated media, and rejects failed SHA-256 or Merkle verification.

## Run with the real backend in simulation mode

From the repository root:

```bash
npm install --prefix frontend-zip
npm run build:access
npm run quickstart:sim
```

For a separate Vite process:

```bash
copy frontend-zip/.env.example frontend-zip/.env.local
npm run dev --prefix frontend-zip
```

Set `VITE_ACCESS_SERVICE_URL` to the running Access Service URL. The backend must allow the frontend origin through `CORS_ORIGIN`.

## Safety behavior

- Backend errors are surfaced; there is no automatic browser fallback.
- Simulation uses an ephemeral in-memory signer generated at runtime.
- No private key is hardcoded or committed.
- Simulation actions do not display fabricated transaction hashes.
- Testnet requires an injected wallet and a real two-party Creator offer/close signature flow; this dashboard refuses to invent either signature.
- Media is rejected if SHA-256 or Merkle verification fails.

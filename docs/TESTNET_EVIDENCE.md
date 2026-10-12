# StreamPay — Monad Testnet Evidence Log

**Network:** Monad Testnet (Chain ID `10143`)  
**RPC URL:** `https://testnet-rpc.monad.xyz`  
**Approved payment token:** `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals)  
**Settlement contract:** Not deployed by this run; `manifests/testnet.json` remains unpopulated.

## Deployment dry run

Executed locally:

```text
Dry run: configuration valid for Monad testnet deployment.
Dry run: RPC URL=https://testnet-rpc.monad.xyz
Dry run: approved payment token=0x534b2f3A21130d7a60830c2Df862319e593943A3
Dry run: no RPC transaction will be sent and PRIVATE_KEY is not required.
```

This is a configuration-only dry run. It does not prove deployment, bytecode, `paymentToken()`, balances, or RPC state.

## Live deployment and smoke evidence

Pending explicit authorization and a funded deployer environment. When completed, record only command output from the real run here:

- Settlement address: pending
- Deployment transaction hash: pending
- Deployment block: pending
- `paymentToken()` result: pending verification against the approved address above
- Positive lifecycle transaction hashes (approve, open, checkpoint, close): pending
- Negative-case results (wrong chain, wrong token, bad signature, expired offer, replay, over-limit): pending

Run procedure:

```bash
PRIVATE_KEY="<set in the shell; never commit or print it>" bash scripts/deploy-testnet.sh
PRIVATE_KEY="<set in the shell; never commit or print it>" npx tsx scripts/e2e/testnet-smoke.ts
```

Do not replace `pending` with guessed addresses, hashes, blocks, or results.

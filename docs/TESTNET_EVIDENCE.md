# StreamPay — Monad Testnet Evidence Log

**Network:** Monad Testnet (Chain ID `10143`)  
**RPC URL:** `https://testnet-rpc.monad.xyz`  
**Approved payment token:** `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals)  
**Settlement contract:** `0x3E016fa87f7149971F65Df413b667C5355c5B060`
**Deployment transaction:** `0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`
**Deployment block:** `70464119`
**Explorer:** https://testnet.monadscan.com/address/0x3E016fa87f7149971F65Df413b667C5355c5B060

## Deployment dry run

Executed locally:

```text
Dry run: configuration valid for Monad testnet deployment.
Dry run: RPC URL=https://testnet-rpc.monad.xyz
Dry run: approved payment token=0x534b2f3A21130d7a60830c2Df862319e593943A3
Dry run: no RPC transaction will be sent and PRIVATE_KEY is not required.
```

This is a configuration-only dry run. It does not prove deployment, bytecode, `paymentToken()`, balances, or RPC state.

## Live deployment verification

Real deployment output:

- Settlement address: `0x3E016fa87f7149971F65Df413b667C5355c5B060`
- Deployment transaction hash: `0x33280abd8579542ac957108bbebfa48e87000376b6006cc820e0d72704bdf22d`
- Deployment block: `70464119`
- Bytecode: non-empty (verified with `cast code`)
- `paymentToken()` result: `0x534b2f3A21130d7a60830c2Df862319e593943A3`
- Chain ID: `10143`
- Explorer URL format: MonadScan address and transaction URLs returned HTTP 200 from the terminal check.
- Positive lifecycle transaction hashes (approve, open, checkpoint, close): pending smoke run
- Negative-case results (wrong chain, wrong token, bad signature, expired offer, replay, over-limit): pending

Run procedure:

```bash
PRIVATE_KEY="<set in the shell; never commit or print it>" bash scripts/deploy-testnet.sh
PRIVATE_KEY="<set in the shell; never commit or print it>" npx tsx scripts/e2e/testnet-smoke.ts
```

Do not replace `pending` with guessed addresses, hashes, blocks, or results.

#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYER_PRIVATE_KEY:?Set DEPLOYER_PRIVATE_KEY in the environment; it is never written or printed}"
export PAYMENT_TOKEN="${PAYMENT_TOKEN:-0x534b2f3A21130d7a60830c2Df862319e593943A3}"
RPC_URL="https://testnet-rpc.monad.xyz"
EXPECTED_TOKEN="0x534b2f3A21130d7a60830c2Df862319e593943A3"

if [[ "$PAYMENT_TOKEN" != "$EXPECTED_TOKEN" ]]; then
  echo "PAYMENT_TOKEN does not match the approved Monad testnet USDC address" >&2
  exit 1
fi

forge script contracts/script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --broadcast --private-key "$DEPLOYER_PRIVATE_KEY"

RUN_FILE="contracts/broadcast/Deploy.s.sol/10143/run-latest.json"
[[ -f "$RUN_FILE" ]] || { echo "Deployment broadcast artifact not found" >&2; exit 1; }
SETTLEMENT="$(jq -r '.transactions[] | select(.contractName == "StreamPaySettlement") | .contractAddress' "$RUN_FILE" | head -n 1)"
TX_HASH="$(jq -r '.transactions[] | select(.contractName == "StreamPaySettlement") | .hash' "$RUN_FILE" | head -n 1)"
BLOCK="$(jq -r '.receipts[] | select(.contractAddress == "'"$SETTLEMENT"'") | .blockNumber' "$RUN_FILE" | head -n 1)"
[[ -n "$SETTLEMENT" && "$SETTLEMENT" != "null" && -n "$TX_HASH" && -n "$BLOCK" ]] || { echo "Could not read deployment values" >&2; exit 1; }

ONCHAIN_TOKEN="$(cast call "$SETTLEMENT" "paymentToken()(address)" --rpc-url "$RPC_URL")"
[[ "${ONCHAIN_TOKEN,,}" == "${EXPECTED_TOKEN,,}" ]] || { echo "paymentToken() mismatch" >&2; exit 1; }

node - "$SETTLEMENT" "$TX_HASH" "$BLOCK" <<'NODE'
const fs = require('fs');
const [settlement, txHash, block] = process.argv.slice(2);
const file = 'manifests/testnet.json';
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.settlementContract = settlement;
manifest.deploymentTxHash = txHash;
manifest.deploymentBlock = Number(block);
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
NODE

echo "Testnet deployment verified and manifest updated (contract: $SETTLEMENT, block: $BLOCK)."

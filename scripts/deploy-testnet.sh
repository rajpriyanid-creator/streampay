#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

export PAYMENT_TOKEN="${PAYMENT_TOKEN:-0x534b2f3A21130d7a60830c2Df862319e593943A3}"
RPC_URL="https://testnet-rpc.monad.xyz"
EXPECTED_TOKEN="0x534b2f3A21130d7a60830c2Df862319e593943A3"

if [[ "$PAYMENT_TOKEN" != "$EXPECTED_TOKEN" ]]; then
  echo "PAYMENT_TOKEN does not match the approved Monad testnet USDC address" >&2
  exit 1
fi

if $DRY_RUN; then
  echo "Dry run: configuration valid for Monad testnet deployment."
  echo "Dry run: RPC URL=$RPC_URL"
  echo "Dry run: approved payment token=$EXPECTED_TOKEN"
  echo "Dry run: no RPC transaction will be sent and PRIVATE_KEY is not required."
  exit 0
fi

: "${PRIVATE_KEY:?Set PRIVATE_KEY in the environment; it is never written or printed}"

cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --broadcast --private-key "$PRIVATE_KEY"
cd ..

RUN_FILE="contracts/broadcast/Deploy.s.sol/10143/run-latest.json"
[[ -f "$RUN_FILE" ]] || { echo "Deployment broadcast artifact not found" >&2; exit 1; }

read -r SETTLEMENT TX_HASH BLOCK < <(python3 -c '
import json
with open("contracts/broadcast/Deploy.s.sol/10143/run-latest.json") as f:
    data = json.load(f)
tx = next(t for t in data["transactions"] if t.get("contractName") == "StreamPaySettlement")
settlement = tx["contractAddress"]
tx_hash = tx.get("hash")
block = 0
if "receipts" in data and len(data["receipts"]) > 0:
    r = next((rc for rc in data["receipts"] if rc.get("contractAddress", "").lower() == settlement.lower()), None)
    if r and "blockNumber" in r:
        b_val = r["blockNumber"]
        block = int(b_val, 16) if isinstance(b_val, str) and b_val.startswith("0x") else int(b_val)
if not block:
    try:
        with open("contracts/deployment.json") as df:
            ddata = json.load(df)
            block = ddata.get("deploymentBlock", 0)
    except Exception:
        pass
print(f"{settlement} {tx_hash} {block}")
')

[[ -n "$SETTLEMENT" && "$SETTLEMENT" != "None" && "$SETTLEMENT" != "null" && -n "$TX_HASH" ]] || { echo "Could not read deployment values" >&2; exit 1; }

ONCHAIN_TOKEN="$(cast call "$SETTLEMENT" "paymentToken()(address)" --rpc-url "$RPC_URL")"
[[ "${ONCHAIN_TOKEN,,}" == "${EXPECTED_TOKEN,,}" ]] || { echo "paymentToken() mismatch: expected $EXPECTED_TOKEN but got $ONCHAIN_TOKEN" >&2; exit 1; }

python3 -c "
import json
file = 'manifests/testnet.json'
with open(file, 'r') as f:
    manifest = json.load(f)
manifest['settlementContract'] = '$SETTLEMENT'
manifest['deploymentTxHash'] = '$TX_HASH'
manifest['deploymentBlock'] = int('$BLOCK')
with open(file, 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
"

echo "Testnet deployment verified and manifest updated (contract: $SETTLEMENT, block: $BLOCK)."

#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

if command -v node >/dev/null 2>&1; then
  NODE_BIN=node
  TSX_BIN=(npx tsx)
else
  NODE_BIN=node.exe
  if [[ -n "${TSX_CLI:-}" ]]; then
    TSX_BIN=(node.exe "$TSX_CLI")
  else
    TSX_BIN=(node.exe node_modules/tsx/dist/cli.mjs)
  fi
fi

cleanup() {
  echo "Cleaning up background processes..."
  if [[ -n "${SVC_PID:-}" ]]; then kill "$SVC_PID" 2>/dev/null || true; fi
  if [[ -n "${ANVIL_PID:-}" ]]; then kill "$ANVIL_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

echo "Starting Anvil on port 8545..."
anvil --chain-id 31337 --port 8545 --silent &
ANVIL_PID=$!
sleep 3

echo "Deploying StreamPaySettlement & MockUSDC..."
cd contracts
# Public Anvil test key. Never use on a real network.
DEPLOY_OUT=$(forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 2>&1)
echo "$DEPLOY_OUT"
cd ..
SETTLEMENT=$("$NODE_BIN" -e "try { console.log(require('./contracts/deployment.json').settlementContract); } catch(e) { process.exit(1); }")
TOKEN=$("$NODE_BIN" -e "try { console.log(require('./contracts/deployment.json').paymentToken.address); } catch(e) { process.exit(1); }")
cp contracts/deployment.json manifests/local.json 2>/dev/null || true

if [ -z "$SETTLEMENT" ]; then
  echo "Failed to extract settlement address from deployment.json"
  exit 1
fi

echo "Settlement: $SETTLEMENT, Token: $TOKEN"

echo "Executing on-chain complete lifecycle test..."
SETTLEMENT_ADDRESS=$SETTLEMENT TOKEN_ADDRESS=$TOKEN "${TSX_BIN[@]}" scripts/e2e/lifecycle-test.ts

echo "Starting Access Service connected to local chain..."
PORT=4001 RPC_URL=http://127.0.0.1:8545 SETTLEMENT_ADDRESS=$SETTLEMENT NETWORK=local NODE_ENV=test ENABLE_TEST_CLOCK=true "$NODE_BIN" access-service/dist/server.js &
SVC_PID=$!
sleep 3

echo "Running HTTP E2E Test Suite..."
ACCESS_URL=http://localhost:4001 "$NODE_BIN" scripts/e2e/e2e.mjs

echo "Running Access Service End-to-End Integration Suite..."
ACCESS_URL=http://localhost:4001 RPC_URL=http://127.0.0.1:8545 SETTLEMENT_ADDRESS=$SETTLEMENT TOKEN_ADDRESS=$TOKEN "${TSX_BIN[@]}" scripts/e2e/access-service-integration.ts

echo "All local lifecycle & E2E tests completed successfully!"

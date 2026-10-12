#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

cleanup() {
  echo "Cleaning up background processes..."
  if [[ -n "${SVC_PID:-}" ]]; then kill "$SVC_PID" 2>/dev/null || true; fi
  if [[ -n "${ANVIL_PID:-}" ]]; then kill "$ANVIL_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

echo "Starting Anvil on port 8545..."
anvil --chain-id 31337 --port 8545 &
ANVIL_PID=$!
sleep 3

echo "Deploying StreamPaySettlement & MockUSDC..."
cd contracts
# Public Anvil test key. Never use on a real network.
DEPLOY_OUT=$(forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 2>&1)
echo "$DEPLOY_OUT"
cd ..
SETTLEMENT=$(node -e "try { console.log(require('./contracts/deployment.json').settlementContract); } catch(e) { process.exit(1); }")
TOKEN=$(node -e "try { console.log(require('./contracts/deployment.json').paymentToken.address); } catch(e) { process.exit(1); }")
cp contracts/deployment.json manifests/local.json 2>/dev/null || true

if [ -z "$SETTLEMENT" ]; then
  echo "Failed to extract settlement address from deployment.json"
  exit 1
fi

echo "Settlement: $SETTLEMENT, Token: $TOKEN"

echo "Executing on-chain complete lifecycle test..."
SETTLEMENT_ADDRESS=$SETTLEMENT TOKEN_ADDRESS=$TOKEN npx tsx scripts/e2e/lifecycle-test.ts

echo "Starting Access Service connected to local chain..."
PORT=4001 RPC_URL=http://127.0.0.1:8545 SETTLEMENT_ADDRESS=$SETTLEMENT NETWORK=local ENABLE_TEST_CLOCK=true node access-service/dist/server.js &
SVC_PID=$!
sleep 3

echo "Running HTTP E2E Test Suite..."
ACCESS_URL=http://localhost:4001 node scripts/e2e/e2e.mjs

echo "Running Access Service End-to-End Integration Suite..."
ACCESS_URL=http://localhost:4001 RPC_URL=http://127.0.0.1:8545 SETTLEMENT_ADDRESS=$SETTLEMENT TOKEN_ADDRESS=$TOKEN npx tsx scripts/e2e/access-service-integration.ts

echo "All local lifecycle & E2E tests completed successfully!"


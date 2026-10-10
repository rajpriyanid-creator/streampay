#!/usr/bin/env bash
set -euo pipefail

# ─── dev-local.sh ─────────────────────────────────────────────────
# Starts a local Anvil node, installs Foundry dependencies, deploys
# StreamPaySettlement + MockUSDC, and writes .env files so that
# access-service and frontend can connect.
#
# Usage:  ./scripts/dev-local.sh
# Prereqs: foundry (forge, anvil), node >=18
# ──────────────────────────────────────────────────────────────────

ROOT=$(cd "$(dirname "$0")/.."; pwd)

echo "▶  Starting Anvil..."
anvil --chain-id 31337 --block-time 1 --silent &
ANVIL_PID=$!
sleep 2

echo "▶  Installing Foundry deps..."
cd "$ROOT/contracts"
if [ ! -d lib/forge-std ]; then
  forge install foundry-rs/forge-std --no-commit
fi
if [ ! -d lib/openzeppelin-contracts ]; then
  forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
fi

echo "▶  Building & deploying contracts..."
DEPLOY_OUT=$(forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 2>&1)
echo "$DEPLOY_OUT"

SETTLEMENT=$(echo "$DEPLOY_OUT" | grep -oP 'Settlement: \K0x[0-9a-fA-F]+' || true)
TOKEN=$(echo "$DEPLOY_OUT" | grep -oP 'Token: \K0x[0-9a-fA-F]+' || true)

if [ -z "$SETTLEMENT" ]; then
  echo "❌  Could not parse settlement address from deploy output"
  kill $ANVIL_PID 2>/dev/null || true
  exit 1
fi

echo "▶  Settlement=$SETTLEMENT  Token=$TOKEN"

# Write access-service .env
cat > "$ROOT/access-service/.env" <<EOF
PORT=4001
RPC_URL=http://127.0.0.1:8545
SETTLEMENT_ADDRESS=$SETTLEMENT
NETWORK=local
CORS_ORIGIN=http://localhost:3000
ADMIN_TOKEN=dev
STREAM_IDS=monad-keynote-hd
MIN_UNIT_PRICE=10000
EOF

echo "✅  Wrote access-service/.env"
echo "   Anvil PID=$ANVIL_PID  (kill $ANVIL_PID to stop)"
echo ""
echo "Next steps:"
echo "  (cd access-service && npm run build && npm start)"
echo "  (cd frontend && npm run dev)"

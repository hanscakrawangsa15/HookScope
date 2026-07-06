#!/usr/bin/env bash
set -o allexport
# shellcheck source=../.env
source "$(dirname "$0")/../.env" 2>/dev/null || true
set +o allexport

ANVIL_PRIVATE_KEY="${ANVIL_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
ANVIL_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"

# Check Anvil is running
if ! curl -sf -X POST "$ANVIL_RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null 2>&1; then
  echo "Error: Anvil tidak berjalan di $ANVIL_RPC_URL"
  echo "Jalankan dulu: pnpm anvil:start"
  exit 1
fi

CONTRACTS_DIR="$(dirname "$0")/../contracts"

# Install OZ if not already installed
if [ ! -d "$CONTRACTS_DIR/lib/openzeppelin-contracts" ]; then
  echo "Installing OpenZeppelin contracts..."
  (cd "$CONTRACTS_DIR" && forge install OpenZeppelin/openzeppelin-contracts)
fi

echo "Deploying test tokens to Anvil..."
(cd "$CONTRACTS_DIR" && forge script script/AnvilSetup.s.sol \
  --rpc-url "$ANVIL_RPC_URL" \
  --broadcast \
  --private-key "$ANVIL_PRIVATE_KEY")

if [ $? -eq 0 ]; then
  echo ""
  echo "Setup selesai! Alamat token tersimpan di contracts/out/anvil-addresses.json"
  echo "Jalankan pnpm anvil:test untuk verifikasi transaksi."
fi

#!/usr/bin/env bash
# Load .env from repo root so ETHEREUM_RPC_URL and ANVIL_* vars are available
# when running via pnpm (pnpm scripts don't source .env automatically).
set -o allexport
# shellcheck source=../.env
source "$(dirname "$0")/../.env" 2>/dev/null || true
set +o allexport

if [ -z "$ETHEREUM_RPC_URL" ]; then
  echo "Error: ETHEREUM_RPC_URL tidak ditemukan di .env"
  echo "Tambahkan ETHEREUM_RPC_URL ke file .env menggunakan key Alchemy/Infura."
  exit 1
fi

# Test koneksi ke RPC sebelum fork
echo "Mengecek koneksi ke RPC..."
if ! curl -sf --max-time 8 -X POST "$ETHEREUM_RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
  echo ""
  echo "Error: Tidak bisa terhubung ke $ETHEREUM_RPC_URL"
  echo ""
  echo "Solusi: Ganti ETHEREUM_RPC_URL di .env dengan RPC yang punya API key:"
  echo "  Alchemy (free): https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
  echo "    → Daftar di: https://dashboard.alchemy.com"
  echo "  Infura  (free): https://mainnet.infura.io/v3/YOUR_KEY"
  echo "    → Daftar di: https://infura.io"
  echo ""
  echo "RPC publik seperti publicnode.com sering timeout — API key jauh lebih stabil."
  exit 1
fi

# Kill any existing ANVIL process on port 8545
# Note: use pkill without -f flag so it matches the binary name "anvil" only,
# NOT paths containing the word "anvil" (like this script's own path).
echo "Mengecek port 8545..."
pkill -x "anvil" 2>/dev/null || true
# fuser kills by port number — most reliable fallback
fuser -k 8545/tcp 2>/dev/null || true
sleep 1

echo "Koneksi OK. Starting Anvil — forking $ETHEREUM_RPC_URL"

# Run Anvil and monitor for archive-access errors (e.g. publicnode.com 403)
LOGFILE="/tmp/anvil-hookscope.log"
anvil \
  --fork-url "$ETHEREUM_RPC_URL" \
  --chain-id 31337 \
  --block-time 2 \
  "$@" 2>&1 | tee "$LOGFILE" &
ANVIL_PID=$!

# Give Anvil 4s to start or fail
sleep 4
if ! kill -0 "$ANVIL_PID" 2>/dev/null; then
  # Anvil already exited — check if it's the archive-access error
  if grep -qi "archive\|personal token\|allnodes\|403" "$LOGFILE" 2>/dev/null; then
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║  ERROR: RPC tidak mendukung archive access!                  ║"
    echo "║                                                               ║"
    echo "║  ethereum.publicnode.com sekarang memblokir fork requests    ║"
    echo "║  tanpa personal token.                                        ║"
    echo "║                                                               ║"
    echo "║  Solusi: Ganti ETHEREUM_RPC_URL di .env dengan:             ║"
    echo "║                                                               ║"
    echo "║  Alchemy (gratis, support archive):                          ║"
    echo "║    → Daftar: https://dashboard.alchemy.com                  ║"
    echo "║    → URL:    https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY  ║"
    echo "║                                                               ║"
    echo "║  Infura (gratis, support archive):                           ║"
    echo "║    → Daftar: https://infura.io                               ║"
    echo "║    → URL:    https://mainnet.infura.io/v3/YOUR_KEY          ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    exit 1
  fi
  echo "Anvil exited unexpectedly. Check $LOGFILE for details."
  exit 1
fi

# Anvil is running — wait for it (foreground)
wait "$ANVIL_PID"

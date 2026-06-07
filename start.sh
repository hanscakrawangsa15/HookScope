#!/usr/bin/env bash
# HookScope — start all services
# Usage: ./start.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.npm-global/bin:$PATH"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }
die()  { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo -e "${CYAN}╔════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     HookScope — Starting Up        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════╝${NC}"
echo ""

# ── 1. Docker (PostgreSQL + Redis) ────────────────────────────────────────────
info "Starting Docker services..."
docker compose -f "$ROOT/docker/docker-compose.yml" up -d --quiet-pull 2>&1 | grep -v "^#" || warn "Docker issue — continuing"

# Wait for postgres
for i in {1..15}; do
  if docker exec hookscope-postgres pg_isready -U hookscope -q 2>/dev/null; then
    ok "PostgreSQL ready"; break
  fi
  sleep 1
done

# ── 2. Prisma DB push (sync schema) ──────────────────────────────────────────
info "Syncing database schema..."
cd "$ROOT/packages/shared"
DATABASE_URL="postgresql://hookscope:hookscope@localhost:5432/hookscope" \
  node_modules/.bin/prisma db push --skip-generate 2>&1 | grep -E "✔|error|already" | head -3
ok "Database schema synced"
cd "$ROOT"

# ── 3. Build shared package ───────────────────────────────────────────────────
if [ ! -d "$ROOT/packages/shared/dist" ]; then
  info "Building @hookscope/shared..."
  pnpm --filter @hookscope/shared build 2>&1 | tail -2
  ok "@hookscope/shared built"
fi

# ── 4. Start API ──────────────────────────────────────────────────────────────
info "Starting API server on :3001..."
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
cd "$ROOT/apps/api"
pnpm dev > /tmp/hookscope-api.log 2>&1 &
API_PID=$!
echo $API_PID > /tmp/hookscope-api.pid

# Wait for API
for i in {1..20}; do
  if curl -s http://localhost:3001/health >/dev/null 2>&1; then
    ok "API ready (pid $API_PID)"
    break
  fi
  sleep 1
done
cd "$ROOT"

# ── 5. Start Web ──────────────────────────────────────────────────────────────
info "Starting Next.js on :3000..."
pkill -f "next dev" 2>/dev/null || true
cd "$ROOT/apps/web"
pnpm dev > /tmp/hookscope-web.log 2>&1 &
WEB_PID=$!
echo $WEB_PID > /tmp/hookscope-web.pid
ok "Web starting (pid $WEB_PID) — takes ~10s to compile"
cd "$ROOT"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           HookScope Running            ║${NC}"
echo -e "${CYAN}╠════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  🌐 Web   →  ${GREEN}http://localhost:3000${NC}   ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  🔌 API   →  ${GREEN}http://localhost:3001${NC}   ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  🗄  DB    →  ${GREEN}localhost:5432${NC}           ${CYAN}║${NC}"
echo -e "${CYAN}╠════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  Logs: /tmp/hookscope-api.log          ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}        /tmp/hookscope-web.log          ${CYAN}║${NC}"
echo -e "${CYAN}╠════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  To stop: ${YELLOW}./stop.sh${NC}                    ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  To seed: ${YELLOW}pnpm --filter @hookscope/\\${NC}   ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}    ${YELLOW}indexer seed${NC}                       ${CYAN}║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

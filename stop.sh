#!/usr/bin/env bash
# Stop all HookScope services

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${YELLOW}Stopping HookScope...${NC}"

# Kill by PID files
for pidfile in /tmp/hookscope-api.pid /tmp/hookscope-web.pid; do
  if [ -f "$pidfile" ]; then
    PID=$(cat "$pidfile")
    kill "$PID" 2>/dev/null && echo -e "${GREEN}✓${NC} Stopped pid $PID" || true
    rm -f "$pidfile"
  fi
done

# Fallback: kill by process name
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "tsx watch src/index.ts" 2>/dev/null || true

echo -e "${GREEN}✓${NC} All services stopped"
echo "(Docker/PostgreSQL/Redis still running — run 'docker compose -f docker/docker-compose.yml down' to stop them)"

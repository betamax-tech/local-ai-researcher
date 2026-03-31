#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Start SearXNG if not already running
docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d searxng

# Wait for SearXNG to be ready (max 30s)
MAX_WAIT=30
count=0
until curl -sf "http://localhost:8080/" > /dev/null 2>&1; do
  if [ $count -ge $MAX_WAIT ]; then
    echo "ERROR: SearXNG failed to become ready within ${MAX_WAIT}s" >&2
    exit 1
  fi
  count=$((count + 1))
  sleep 1
done

# Replace this shell process with the MCP server (clean signal handling)
exec node "$PROJECT_ROOT/dist/index.js"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Guard: build dist/ if missing (e.g. fresh clone where prepare hasn't run)
if [ ! -f "$PROJECT_ROOT/dist/index.js" ]; then
  echo "dist/index.js not found — running build..." >&2
  cd "$PROJECT_ROOT"
  if command -v pnpm &>/dev/null; then
    pnpm install && pnpm build
  else
    npm install && npm run build
  fi
fi

# Start MCP server (no Docker — remote fallbacks are used when configured)
# --no-warnings suppresses Node.js experimental API warnings (e.g. node:sqlite)
# that would otherwise pollute stderr and confuse MCP host tools/get initialization.
exec node --no-warnings "$PROJECT_ROOT/dist/index.js"

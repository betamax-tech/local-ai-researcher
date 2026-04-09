#!/usr/bin/env bash
set -euo pipefail

# Start bundled SearXNG dependency first. This script is the operator-facing
# self-contained launch path, so it must bring up Docker Compose and verify
# readiness before starting the MCP server.

# Resolve the package root robustly — works whether invoked as:
#   - node_modules/.bin/local-researcher (npx — .bin entry is a symlink)
#   - scripts/start.sh directly (dev/local use)
#
# readlink -f resolves symlinks, so .bin/local-researcher → scripts/start.sh
# inside the actual package dir. SCRIPT_DIR/.. is then the package root in
# both cases.
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
SEARXNG_URL="${LOCAL_RESEARCHER_SEARXNG_ENDPOINT:-${SEARXNG_ENDPOINT:-http://localhost:8080}}"
READY_URL="${SEARXNG_URL%/}/search?q=healthcheck&format=json"
SCRAPLING_MODE="${LOCAL_RESEARCHER_SCRAPLING_ENABLED:-${SCRAPLING_ENABLED:-auto}}"
SCRAPLING_BOOTSTRAP="${LOCAL_RESEARCHER_SCRAPLING_BOOTSTRAP_WITH_DOCKER:-${SCRAPLING_BOOTSTRAP_WITH_DOCKER:-true}}"
SCRAPLING_URL="${LOCAL_RESEARCHER_SCRAPLING_ENDPOINT:-${SCRAPLING_ENDPOINT:-http://127.0.0.1:8090}}"
SCRAPLING_HEALTH_URL="${SCRAPLING_URL%/}/health"

have_docker=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  have_docker=1
fi

if [ "$have_docker" -eq 1 ]; then
  echo "Starting SearXNG via Docker Compose..." >&2
  docker compose -f "$COMPOSE_FILE" up -d searxng >&2
else
  echo "Docker unavailable; skipping bundled SearXNG bootstrap." >&2
fi

if [ "$have_docker" -eq 1 ]; then
  echo "Waiting for SearXNG readiness at $READY_URL ..." >&2
  READY=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$READY_URL" >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 1
  done

  if [ "$READY" -ne 1 ]; then
    echo "SearXNG failed to become ready within 30s: $READY_URL" >&2
    exit 1
  fi
fi

if [ "$SCRAPLING_MODE" != "disabled" ] && [ "$SCRAPLING_BOOTSTRAP" = "true" ]; then
  if [ "$have_docker" -eq 1 ]; then
    echo "Starting optional Scrapling sidecar via Docker Compose..." >&2
    docker compose -f "$COMPOSE_FILE" --profile scrapling up -d scrapling >&2

    echo "Waiting for Scrapling readiness at $SCRAPLING_HEALTH_URL ..." >&2
    SCRAPLING_READY=0
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 2 "$SCRAPLING_HEALTH_URL" >/dev/null 2>&1; then
        SCRAPLING_READY=1
        break
      fi
      sleep 1
    done

    if [ "$SCRAPLING_READY" -ne 1 ]; then
      if [ "$SCRAPLING_MODE" = "required" ]; then
        echo "Scrapling sidecar required but failed to become ready within 30s: $SCRAPLING_HEALTH_URL" >&2
        exit 1
      fi
      echo "Scrapling sidecar did not become ready; continuing with scraping optional/offline." >&2
    fi
  else
    if [ "$SCRAPLING_MODE" = "required" ]; then
      echo "Scrapling sidecar is required, but Docker is unavailable." >&2
      exit 1
    fi
    echo "Docker unavailable; skipping optional Scrapling bootstrap." >&2
  fi
fi

# Guard: build dist/ if missing (e.g. npx github: install where prepare was blocked)
# Always use npm here — pnpm blocks prepare scripts for git-hosted deps
# (ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED) so pnpm is not a safe fallback.
if [ ! -f "$PROJECT_ROOT/dist/index.js" ]; then
  echo "dist/index.js not found — running build..." >&2
  cd "$PROJECT_ROOT"
  npm install --ignore-scripts && npm run build
fi

# Start MCP server (no Docker — remote fallbacks are used when configured)
# --no-warnings suppresses Node.js experimental API warnings (e.g. node:sqlite)
# that would otherwise pollute stderr and confuse MCP host tools/get initialization.
exec node --no-warnings "$PROJECT_ROOT/dist/index.js"

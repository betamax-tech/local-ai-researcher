# Local Researcher Tool

A secure, privacy-focused local research assistant using SearXNG and Jina Reader via MCP stdio.

## Status

🚧 **Foundation Phase** — Minimal runnable scaffold. Integration work in progress.

## Overview

Local Researcher provides web search and content reading capabilities while keeping all requests under your control:
- **Search**: Query your own SearXNG instance or any HTTP-accessible endpoint
- **Read**: Extract clean text from any URL using Jina Reader or your own summarizer
- **Gather**: Combine search + read in one request with request-scoped deduplication
- **Health**: Verify provider connectivity

## Security First

- All outgoing requests are SSRF-protected (see [SECURITY.md](docs/SECURITY.md))
- Logs go to stderr; MCP stdout is protocol-clean
- No external dependencies for network requests
- Configurable rate limiting and timeouts

## Quick Start

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your provider endpoints

# Build
pnpm build

# Run (for MCP stdio)
pnpm start
```

## Documentation

- [FOUNDATION.md](docs/FOUNDATION.md) — System boundaries and contracts
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Technical design and layers
- [CONTRACTS.md](docs/CONTRACTS.md) — Type definitions and interfaces
- [SECURITY.md](docs/SECURITY.md) — Threat model and mitigations
- [IMPLEMENTATION_WAVE1.md](docs/IMPLEMENTATION_WAVE1.md) — Sprint 1 scope and progress

## Architecture

```
src/
├── index.ts          # MCP entrypoint (stdio)
├── config.ts         # Environment loading
├── domain/
│   └── types.ts      # Core domain types
├── lib/
│   ├── logger.ts     # stderr-only logging
│   ├── http.ts       # HTTP client with SSRF guards
│   ├── url.ts        # URL validation and sanitization
│   ├── ssrf.ts       # SSRF protection
│   └── errors.ts     # Error types
├── providers/
│   ├── searxng.ts    # SearXNG client
│   └── jinaReader.ts # Jina Reader client
└── tools/
    ├── search.ts     # Search tool implementation
    ├── read.ts       # Read tool implementation
    ├── gather.ts     # Combined search + read
    └── health.ts     # Health check tool
```

## Wave 1 Scope

First implementation wave focuses on:
- ✅ Foundation scaffold (docs, types, lib layer)
- ✅ HTTP client with SSRF protection
- ✅ SearxNG provider integration
- ✅ Jina Reader provider integration
- ✅ MCP stdio server skeleton
- 🔄 Tool implementations (in progress)

See [IMPLEMENTATION_WAVE1.md](docs/IMPLEMENTATION_WAVE1.md) for details.

## Development

```bash
# Watch mode
pnpm dev

# Type check
pnpm typecheck

# Lint
pnpm lint

# Test (when tests exist)
pnpm test
```

## Self-Contained Launch (with SearXNG)

This project ships a bootstrap flow that starts the required SearXNG dependency automatically before the MCP server. No separate manual step needed.

### Prerequisites

- **Docker** (Compose V2, i.e. `docker compose` — not `docker-compose`)
- **Node.js** >= 18

> **Linux users:** your user may need to be in the `docker` group, or run the scripts with `sudo`. Check with `docker info` first.

### Start

```bash
# Build first (if not already built)
pnpm build

# Start SearXNG + MCP server
bash scripts/start.sh
```

Or via npm/pnpm:

```bash
pnpm start:docker
```

`scripts/start.sh` will:
1. Bring up the SearXNG Docker container (idempotent — safe to run when already running)
2. Wait up to 30 seconds for SearXNG to become ready
3. Replace itself with the MCP server process via `exec` (clean signal handling — no wrapper orphan)

### Stop

```bash
bash scripts/stop.sh
```

### OpenCode Configuration

To use this as your MCP command in `opencode.json`, set the `command` to the absolute path of the start script:

```json
{
  "mcpServers": {
    "local-researcher": {
      "command": ["bash", "/absolute/path/to/scripts/start.sh"],
      "env": {
        "SEARXNG_ALLOW_PRIVATE_NETWORKS": "true",
        "SEARXNG_ENDPOINT": "http://localhost:8080"
      }
    }
  }
}
```

### Required Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `SEARXNG_ALLOW_PRIVATE_NETWORKS` | `true` | Required when SearXNG runs on localhost — bypasses SSRF protection for private network addresses |
| `SEARXNG_ENDPOINT` | `http://localhost:8080` | SearXNG base URL (this is already the default) |

### Security Note

Before using this in any shared or production environment, update the `server.secret_key` in `searxng/settings.yml`:

```bash
# Generate a strong random key
openssl rand -hex 32
```

Replace the `CHANGE_ME_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32` placeholder with the generated value.

## License

MIT

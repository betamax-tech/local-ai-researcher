# local-ai-researcher

A secure, privacy-focused local research assistant that gives your AI agent web search and content extraction via MCP stdio — all under your control.

**v0.1.0 — Frozen v1 schema. Production-ready.**

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
  - [Path A: Docker bootstrap (recommended)](#path-a-docker-bootstrap-recommended)
  - [Path B: Bring your own SearXNG](#path-b-bring-your-own-searxng)
- [OpenCode Integration](#opencode-integration)
- [Tools Reference](#tools-reference)
- [Environment Variable Reference](#environment-variable-reference)
- [Default Behaviors](#default-behaviors)
- [Content Policy](#content-policy)
- [SQLite Cache (opt-in)](#sqlite-cache-opt-in)
- [Safety & Privacy Baseline](#safety--privacy-baseline)
- [Verifying Readiness](#verifying-readiness)
- [Development](#development)
- [Architecture](#architecture)
- [License](#license)

---

## Overview

local-ai-researcher exposes four MCP tools over stdio:

| Tool | Purpose |
|------|---------|
| `search` | Web search via SearXNG |
| `read` | Content extraction from a URL via Jina Reader |
| `gather` | Combined search + parallel reads in one call |
| `health` | Verify provider connectivity and server status |

**Providers required:**
- **SearXNG** — self-hosted, for web search (Docker Compose bootstrap included)
- **Jina Reader** — self-hosted or `https://r.jina.ai/`, for content extraction

Both providers must be reachable from the machine running the MCP server. No cloud dependencies or third-party API keys are required for the default self-hosted configuration.

---

## Quick Start

### Path A: Docker bootstrap (recommended)

Starts SearXNG automatically via Docker Compose, then launches the MCP server.

**Prerequisites:**
- **Docker** (Compose V2 — `docker compose`, not `docker-compose`)
- **Node.js** >= 18

> **Linux users:** your user may need to be in the `docker` group. Check with `docker info`.

```bash
# 1. Install dependencies and build
npm install
npm run build

# 2. Start SearXNG + MCP server
bash scripts/start.sh
```

Or via npm/pnpm:

```bash
# npm
npm run start:docker   # if you add "start:docker": "bash scripts/start.sh" to package.json

# pnpm
pnpm start:docker
```

`scripts/start.sh` will:
1. Start the SearXNG Docker container (idempotent — safe to call when already running)
2. Wait up to 30 seconds for SearXNG to become ready
3. Replace itself with the MCP server via `exec` (clean signal handling — no wrapper orphan)

**Stop SearXNG:**
```bash
bash scripts/stop.sh
```

**Security:** Before using in any shared or production environment, update `server.secret_key` in `searxng/settings.yml`:

```bash
openssl rand -hex 32
# Replace CHANGE_ME_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32 in searxng/settings.yml
```

---

### Path B: Bring your own SearXNG

If you already run a SearXNG instance (or Jina Reader at a custom endpoint), start the server directly.

**Prerequisites:**
- **Node.js** >= 18
- A running SearXNG instance (JSON API enabled)
- A running Jina Reader instance (or use the hosted `https://r.jina.ai/`)

```bash
# 1. Install dependencies and build
npm install
npm run build

# 2. Configure
export LOCAL_RESEARCHER_SEARXNG_ENDPOINT="http://your-searxng-host:8080"
export LOCAL_RESEARCHER_JINA_READER_ENDPOINT="https://r.jina.ai/"   # or self-hosted URL

# Required when SearXNG is on localhost or a private network:
export LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS="true"

# 3. Run the MCP server (stdio)
node dist/index.js
```

---

## OpenCode Integration

Add to your `opencode.json`:

```json
{
  "mcpServers": {
    "local-researcher": {
      "command": ["bash", "/absolute/path/to/scripts/start.sh"],
      "env": {
        "LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS": "true",
        "LOCAL_RESEARCHER_SEARXNG_ENDPOINT": "http://localhost:8080"
      }
    }
  }
}
```

> **Note:** Use absolute paths for the script. The `LOCAL_RESEARCHER_*` prefix is the canonical form; bare names (e.g., `SEARXNG_ENDPOINT`) are also accepted for migration.

For a self-hosted Jina Reader or custom Jina endpoint:

```json
{
  "mcpServers": {
    "local-researcher": {
      "command": ["bash", "/absolute/path/to/scripts/start.sh"],
      "env": {
        "LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS": "true",
        "LOCAL_RESEARCHER_SEARXNG_ENDPOINT": "http://localhost:8080",
        "LOCAL_RESEARCHER_JINA_READER_ENDPOINT": "http://localhost:3000/"
      }
    }
  }
}
```

---

## Tools Reference

All tool responses share a common envelope:

```json
{
  "schema_version": "1",
  "ok": true,
  "meta": {
    "request_id": "<uuid>",
    "timestamp": "<ISO-8601>",
    "provider_id": "<string>",
    "provider_name": "<string>",
    "applied_limits": { "timeout_ms": 10000, "max_results": 5 },
    "cache_status": "disabled"
  },
  "result": { ... }
}
```

On error, `ok` is `false` and `result` is replaced by `error: { code, message, retryable }`.

---

### `search`

Search the web using SearXNG.

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` (1–500 chars) | required | Search query |
| `limit` | `integer` (1–50) | `5` | Max results to return |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | `'full'` returns full page text; `'excerpt'` returns a preview |
| `category` | `string` | — | SearXNG category (e.g., `'general'`, `'news'`) |
| `language` | `string` | — | Language code (e.g., `'en'`, `'de'`) |
| `timeRange` | `string` | — | Time range filter (e.g., `'day'`, `'week'`, `'month'`) |
| `bypass_cache` | `boolean` | `false` | Skip cache lookup for this call; cache is not updated on bypass |

**Result shape (`result.results[]`):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Deterministic hash of source + canonical URL + position |
| `url` | `string` | Canonical result URL |
| `title` | `string` | Page title |
| `excerpt` | `string` | Content preview (or full text when `content_mode: 'full'`) |
| `source` | `'web'` | Source type |
| `relevance` | `number` (0–1) | Relevance score (if provided by SearXNG) |
| `date` | `string` | Publish date ISO string (if available) |

---

### `read`

Extract content from a URL using Jina Reader.

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` (max 2000 chars) | required | URL to fetch and extract |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | `'full'` returns full content; `'excerpt'` returns truncated preview |
| `targetWords` | `integer` (1–10000) | — | Target word count for excerpt trimming (only used when `content_mode: 'excerpt'`) |
| `language` | `string` | — | Language hint for Jina Reader |
| `bypass_cache` | `boolean` | `false` | Skip cache lookup; cache is not updated on bypass |

**Result shape (`result`):**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Source URL |
| `title` | `string` | Page title |
| `excerpt` | `string` | Content preview |
| `content` | `string` | Full text content (populated by default) |
| `content_mode` | `'full'` \| `'excerpt'` | Mode used for this result |
| `content_truncated` | `boolean` | Whether content was truncated |
| `truncation` | `object` | Truncation details (only present when `content_truncated: true`) |
| `wordCount` | `integer` | Approximate word count |
| `duration` | `integer` | Extraction duration (ms) |

---

### `gather`

Search and read in a single call. Performs a search, deduplicates URLs, then reads all results in parallel. Returns a normalized research envelope with a pre-formatted synthesis block ready for LLM insertion.

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` (1–500 chars) | required | Research query |
| `maxResults` | `integer` (1–20) | `5` | Max search results to fetch |
| `dedup` | `boolean` | `true` | Enable request-scoped URL deduplication (canonical URL match) |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Content mode for all reads |
| `timeout` | `integer` (1000–60000) | `10000` | Total gather timeout (ms) |
| `bypass_cache` | `boolean` | `false` | Skip cache for all operations; propagates to nested reads |

**Result shape (`result`):**

| Field | Description |
|-------|-------------|
| `id` | Request-scoped unique ID |
| `prompt` | Original query |
| `context.sources` | Source descriptors (type + target URL) |
| `context.results` | Search results (same shape as `search` tool) |
| `context.reads` | Extracted content (same shape as `read` tool) |
| `context.dedupStats` | `{ total, deduped }` — dedup statistics |
| `synthesis` | Pre-formatted markdown context block for LLM insertion |
| `summary.totalResults` | Total search results returned |
| `summary.attemptedReads` | URLs attempted for reading (after dedup) |
| `summary.successfulReads` | Reads that succeeded |
| `summary.failedReads` | Reads that failed (per-URL errors are non-fatal) |
| `summary.totalDuration` | Total elapsed time (ms) |

---

### `health`

Verify provider connectivity and MCP server status.

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `'searxng'` \| `'jinaReader'` \| `'all'` | `'all'` | Which provider(s) to probe |

**Result shape (`result`):**

| Field | Description |
|-------|-------------|
| `status` | `'healthy'` (all connected) \| `'degraded'` (some connected) \| `'unhealthy'` (none connected) |
| `mcp.stdio.ready` | Whether stdio transport is active |
| `mcp.stdio.version` | MCP server version string |
| `mcp.servers[]` | Per-provider entries: `name`, `status`, `latency_ms`, `error`, `error_code` |
| `resources.memoryMB` | RSS memory usage (MB) |
| `resources.cwd` | Working directory |
| `timestamp` | ISO-8601 response timestamp |

---

## Environment Variable Reference

All variables accept the `LOCAL_RESEARCHER_` prefix (canonical) or the bare name (legacy, accepted for migration).

> **Convention:** `LOCAL_RESEARCHER_SEARXNG_ENDPOINT` (canonical) = `SEARXNG_ENDPOINT` (bare).  
> Prefixed form takes priority when both are set.

### SearXNG Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SEARXNG_ENDPOINT` | `http://localhost:8080` | SearXNG base URL |
| `LOCAL_RESEARCHER_SEARXNG_TIMEOUT` | `10000` | SearXNG request timeout (ms) |
| `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS` | `false` | **Set `true` when SearXNG is on localhost or a private network** (bypasses SSRF protection for private addresses) |
| `LOCAL_RESEARCHER_SEARXNG_API_KEY` | _(empty)_ | API key if your SearXNG instance requires one |

### Jina Reader Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_JINA_READER_ENDPOINT` | `https://r.jina.ai/` | Jina Reader base URL (no trailing path segment) |
| `LOCAL_RESEARCHER_JINA_READER_TIMEOUT` | `15000` | Jina Reader request timeout (ms) |
| `LOCAL_RESEARCHER_JINA_READER_API_KEY` | _(empty)_ | API key if your Jina Reader instance requires one |

### HTTP Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_HTTP_TIMEOUT` | `30000` | Global HTTP client timeout (ms) |
| `LOCAL_RESEARCHER_HTTP_MAX_RETRIES` | `2` | Max retry attempts |
| `LOCAL_RESEARCHER_HTTP_RETRY_DELAY` | `500` | Initial retry delay (ms) |
| `LOCAL_RESEARCHER_HTTP_MAX_RETRY_DELAY` | `5000` | Maximum retry delay (ms) |
| `LOCAL_RESEARCHER_SSRF_ALLOWED_NETWORKS` | _(empty)_ | Comma-separated CIDR list for SSRF allowlist (e.g., `10.0.0.0/8,192.168.0.0/16`) |

### Logging

Logs go to **stderr only**. stdout is reserved for the MCP protocol.

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_LOG_LEVEL` | `info` | Log level: `debug` \| `info` \| `warn` \| `error` |
| `LOCAL_RESEARCHER_LOG_JSON` | `true` | Structured JSON logs (recommended; set `false` for human-readable dev output) |
| `LOCAL_RESEARCHER_LOG_TIMESTAMP` | `true` | Include ISO timestamps in logs |

### Search Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SEARCH_DEFAULT_LIMIT` | `5` | Default max results per search call |
| `LOCAL_RESEARCHER_SEARCH_DEFAULT_SOURCES` | `web` | Default source type (`web` is the only supported v1 value) |

### Gather Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_GATHER_STRATEGY` | `parallel` | Read execution strategy: `parallel` \| `sequential` |
| `LOCAL_RESEARCHER_GATHER_DEDUP_ENABLED` | `true` | Enable request-scoped URL deduplication by default |
| `LOCAL_RESEARCHER_GATHER_TIMEOUT` | `10000` | Default gather timeout (ms) |

### Content Policy

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_CONTENT_DEFAULT_MODE` | `full` | Default content mode: `full` \| `excerpt` |

### MCP

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_MCP_TIMEOUT` | `5000` | Per-call MCP timeout (ms) |
| `LOCAL_RESEARCHER_MCP_RETRIES` | `2` | Default MCP retry count |

### Cache (opt-in, disabled by default)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_CACHE_ENABLED` | `false` | Enable SQLite response cache |
| `LOCAL_RESEARCHER_CACHE_PATH` | `./cache.db` | Path to SQLite database file |
| `LOCAL_RESEARCHER_CACHE_TTL` | `3600` | Cache entry TTL in seconds (default: 1 hour) |

---

## Default Behaviors

| Behavior | Default | How to change |
|----------|---------|---------------|
| Content mode | `full` (full page text) | Set `content_mode: 'excerpt'` per call, or set `LOCAL_RESEARCHER_CONTENT_DEFAULT_MODE=excerpt` |
| Request-scoped dedup | Enabled | Set `dedup: false` in `gather` call, or set `LOCAL_RESEARCHER_GATHER_DEDUP_ENABLED=false` |
| SQLite cache | Disabled | Set `LOCAL_RESEARCHER_CACHE_ENABLED=true` |
| Search result limit | `5` | Set `limit` in `search` call, or set `LOCAL_RESEARCHER_SEARCH_DEFAULT_LIMIT` |
| Gather execution | Parallel reads | Set `LOCAL_RESEARCHER_GATHER_STRATEGY=sequential` |

---

## Content Policy

**Full content is the default.** All tools return complete page text unless explicitly overridden.

- `content_mode: 'full'` (default) — the `content` field in `ReadResult` is populated with the full extracted text.
- `content_mode: 'excerpt'` — returns a truncated preview. Use `targetWords` in the `read` tool to control length.

**Changing the server-wide default:**

```bash
# Use excerpt mode by default for all calls
LOCAL_RESEARCHER_CONTENT_DEFAULT_MODE=excerpt node dist/index.js
```

**Overriding per call:**

```json
{ "tool": "read", "params": { "url": "https://...", "content_mode": "excerpt", "targetWords": 200 } }
```

---

## SQLite Cache (opt-in)

The cache is **disabled by default**. Enable it to avoid redundant provider calls across sessions.

```bash
LOCAL_RESEARCHER_CACHE_ENABLED=true \
LOCAL_RESEARCHER_CACHE_PATH=./cache.db \
LOCAL_RESEARCHER_CACHE_TTL=3600 \
node dist/index.js
```

**Cache behavior:**

- Cache is keyed per tool + query + relevant options.
- `gather` caches the entire result envelope; individual `search` and `read` results are cached separately.
- `bypass_cache: true` on any tool call skips the cache lookup **and does not update the cache** for that request.
- Cache entries expire after `CACHE_TTL` seconds (default: 3600 = 1 hour).
- The `meta.cache_status` field in every response reports: `hit` | `miss` | `bypass` | `disabled`.

---

## Safety & Privacy Baseline

The following protections are **mandatory and always active**:

| Protection | Description |
|-----------|-------------|
| **SSRF protection** | All outgoing HTTP requests are checked against an SSRF blocklist. Private network addresses (RFC 1918, loopback, link-local) are blocked by default. To allow a private-network SearXNG: set `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true`. For other private ranges, use `LOCAL_RESEARCHER_SSRF_ALLOWED_NETWORKS` with CIDR notation. |
| **stdout protocol isolation** | All logs go to **stderr**. stdout is reserved exclusively for the MCP protocol. No log output can corrupt the JSON-RPC stream. |
| **Redacted log fields** | Sensitive fields (API keys, credentials) are never written to logs. |
| **Bounded timeouts** | All provider calls have hard timeouts: SearXNG 10 s, Jina Reader 15 s, gather 10 s total. Each read in `gather` gets a proportional share with a 5 s floor. |
| **Bounded retries** | HTTP retries are capped at `HTTP_MAX_RETRIES` (default: 2) with exponential backoff up to `HTTP_MAX_RETRY_DELAY` (default: 5 s). |
| **No external telemetry** | The server makes no calls to external analytics, telemetry, or tracking services. All network requests go only to your configured providers. |

See [docs/SECURITY.md](docs/SECURITY.md) for the full threat model and mitigations.

---

## Verifying Readiness

After starting the server, use the `health` tool to verify both providers are reachable:

```json
{ "tool": "health", "params": { "provider": "all" } }
```

**Expected response (healthy):**
```json
{
  "schema_version": "1",
  "ok": true,
  "meta": { ... },
  "result": {
    "status": "healthy",
    "mcp": {
      "stdio": { "ready": true, "version": "1.0.0" },
      "servers": [
        { "name": "SearXNG", "status": "connected", "latency_ms": 12 },
        { "name": "Jina Reader", "status": "connected", "latency_ms": 45 }
      ]
    },
    "resources": { "memoryMB": 64, "cwd": "/your/path" },
    "timestamp": "2026-03-31T00:00:00.000Z"
  }
}
```

**Troubleshooting:**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `status: "unavailable"` for SearXNG | SearXNG not running, or SSRF blocking localhost | Run `bash scripts/start.sh` or set `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true` |
| `status: "error"` with `error_code: "ERR_SSRF_BLOCKED"` | SSRF protection blocked the request | Set `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true` for localhost SearXNG, or add CIDR to `LOCAL_RESEARCHER_SSRF_ALLOWED_NETWORKS` |
| `status: "unavailable"` for Jina Reader | Reader endpoint unreachable | Check `LOCAL_RESEARCHER_JINA_READER_ENDPOINT`, or verify your self-hosted reader is running |
| Server exits with `ConfigError` | Invalid env var value | Check stderr output; fix the flagged variable |

---

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
        "LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS": "true",
        "LOCAL_RESEARCHER_SEARXNG_ENDPOINT": "http://localhost:8080"
      }
    }
  }
}
```

### Required Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS` | `true` | Required when SearXNG runs on localhost — bypasses SSRF protection for private network addresses |
| `LOCAL_RESEARCHER_SEARXNG_ENDPOINT` | `http://localhost:8080` | SearXNG base URL (this is already the default) |

### Security Note

Before using this in any shared or production environment, update the `server.secret_key` in `searxng/settings.yml`:

```bash
# Generate a strong random key
openssl rand -hex 32
```

Replace the `CHANGE_ME_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32` placeholder with the generated value.

---

## Development

```bash
# Install dependencies
pnpm install

# Build (TypeScript → dist/)
pnpm build

# Type check (no emit)
pnpm typecheck

# Watch mode
pnpm dev

# Run tests
pnpm test
# or
npm test

# Start MCP server (after build)
pnpm start
```

---

## Architecture

```
src/
├── index.ts              # MCP stdio entrypoint
├── config.ts             # Environment loading and validation (locked v1 defaults)
├── domain/
│   └── types.ts          # Core domain types and locked v1 schema
├── lib/
│   ├── logger.ts         # stderr-only structured logging
│   ├── http.ts           # HTTP client with SSRF guards and retry
│   ├── url.ts            # URL validation and canonicalization
│   ├── ssrf.ts           # SSRF protection layer
│   ├── cache.ts          # SQLite response cache (opt-in)
│   └── errors.ts         # Typed error classes with codes
├── providers/
│   ├── interfaces.ts     # Provider interface contracts
│   ├── searxng.ts        # SearXNG client
│   └── jinaReader.ts     # Jina Reader client
└── tools/
    ├── search.ts         # search tool
    ├── read.ts           # read tool
    ├── gather.ts         # gather tool (search + parallel reads)
    └── health.ts         # health tool
```

**Reference documentation:**

- [docs/FOUNDATION.md](docs/FOUNDATION.md) — System boundaries and contracts
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Technical design and layers
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — Type definitions and interfaces
- [docs/SECURITY.md](docs/SECURITY.md) — Threat model and mitigations

---

## License

MIT

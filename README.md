# local-ai-researcher

**Privacy-first research for AI agents.** Self-hosted web search and content extraction via MCP — no cloud dependencies, no API keys required for default operation.

local-ai-researcher gives your AI agent the ability to search the web and extract content from URLs using local infrastructure you control. It's designed to be a sensible default research baseline for [OpenCode](https://github.com/opencode-ai/opencode) and other MCP-compatible AI tools.

**Why use this?**
- **Privacy-focused**: All search and extraction happens through your own infrastructure
- **No required API keys**: Default operation uses self-hosted SearXNG and Jina Reader
- **Free and unlimited**: No rate limits or quotas when using local providers
- **MCP-native**: Built specifically for AI agent integration via stdio transport
- **Convenient**: The `gather` tool combines search + parallel reads in one call

**Tradeoffs to know:**
- Local search quality may differ from premium search engines (Google, Bing, etc.)
- Requires running SearXNG (Docker included) and optionally Jina Reader
- First-time setup takes ~2 minutes

---

## Quick Start

Get running in under 5 minutes with Docker (recommended).

### Prerequisites

- **Docker** (Compose V2 — `docker compose`, not `docker-compose`)
- **Node.js** >= 18
- **pnpm** >= 8 (or npm/yarn)

### Install and Run

```bash
# 1. Clone and install
git clone <your-repo-url>
cd local-ai-researcher
pnpm install

# 2. Build
pnpm build

# 3. Start (launches SearXNG automatically, then the MCP server)
pnpm start:docker
```

That's it. The server is now listening on stdio for MCP commands.

**What just happened:**
- SearXNG Docker container started (web search provider)
- MCP server started and connected to SearXNG
- Server is ready to receive tool calls via MCP stdio

**To stop SearXNG:**
```bash
bash scripts/stop.sh
```

**Using your own SearXNG instance?** See [Bring Your Own SearXNG](#bring-your-own-searxng).

---

## OpenCode Integration

Add local-ai-researcher to your `opencode.json`:

```json
{
  "mcpServers": {
    "local-researcher": {
      "command": ["bash", "/absolute/path/to/local-ai-researcher/scripts/start.sh"],
      "env": {
        "LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS": "true",
        "LOCAL_RESEARCHER_SEARXNG_ENDPOINT": "http://localhost:8080"
      }
    }
  }
}
```

**Important:** Replace `/absolute/path/to/local-ai-researcher` with the actual path on your machine.

Restart OpenCode. Your AI agent now has access to:
- `local-researcher_search` — web search
- `local-researcher_read` — content extraction
- `local-researcher_extract` — structured or targeted extraction via optional Docker-backed Scrapling
- `local-researcher_gather` — search + read in one call
- `local-researcher_health` — verify connectivity

### Using a custom Jina Reader endpoint

If you're running your own Jina Reader instance:

```json
{
  "mcpServers": {
    "local-researcher": {
      "command": ["bash", "/absolute/path/to/local-ai-researcher/scripts/start.sh"],
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

## Tools Overview

Five tools for research workflows:

### `search` — Web search via SearXNG

**When to use:** You need to find URLs or get search results.

```json
{
  "query": "privacy-focused search engines",
  "limit": 5,
  "content_mode": "full"
}
```

Returns URLs, titles, excerpts, and metadata.

### `read` — Content extraction from URLs

**When to use:** You have a URL and need the full text content.

```json
{
  "url": "https://example.com/article",
  "content_mode": "full"
}
```

Extracts clean text via Jina Reader.

### `extract` — Structured or targeted extraction via Scrapling

**When to use:** You have a known URL and need structured data, repeated entities, selector-targeted output, or a JS-heavy page.

```json
{
  "url": "https://example.com/products",
  "selector": ".product-card",
  "mode": "auto",
  "content_mode": "full"
}
```

Returns normalized extracted text plus structured `sections` and `records`. In the preferred distribution path, this lane comes online automatically when Docker is available and the optional Scrapling sidecar starts successfully.

### `gather` — Search + parallel reads (recommended)

**When to use:** You want a research query answered with full context from multiple sources. This is the signature convenience path.

```json
{
  "query": "benefits of local-first AI",
  "maxResults": 5,
  "content_mode": "full",
  "dedup": true
}
```

**What it does:**
1. Searches SearXNG
2. Deduplicates URLs
3. Reads all results in parallel
4. Returns a normalized envelope with a pre-formatted synthesis block ready for LLM insertion

**Why use it:** One call instead of `search` + multiple `read` calls. Built-in dedup, parallel execution, and structured output.

### `health` — Verify provider connectivity

**When to use:** Troubleshooting or verifying the server is ready.

```json
{
  "provider": "all"
}
```

Returns status for SearXNG, Jina Reader, and optional Docker-backed Scrapling, plus provider governance/version visibility.

---

## Verification & Troubleshooting

### Verify the server is ready

After starting, call the `health` tool:

```json
{ "tool": "health", "params": { "provider": "all" } }
```

**Healthy response:**
```json
{
  "ok": true,
  "result": {
    "status": "healthy",
    "mcp": {
      "servers": [
        { "name": "SearXNG", "status": "connected", "latency_ms": 12 },
        { "name": "Jina Reader", "status": "connected", "latency_ms": 45 },
        { "name": "Scrapling", "status": "connected", "latency_ms": 91, "optional": true }
      ]
    },
    "provider_governance": {
      "manifest_loaded": true,
      "tracked_providers": 3
    }
  }
}
```

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| SearXNG `status: "unavailable"` | SearXNG not running | Run `pnpm start:docker` or `bash scripts/start.sh` |
| SearXNG `error_code: "ERR_SSRF_BLOCKED"` | SSRF protection blocking localhost | Set `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true` |
| Jina Reader `status: "unavailable"` | Reader endpoint unreachable | Check `LOCAL_RESEARCHER_JINA_READER_ENDPOINT` (default: `https://r.jina.ai/`) |
| Scrapling `status: "unavailable"` | Optional Scrapling sidecar not running | Ensure Docker is available or set `LOCAL_RESEARCHER_SCRAPLING_ENABLED=required` to fail fast |
| Server exits with `ConfigError` | Invalid environment variable | Check stderr for the flagged variable |

### Logs

All logs go to **stderr** (stdout is reserved for MCP protocol). To see logs:

```bash
# If running directly
node dist/index.js 2>&1 | less

# In OpenCode, check the MCP server logs panel
```

Set `LOCAL_RESEARCHER_LOG_LEVEL=debug` for verbose output.

---

## Bring Your Own SearXNG

If you already run SearXNG (or want to use a remote instance):

### Recommended: point at a resilient router, not raw SearXNG

A bare SearXNG on a datacenter/VPS IP will periodically return **HTTP 200 with
zero results** when a search engine CAPTCHA/rate-limit-blocks its IP — which
surfaces here as *"No search results found."* To avoid silent failures, point
`SEARXNG_ENDPOINT` at a front-door **resilient router** that adds:

- rotating free-proxy fallback (round-robin over health-checked proxies),
- direct-tier rate limiting to protect your real IP,
- tiered failover with `0 results = failure` detection,
- a dead-letter queue so no query is ever dropped.

```bash
export LOCAL_RESEARCHER_SEARXNG_ENDPOINT="http://localhost:8899"  # the router
```

Reference implementation (two-instance SearXNG + Go router + proxy rotation):
**https://github.com/betamax-tech/searxng-resilient-router**

### Prerequisites

- Node.js >= 18
- Running SearXNG instance with JSON API enabled
- Jina Reader endpoint (self-hosted or `https://r.jina.ai/`)

### Configure and run

```bash
# 1. Install and build
pnpm install
pnpm build

# 2. Configure environment
export LOCAL_RESEARCHER_SEARXNG_ENDPOINT="http://your-searxng-host:8080"
export LOCAL_RESEARCHER_JINA_READER_ENDPOINT="https://r.jina.ai/"
export LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS="true"  # if SearXNG is on localhost/private network

# 3. Run
node --no-warnings dist/index.js
```

---

## Configuration

### Provider governance manifest

`provider-manifest.json` is the canonical repo-tracked record of expected provider/runtime versions for SearXNG, Jina Reader, and Scrapling.

- update it when you upgrade a provider runtime
- use `health` to compare detected vs expected versions where available
- keep operator-managed Jina deployment details current even if the endpoint itself does not expose a machine-readable version

### Environment variables

All variables accept the `LOCAL_RESEARCHER_` prefix (canonical) or bare names (legacy).

#### SearXNG Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SEARXNG_ENDPOINT` | `http://localhost:8080` | SearXNG base URL |
| `LOCAL_RESEARCHER_SEARXNG_TIMEOUT` | `10000` | Request timeout (ms) |
| `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS` | `false` | **Set `true` for localhost/private SearXNG** (bypasses SSRF protection) |
| `LOCAL_RESEARCHER_SEARXNG_API_KEY` | _(empty)_ | API key if required |

#### Jina Reader Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_JINA_READER_ENDPOINT` | `https://r.jina.ai/` | Jina Reader base URL |
| `LOCAL_RESEARCHER_JINA_READER_TIMEOUT` | `15000` | Request timeout (ms) |
| `LOCAL_RESEARCHER_JINA_READER_API_KEY` | _(empty)_ | API key if required |

#### Scrapling Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SCRAPLING_ENABLED` | `auto` | `disabled` \| `auto` \| `required` for the optional Scrapling lane |
| `LOCAL_RESEARCHER_SCRAPLING_ENDPOINT` | `http://127.0.0.1:8090` | Local Scrapling sidecar endpoint |
| `LOCAL_RESEARCHER_SCRAPLING_BOOTSTRAP_WITH_DOCKER` | `true` | If Docker is available, startup script attempts to launch the Scrapling sidecar |
| `LOCAL_RESEARCHER_SCRAPLING_TIMEOUT` | `20000` | Extraction timeout (ms) |
| `LOCAL_RESEARCHER_SCRAPLING_ALLOW_PRIVATE_NETWORKS` | `false` | Allow private-network extraction targets |
| `LOCAL_RESEARCHER_SCRAPLING_DEFAULT_MODE` | `auto` | Default extraction mode: `auto` \| `static` \| `dynamic` |

**Distribution behavior:**

```bash
# Default / preferred distribution path
# - no host Python install required
# - startup script will launch the optional sidecar when Docker is available
LOCAL_RESEARCHER_SCRAPLING_ENABLED=auto \
bash scripts/start.sh
```

If you want startup to fail when optional scraping is unavailable:

```bash
LOCAL_RESEARCHER_SCRAPLING_ENABLED=required \
bash scripts/start.sh
```

#### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_LOG_LEVEL` | `info` | Log level: `debug` \| `info` \| `warn` \| `error` |
| `LOCAL_RESEARCHER_LOG_JSON` | `true` | Structured JSON logs (`false` for human-readable) |

#### Search & Gather Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SEARCH_DEFAULT_LIMIT` | `5` | Default max results per search |
| `LOCAL_RESEARCHER_GATHER_STRATEGY` | `parallel` | Read strategy: `parallel` \| `sequential` |
| `LOCAL_RESEARCHER_GATHER_DEDUP_ENABLED` | `true` | Enable URL deduplication by default |
| `LOCAL_RESEARCHER_GATHER_TIMEOUT` | `10000` | Default gather timeout (ms) |

#### Content Policy

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_CONTENT_DEFAULT_MODE` | `full` | Default content mode: `full` \| `excerpt` |

#### Cache (opt-in)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_CACHE_ENABLED` | `false` | Enable SQLite response cache |
| `LOCAL_RESEARCHER_CACHE_PATH` | `./cache.db` | SQLite database file path |
| `LOCAL_RESEARCHER_CACHE_TTL` | `3600` | Cache entry TTL (seconds) |

**Cache behavior:**
- Disabled by default
- Keyed per tool + query + options
- `bypass_cache: true` skips lookup and doesn't update cache
- `meta.cache_status` reports: `hit` \| `miss` \| `bypass` \| `disabled`

To enable:

```bash
LOCAL_RESEARCHER_CACHE_ENABLED=true \
LOCAL_RESEARCHER_CACHE_PATH=./cache.db \
LOCAL_RESEARCHER_CACHE_TTL=3600 \
node --no-warnings dist/index.js
```

---

## Security & Privacy

**Built-in protections (always active):**

| Protection | Description |
|-----------|-------------|
| **SSRF protection** | Blocks private network addresses by default. Allow with `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true` or `LOCAL_RESEARCHER_SSRF_ALLOWED_NETWORKS` (CIDR) |
| **stdout isolation** | All logs to stderr. stdout reserved for MCP protocol only. |
| **Redacted logs** | Sensitive fields (API keys, credentials) never logged |
| **Bounded timeouts** | Hard timeouts: SearXNG 10s, Jina Reader 15s, gather 10s total |
| **Bounded retries** | Max 2 retries with exponential backoff (max 5s) |
| **No telemetry** | Zero external analytics or tracking calls |

**Before production use:** Update `server.secret_key` in `searxng/settings.yml`:

```bash
openssl rand -hex 32
# Replace CHANGE_ME_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32
```

See [docs/SECURITY.md](docs/SECURITY.md) for full threat model.

---

## Tool Reference

### Response envelope

All tools return a normalized envelope:

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

On error: `ok: false`, with `error: { code, message, retryable }`.

### `search`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` (1–500 chars) | required | Search query |
| `limit` | `integer` (1–50) | `5` | Max results |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Full page text or preview |
| `category` | `string` | — | SearXNG category (e.g., `'general'`, `'news'`) |
| `language` | `string` | — | Language code (e.g., `'en'`, `'de'`) |
| `timeRange` | `string` | — | Time filter (e.g., `'day'`, `'week'`, `'month'`) |
| `bypass_cache` | `boolean` | `false` | Skip cache lookup; cache not updated |

**Result (`result.results[]`):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Deterministic hash of source + URL + position |
| `url` | `string` | Canonical result URL |
| `title` | `string` | Page title |
| `excerpt` | `string` | Content preview or full text |
| `source` | `'web'` | Source type |
| `relevance` | `number` (0–1) | Relevance score (if available) |
| `date` | `string` | Publish date ISO string (if available) |

### `read`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` (max 2000 chars) | required | URL to fetch and extract |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Full content or truncated preview |
| `targetWords` | `integer` (1–10000) | — | Target word count for excerpt |
| `language` | `string` | — | Language hint for Jina Reader |
| `bypass_cache` | `boolean` | `false` | Skip cache; cache not updated |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Source URL |
| `title` | `string` | Page title |
| `excerpt` | `string` | Content preview |
| `content` | `string` | Full text (default) |
| `content_mode` | `'full'` \| `'excerpt'` | Mode used |
| `content_truncated` | `boolean` | Whether content was truncated |
| `truncation` | `object` | Truncation details (if truncated) |
| `wordCount` | `integer` | Approximate word count |
| `duration` | `integer` | Extraction duration (ms) |

### `extract`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` (max 2000 chars) | required | URL to extract from |
| `mode` | `'auto'` \| `'static'` \| `'dynamic'` | `'auto'` | Scrapling fetch mode |
| `selector` | `string` | — | Optional CSS selector for targeted extraction |
| `goal` | `string` | — | Optional natural-language extraction goal |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Full content or truncated preview |
| `targetWords` | `integer` (1–10000) | — | Target word count for excerpt mode |
| `maxRecords` | `integer` (1–200) | `25` | Max repeated records returned |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Source URL |
| `title` | `string` | Page title |
| `mode_requested` | `'auto'` \| `'static'` \| `'dynamic'` | Requested mode |
| `mode_used` | `'static'` \| `'dynamic'` | Actual fetch mode used |
| `selector` | `string` | Selector used (if any) |
| `goal` | `string` | Goal used (if any) |
| `excerpt` | `string` | Extracted preview |
| `content` | `string` | Full extracted text |
| `sections` | `array` | High-signal extracted sections |
| `records` | `array` | Repeated extracted records |
| `content_truncated` | `boolean` | Whether excerpt mode truncated output |
| `wordCount` | `integer` | Approximate word count |
| `duration` | `integer` | Extraction duration (ms) |

### `gather`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` (1–500 chars) | required | Research query |
| `maxResults` | `integer` (1–20) | `5` | Max search results |
| `dedup` | `boolean` | `true` | Enable URL deduplication |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Content mode for reads |
| `timeout` | `integer` (1000–60000) | `10000` | Total timeout (ms) |
| `bypass_cache` | `boolean` | `false` | Skip cache for all operations |

**Result:**

| Field | Description |
|-------|-------------|
| `id` | Request-scoped unique ID |
| `prompt` | Original query |
| `context.sources` | Source descriptors (type + URL) |
| `context.results` | Search results (same shape as `search`) |
| `context.reads` | Extracted content (same shape as `read`) |
| `context.dedupStats` | `{ total, deduped }` — dedup statistics |
| `synthesis` | Pre-formatted markdown block for LLM insertion |
| `summary.totalResults` | Total search results |
| `summary.attemptedReads` | URLs attempted (after dedup) |
| `summary.successfulReads` | Successful reads |
| `summary.failedReads` | Failed reads (non-fatal per-URL errors) |
| `summary.totalDuration` | Total elapsed time (ms) |

### `health`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `'searxng'` \| `'jinaReader'` \| `'scrapling'` \| `'all'` | `'all'` | Provider(s) to probe |

**Result:**

| Field | Description |
|-------|-------------|
| `status` | `'healthy'` \| `'degraded'` \| `'unhealthy'` |
| `mcp.stdio.ready` | Whether stdio transport is active |
| `mcp.stdio.version` | MCP server version |
| `mcp.servers[]` | Per-provider: `name`, `provider_id`, `status`, `latency_ms`, `error`, `error_code`, optional version/runtime metadata |
| `provider_governance` | Manifest load status and tracked provider count |
| `resources.memoryMB` | RSS memory (MB) |
| `resources.cwd` | Working directory |
| `timestamp` | ISO-8601 timestamp |

---

## Advanced Topics

### SearXNG Lifecycle Plugin (Optional)

Auto-manage SearXNG Docker lifecycle tied to OpenCode sessions:

```bash
# Install plugin
cp plugin/searxng-lifecycle.ts ~/.config/opencode/plugin/

# Set required env var
export LOCAL_RESEARCHER_COMPOSE_FILE="/absolute/path/to/local-ai-researcher/docker-compose.yml"

# Restart OpenCode
```

**Behavior:**
- First session opens → `docker compose up -d searxng`
- Last session closes → `docker compose down`

Without plugin: SearXNG stays running after OpenCode closes.

### Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript → dist/
pnpm typecheck        # Type check (no emit)
pnpm dev              # Watch mode
pnpm test             # Run tests
pnpm start            # Start MCP server (after build)
```

### Architecture

```
src/
├── index.ts              # MCP stdio entrypoint
├── config.ts             # Environment loading and validation
├── domain/types.ts       # Core domain types and schema
├── lib/                  # Utilities (logger, HTTP, SSRF, cache, errors)
├── providers/            # SearXNG and Jina Reader clients
├── tools/                # MCP tool implementations (search, read, extract, gather, health)
└── docker/               # Optional runtime sidecars (e.g. Scrapling)
```

**Reference docs:**
- [docs/FOUNDATION.md](docs/FOUNDATION.md) — System boundaries
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Technical design
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — Type definitions
- [docs/SECURITY.md](docs/SECURITY.md) — Threat model

---

## License

MIT

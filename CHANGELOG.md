# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-03-31

Initial v1 release. Schema, tool contracts, and provider interfaces are frozen.

### feat

- **Four MCP tools over stdio (frozen v1 schema)**
  - `search` — web search via SearXNG; returns normalized `SearchResult[]` with `id`, `url`, `title`, `excerpt`, `source`, `relevance`, `date`
  - `read` — content extraction from a URL via Jina Reader; returns `ReadResult` with `content`, `content_mode`, `content_truncated`, `wordCount`
  - `gather` — combined search + parallel reads in a single call; returns `GatherResult` with `context`, `synthesis`, `summary`, and dedup statistics
  - `health` — provider connectivity probe; reports `healthy` / `degraded` / `unhealthy` with per-provider latency

- **Provider interfaces**
  - SearXNG provider: configurable endpoint, timeout, SSRF private-network toggle, optional API key
  - Jina Reader provider: configurable endpoint (self-hosted or `https://r.jina.ai/`), timeout, optional API key
  - Provider interface contracts (`SearchProvider`, `ReaderProvider`) are stable across v1

- **Full-content-by-default content policy**
  - `content_mode` defaults to `'full'` on all tools — complete page text is returned unless `'excerpt'` is explicitly requested
  - `targetWords` parameter on `read` controls excerpt length when `content_mode: 'excerpt'`
  - Server-wide default overridable via `LOCAL_RESEARCHER_CONTENT_DEFAULT_MODE`

- **Request-scoped URL deduplication**
  - `gather` deduplicates URLs using canonical form before issuing reads (enabled by default)
  - Controlled per call via `dedup` parameter or server-wide via `LOCAL_RESEARCHER_GATHER_DEDUP_ENABLED`

- **SearXNG Docker Compose bootstrap**
  - `scripts/start.sh` — starts SearXNG via Docker Compose, waits for readiness, then `exec`s the MCP server (clean signal handling, no wrapper orphan)
  - `scripts/stop.sh` — stops the SearXNG container
  - `pnpm start:docker` shortcut

- **SQLite response cache (opt-in, disabled by default)**
  - All four tools support `bypass_cache` parameter for per-call cache bypass
  - Cache keyed per tool + query + relevant options; `gather` caches the full result envelope
  - TTL-based expiry; `meta.cache_status` field on every response (`hit` | `miss` | `bypass` | `disabled`)
  - Enabled via `LOCAL_RESEARCHER_CACHE_ENABLED=true`

- **Locked v1 response envelope**
  - All tools return `ToolResponseEnvelope<T>` with `schema_version: "1"`, `ok`, `meta`, `result` / `error`
  - `meta` includes `request_id` (UUID v4), `timestamp`, `provider_id`, `provider_name`, `applied_limits`, `cache_status`
  - Typed error codes on all failure paths (`ERR_SEARXNG_UNAVAILABLE`, `ERR_READER_UNAVAILABLE`, `ERR_GATHER_TIMEOUT`, `ERR_SSRF_BLOCKED`, …)

- **Environment variable configuration**
  - `LOCAL_RESEARCHER_*` prefix is canonical; bare names accepted for migration
  - All defaults locked: see `src/config.ts` `DEFAULTS` block

### fix

- **SSRF protection** — all outgoing HTTP requests are validated against an SSRF blocklist; private network addresses are blocked by default; `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true` required for localhost SearXNG
- **stdout protocol isolation** — all logs route to stderr; stdout is reserved for MCP JSON-RPC; config errors cannot corrupt the protocol stream
- **Bounded timeouts and retries** — SearXNG 10 s, Jina Reader 15 s, gather 10 s total with 5 s floor per read; HTTP retries capped with exponential backoff
- **Redacted logs** — API keys and credentials are never written to log output

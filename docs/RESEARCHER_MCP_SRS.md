# RESEARCHER MCP - SRS v1

Version: 1.0 (Draft)
Last updated: 2026-03-16

## 1. Purpose

Define the v1 functional and non-functional requirements for a local-first MCP stdio server used by OpenCode for web research.

## 2. Scope

- Runtime: TypeScript on Node.js.
- Transport: MCP stdio.
- v1 providers: SearXNG for search and jina-ai/reader for read/extract.
- Outputs: optimized for AI ingestion.

Non-scope for v1: cloud-provider requirement, persistent indexing or crawling, accounts, and multi-tenancy.

## 3. Normative Defaults

- Default content mode: `full`.
- Excerpting or truncation is optional and must be explicit in metadata.
- Deduplication is request-scoped and enabled by default.
- Cache is optional SQLite support in v1, disabled by default, and bypassable per request.

## 4. Functional Requirements

### FR-1 MCP server behavior

- Must run as an MCP stdio server consumable by OpenCode.
- Must list tools and accept tool calls with validated inputs.

### FR-2 Tools (minimum set)

- Must provide tools for:
  - Search (web)
  - Read (URL extraction)
  - Gather (search plus reads)
  - Health

### FR-3 Search (SearXNG)

- Must execute a query via SearXNG.
- Must return a ranked list of results with normalized fields.
- Should support optional filters when the provider supports them, including limit, language, and time range.

### FR-4 Read (jina-ai/reader)

- Must extract content for a URL via jina-ai/reader.
- Must default to `content_mode = full`.
- Must return metadata indicating:
  - the requested content mode
  - whether the output was truncated
  - which limits were applied, if any

### FR-5 Gather

- Must combine search plus reads into a single response bundle.
- Must default to request-scoped deduplication enabled.
- Must report deduplication outcomes as counts and reuse information.

### FR-6 Deduplication (request-scoped)

- When enabled, repeated URLs within a single tool call must be fetched at most once.
- Must report dedup stats at request level.

### FR-7 Optional SQLite cache

- Must support an optional SQLite cache.
- Must be disabled by default.
- Must support TTL-based expiration.
- Must support per-request bypass.

### FR-8 Configuration

- Must allow configuring provider base URLs.
- Must allow configuring timeouts, concurrency limits, and max bytes.
- Must allow configuring logging level and redaction.

### FR-9 Health

- Must report server readiness.
- Must report provider health for SearXNG and jina-ai/reader.
- Must include an effective configuration summary that is safe to log.

## 5. Tool Contract Requirements (v1)

### 5.1 Common fields

- Each tool response must include a `meta` object with:
  - `request_id`
  - timestamps
  - provider identifiers
  - applied limits such as timeouts, max bytes, and concurrency

### 5.2 Search

Inputs (minimum):

- `query` (required)
- `limit` (optional; default 10; bounded by config)
- `language` (optional)
- `time_range` (optional)

Outputs (minimum):

- `results[]` where each result includes:
  - `title`
  - `url`
  - `snippet` (optional)
  - `provider` (`SearXNG`)

### 5.3 Read

Inputs (minimum):

- `url` (required)
- `content_mode` (`full` or `excerpt`, optional; default `full`)
- `cache` (`use` or `bypass`, optional; default `use`)

Outputs (minimum):

- `url`
- `content`
- `content_mode`
- `content_truncated` (boolean)
- `content_bytes` (integer)
- `provider` (`jina-ai/reader`)

Rules:

- If `content_truncated = true`, the response must include a truncation reason and the applied limit value.
- Excerpting must only occur when explicitly requested or when required by enforced limits; either case must be explicit in metadata.

### 5.4 Gather

Inputs (minimum):

- `query` (required)
- `max_results` (optional; default 5)
- `read` options (optional; default `content_mode = full`)
- `dedup` (optional; default true)
- `cache` (optional; default `use`)

Outputs (minimum):

- A structured bundle that includes:
  - ranked sources
  - extracted content blocks (full by default)
  - per-item metadata
  - request-level dedup stats
- A text payload suitable for prompt injection.

## 6. Non-Functional Requirements

### NFR-1 SSRF protection (mandatory)

- Must SSRF-protect every outbound HTTP request.
- Must block private and link-local IP ranges by default.
- Must defend against DNS rebinding.
- Must apply SSRF checks across redirects.
- Should support explicit allowlists for controlled environments.

### NFR-2 Bounded resource use

- Must enforce timeouts on outbound requests.
- Must enforce maximum bytes for extracted content.
- Must enforce concurrency limits.
- Must surface limit enforcement outcomes in response metadata.

### NFR-3 Logging and redaction

- Must log to stderr only.
- Must redact logs by default.
- Must not log full extracted content or secrets.
- Should log request ids, timings, and stable error codes.

### NFR-4 Transparency

- Must make truncation and excerpting explicit.
- Should make provider variability diagnosable via metadata.

## 7. Error Handling

- Must return structured errors with:
  - stable `code`
  - human-readable `message`
  - `retryable` boolean
  - `request_id`
- Should distinguish validation errors, SSRF blocks, provider unavailability, timeouts, and limit enforcement.

## 8. Acceptance Verification (v1)

- Defaults match: full content mode, request-scoped dedup on, cache optional and off by default.
- Excerpting or truncation is always explicit in metadata.
- SSRF protections block private and internal targets by default and apply across redirects.
- Resource limits are enforced and visible in metadata.
- Logs are redacted and written to stderr only.

# Researcher MCP - SRS (v2)

This is the canonical SRS summary for the current v2 direction.

Source: supersedes the earlier v1 summary derived from `docs/RESEARCHER_MCP_SRS.md` (non-canonical).

## Normative Defaults

- `content_mode`: `full` (excerpting/truncation must be explicit)
- Dedup: request-scoped, enabled by default where aggregation occurs
- Cache: optional SQLite support exists; disabled by default; bypassable per request
- Existing v1 tool behavior must remain contract-stable unless a versioned contract change is explicitly approved

## Tool Set

### Stable baseline

- `search` (SearXNG)
- `read` (`jina-ai/reader`)
- `gather` (search + reads + dedup)
- `health` (server + provider health)

### v2 additive scraping surface

- `scrape_page` (Scrapling-backed page scraping for known URLs)
- `scrape_listing` (Scrapling-backed repeated-record scraping for listing/category/search-result pages)
- `scrape_many` (parallel page scraping across multiple known URLs)

## Retrieval Lane Requirements

### Discovery lane (`search`)

- Must continue returning normalized search results from SearXNG
- Must remain provider-abstracted so provider replacement or multi-provider expansion does not change the MCP-facing contract

### Dork discovery lane (`search_dork`)

- Must force the Google engine through local SearXNG rather than mutating global SearXNG config
- Must be framed as operator-heavy discovery, not guaranteed raw Google-equivalent semantics in every environment
- Must fail clearly when the local SearXNG provider is unavailable

### Fast read lane (`read`)

- Must remain optimized for article/docs-style readable extraction
- Must continue using explicit truncation signaling when excerpt mode is used
- Must not silently become a browser-heavy or Scrapling-backed lane in v2

### Page scraping lane (`scrape_page`)

- Must support scraping a known URL for data-oriented extraction
- Must accept AI-meaningful task hints such as goal, entity type, and requested fields
- Must be suitable for JS-heavy or app-like pages without exposing low-level fetcher choice to the caller
- Must remain additive to `read`, not a hidden replacement for it

### Listing scraping lane (`scrape_listing`)

- Must support repeated-record extraction from listing/category/search-result pages
- Must accept AI-meaningful task hints such as entity type, requested fields, and optional selector hints
- Must favor record-oriented output over generic page prose

### Parallel scraping lane (`scrape_many`)

- Must support parallel scraping of multiple known URLs using a shared extraction intent
- Must return per-URL results plus summary metadata suitable for AI follow-up reasoning

## Provider Governance Requirements

- Every runtime provider dependency must be explicitly pinned or otherwise made version-deterministic
- Governance scope includes:
  - SearXNG deployment version/image
  - Jina Reader deployment version/image
  - Scrapling sidecar image/runtime version when introduced
  - supporting runtime constraints required for provider correctness (for example Python/browser requirements where applicable)
- The system must maintain a canonical record of expected provider/runtime versions and compatibility assumptions
- Provider drift must be testable through contract or compatibility checks

## Health and Diagnostics Requirements

- `health` must report provider readiness and connectivity
- `health` should evolve to expose version/compatibility information for each configured provider runtime
- Diagnostics must help distinguish:
  - provider unreachable
  - provider misconfigured
  - provider contract drift
  - local runtime dependency mismatch

## Contract Requirements (Highlights)

- Every tool response includes `meta` with:
  - `request_id`
  - timestamps
  - provider identifiers
  - applied limits (timeouts/max bytes/concurrency)
  - cache status
- `read` output must include:
  - `content_mode`
  - `content_truncated` boolean
  - applied truncation reason/limit when truncated
- `gather` output must include:
  - request-level dedup stats
  - AI-ingestible text payload + structured payload
- `scrape_page` output must preserve provenance and include enough structure for downstream AI use, such as extracted sections, records, and requested-field hints
- `scrape_listing` output must preserve provenance and return structured repeated records suitable for product/job/event/directory workflows
- `scrape_many` output must preserve per-URL provenance and summarize successes/failures across the batch

## Compatibility Rules

- v2 must preserve v1 `search`, `read`, `gather`, and `health` semantics unless an explicit contract version change is introduced
- New capability should be added through task-shaped tools or clearly versioned behavior, not by silently mutating existing tool meaning
- Any provider-specific data must be normalized before leaving the MCP boundary

## AI Routing Requirement

The MCP surface must help AI callers choose tools by task shape rather than by low-level scraping mechanism.

- Use `read` when the expected output is narrative/prose understanding.
- Use `scrape_page` when the expected output is fields/data from one known page.
- Use `scrape_listing` when the expected output is repeated records from a listing page.
- Use `scrape_many` when the same extraction task must be applied to many known URLs.

## Security + Privacy (Mandatory)

- SSRF protection on every outbound request
- Redirect handling cannot bypass SSRF checks
- Bounded resources: timeouts, concurrency limits, max response sizes, and any browser/process limits introduced by Scrapling
- Redacted logging by default; no secrets and no full extracted content in logs
- Dynamic extraction paths must not weaken the existing security baseline

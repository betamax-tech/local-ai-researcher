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

### v2 additive lane

- `extract` (Scrapling-backed structured or dynamic extraction, preferably distributed through an optional Docker sidecar)

## Retrieval Lane Requirements

### Discovery lane (`search`)

- Must continue returning normalized search results from SearXNG
- Must remain provider-abstracted so provider replacement or multi-provider expansion does not change the MCP-facing contract

### Fast read lane (`read`)

- Must remain optimized for article/docs-style readable extraction
- Must continue using explicit truncation signaling when excerpt mode is used
- Must not silently become a browser-heavy or Scrapling-backed lane in v2

### Deep extraction lane (`extract`)

- Must support targeted extraction from a known URL
- Must be suitable for JS-heavy, listing-oriented, or repeated-entity pages
- Must return AI-usable output that favors structure over raw page dumps when possible
- Must be additive to `read`, not a hidden replacement for it

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
- `extract` output must include enough structure for downstream AI use, such as extracted sections, records, or targeted page fragments, while preserving provenance and lane identity

## Compatibility Rules

- v2 must preserve v1 `search`, `read`, `gather`, and `health` semantics unless an explicit contract version change is introduced
- New capability should be added through new tools or clearly versioned behavior, not by silently mutating existing tool meaning
- Any provider-specific data must be normalized before leaving the MCP boundary

## Security + Privacy (Mandatory)

- SSRF protection on every outbound request
- Redirect handling cannot bypass SSRF checks
- Bounded resources: timeouts, concurrency limits, max response sizes, and any browser/process limits introduced by Scrapling
- Redacted logging by default; no secrets and no full extracted content in logs
- Dynamic extraction paths must not weaken the existing security baseline

---
id: "06.01"
title: "Validate canonical v1 baseline"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 1
depends_on: []
blocks: ["07.01", "07.02", "07.03"]
parent: "06"
branch: "feat/task-06-v1-execution-validation"
assignee: dev
enriched: true
rmcp_id: "RMCP-00-A"
---

# Task 06.01: Validate Canonical V1 Baseline

## Business Requirements

### Problem
The current codebase already runs, but the existing sprint artifacts describe an older product story. The team needs a verified baseline that states what already matches the locked Researcher MCP direction and what must change before implementation resumes.

### User Story
As the product team, I want a validated baseline for the current server so that every later task targets a real gap against the canonical v1 direction.

### Acceptance Criteria
- [ ] The validation confirms whether the server can be treated as an OpenCode-first MCP stdio product with exactly the v1 tool set: `search`, `read`, `gather`, and `health`.
- [ ] The validation confirms whether the current default read behavior is full content or excerpted content and records any mismatch against the canonical `content_mode: full` rule.
- [ ] The validation confirms whether the active provider direction is limited to self-hosted SearXNG plus self-hosted `jina-ai/reader`, with any extra source concepts called out as non-canonical.
- [ ] The validation confirms whether request-scoped deduplication, outbound safety controls, resource bounds, and redacted logging are already present, partial, or missing.
- [ ] The outcome identifies only follow-on work that belongs inside the locked v1 scope and does not change product code as part of the validation itself.

### Business Rules
- Canonical truth comes from the four Researcher MCP documents under `vault/ai/docs/`.
- Validation must treat full-content default as the approved behavior even if current code differs.
- Validation must treat optional SQLite cache as supported-but-disabled scope, not as mandatory runtime behavior.

### Out of Scope
- Implementing schema changes, provider changes, or packaging changes.
- Reopening v1 scope around local files, custom sources, or alternate transports.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Integration audit** — This is a read-only validation task that compares current code against canonical docs. No code changes are permitted; output is a gap report.

**Pattern: Spec-conformance audit** — Read each module, compare against `vault/ai/docs/researcher-mcp-srs.md` and `researcher-mcp-prd.md`, record alignment status.

**Rationale:** Validation must not alter the baseline it measures. A separate implementation task will address gaps.

## Affected Areas

- `src/domain/types.ts` — verify current response shapes vs. SRS contract
- `src/providers/searxng.ts` — verify SearXNG-only v1 provider status
- `src/providers/jinaReader.ts` — verify reader provider alignment and content mode
- `src/tools/read.ts` — verify content_mode default (full vs excerpt)
- `src/tools/gather.ts` — verify dedup behavior
- `src/lib/ssrf.ts` — verify SSRF guardrails exist
- `src/lib/http.ts` — verify timeout/bounds configuration
- `src/lib/logger.ts` — verify redaction behavior
- `src/config.ts` — verify provider config matches v1 (SearXNG + jina-ai/reader only)

## Quality Gates

- Gap report explicitly answers: (1) tool set match, (2) content_mode default, (3) provider scope, (4) safety features present/partial/missing
- Gap report does not include code patches or implementation suggestions
- Gap report cites specific file:line references for each finding

## Gotchas

- Current code may have partial implementations that appear correct but miss edge cases — flag these as "partial" rather than "present"
- Do not assume existing tests validate canonical behavior; they may test legacy assumptions

---

## Validation Findings

### 1. Tool Set Match

**Status: PRESENT**

All four v1 tools exist in `src/tools/`:
- `search.ts` — SearXNG-backed search
- `read.ts` — Jina Reader-backed URL extraction
- `gather.ts` — Combined search + parallel reads with dedup
- `health.ts` — Server + provider health check

Evidence: `src/tools/` directory contains all four tool files (glob confirmed).

### 2. Content Mode Default

**Status: MISMATCH — Code implements excerpt-first; canonical requires full-content default**

Canonical direction (`researcher-mcp-prd.md:16`): "Content policy: full content default; truncation/excerpt must be explicit"
Canonical SRS (`researcher-mcp-srs.md:9`): `content_mode: full` (excerpting/truncation must be explicit)

Current implementation:
- `src/domain/types.ts:46-49`: "excerpt is always returned (30 lines or full if fullText requested). Full text only when `fullText: true` requested."
- `src/tools/read.ts:28-32`: "Return full text instead of 30-line excerpt (default: false). Excerpt-first is the locked v1 default."
- `src/tools/gather.ts:54-57`: "Retrieve full text for reads instead of 30-line excerpts (default: false). Opt-in: excerpt-first is the locked v1 default."
- `src/providers/jinaReader.ts:51-56`: Excerpt-first model with 30-line default

**Gap**: The code defaults to excerpt mode (30 lines). The canonical v1 direction requires full content by default with explicit truncation opt-in.

### 3. Provider Scope

**Status: MATCH — SearXNG + jina-ai/reader only**

Provider configuration in `src/config.ts:201-214` defines exactly two providers:
- `searxng` — SearXNG endpoint
- `jinaReader` — Jina Reader endpoint

Domain types in `src/domain/types.ts:266-294` define only `SearxngConfig` and `JinaReaderConfig`.

**Note**: `src/domain/types.ts:24` defines `SourceType = 'web' | 'local' | 'custom'` which includes out-of-scope types, but config only supports `web` via SearXNG.

### 4. Safety Baseline

#### 4a. SSRF Protection
**Status: PRESENT**

- `src/lib/ssrf.ts:85-144` — `validateSsrf()` with DNS resolution, private range blocking, cloud metadata blocking
- `src/lib/http.ts:92` — Every outbound request calls `validateSsrf()` before execution
- `src/lib/ssrf.ts:13-21` — Private IPv4 ranges defined (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, etc.)

#### 4b. Resource Bounds
**Status: PRESENT**

- `src/lib/http.ts:94-95` — Timeout configuration from config
- `src/lib/http.ts:143-145` — AbortController with configurable timeout
- `src/config.ts:35-38` — HTTP_TIMEOUT, HTTP_MAX_RETRIES, HTTP_RETRY_DELAY, HTTP_MAX_RETRY_DELAY defaults

#### 4c. Redacted Logging
**Status: PARTIAL**

- `src/lib/logger.ts:54` — Logs to stderr (correct for MCP stdio)
- **MISSING**: No explicit redaction mechanism for secrets or full extracted content
- Provider logging (`src/providers/searxng.ts:146-151`, `src/providers/jinaReader.ts:149-154`) logs URLs without redaction

SRS requirement (`researcher-mcp-srs.md:40`): "Redacted logging by default; no secrets and no full extracted content in logs"

#### 4d. Redirect SSRF Re-validation
**Status: MISSING**

- `src/lib/http.ts` uses native `fetch` which follows redirects by default
- No explicit re-validation of SSRF on redirect targets
- SRS requirement (`researcher-mcp-srs.md:38`): "Redirect handling cannot bypass SSRF checks"

### 5. Request-Scoped Deduplication

**Status: PRESENT — Enabled by default**

- `src/tools/gather.ts:51` — `dedup: z.boolean().optional().default(true)`
- `src/tools/gather.ts:269-283` — `deduplicateUrls()` using canonical URL normalization
- `src/config.ts:54` — `GATHER_DEDUP_ENABLED: 'true'` default

### 6. Tool Response Envelope Contract

**Status: PARTIAL**

Envelope structure (`src/domain/types.ts:243-260`):
- ✓ `schema_version` present
- ✓ `ok` boolean present
- ✓ `result` / `error` structure

Missing from SRS (`researcher-mcp-srs.md:22-26`):
- ✗ `request_id` — not in envelope
- ✗ Timestamps — not in envelope
- ✗ Provider identifiers — not in envelope
- ✗ Applied limits (timeouts/max bytes/concurrency) — not in envelope

Read output missing (`researcher-mcp-srs.md:27-30`):
- ✗ `content_mode` field
- ✗ `content_truncated` boolean
- ✗ Truncation reason/limit when truncated

### Summary Table

| Quality Gate Question | Status | Notes |
|----------------------|--------|-------|
| Tool set match (search, read, gather, health) | PRESENT | All four tools exist |
| Content mode default = full | MISMATCH | Code defaults to excerpt (30-line) |
| Provider scope (SearXNG + jina only) | MATCH | Exactly two providers configured |
| SSRF protection | PRESENT | validateSsrf() on every outbound request |
| Resource bounds (timeouts/limits) | PRESENT | HTTP client has configurable bounds |
| Redacted logging | PARTIAL | Logs to stderr but no explicit redaction |
| Redirect SSRF re-validation | MISSING | No redirect-aware SSRF checks |
| Request-scoped dedup | PRESENT | Enabled by default in gather |
| Envelope meta fields | PARTIAL | Missing request_id, timestamps, provider, limits |
| Read content_mode/truncated fields | MISSING | Not in ReadResult type |

---

## Changes

- Updated task file with `## Validation Findings` section documenting baseline gap analysis
- No product code changes (read-only validation task)

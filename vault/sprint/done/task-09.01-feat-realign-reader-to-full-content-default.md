---
id: "09.01"
title: "Realign reader outputs to full-content default"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 3
depends_on: ["07.01", "07.02", "07.03"]
blocks: ["09.02", "10.01"]
parent: "09"
branch: "feat/task-09-reader-provider-v1"
assignee: dev
enriched: true
rmcp_id: "RMCP-03-A"
---

# Task 09.01: Realign Reader Outputs To Full-Content Default

## Business Requirements

### Problem
The current direction in code and old planning material still centers on excerpt-first reading. That conflicts with the locked v1 contract and creates the highest-risk gap between current behavior and the canonical release promise.

### User Story
As an OpenCode user, I want a default `read` response to return full extracted page content so that my downstream prompts receive the complete context unless I explicitly choose a smaller payload.

### Acceptance Criteria
- [x] A default `read` call against the configured self-hosted reader returns full extracted content as the normal success behavior.
- [x] When the caller explicitly requests a shorter payload, the response clearly identifies the selected truncation or excerpt mode.
- [x] When a hard limit forces truncation, the response states that truncation happened, why it happened, and what limit was applied.
- [x] Reader responses keep the shared metadata and provenance contract needed for later schema freeze.
- [x] `gather` can rely on the same default read behavior for fetched pages without introducing a second content policy.

### Business Rules
- `jina-ai/reader` is the approved v1 read provider.
- Full content is the default user promise.
- Explicit excerpting or truncation must be caller-driven unless a documented bound is triggered.

### Out of Scope
- Search-provider changes.
- Optional cache behavior.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Data shape + Integration** — This is the highest-risk task because it represents the largest behavior gap from the current (likely excerpt-first) baseline.

**Pattern: Default-full with explicit-reduction** — `read` returns complete extracted content unless caller explicitly requests truncation OR a hard bound is hit.

**Rationale:** AI workflows lose critical context with silent truncation. Full content default ensures completeness; explicit reduction gives caller control.

**Constraints this creates:**
- `content_mode: "full"` is the default in tool schema and runtime behavior
- Truncation options are opt-in parameters, not defaults
- When truncation occurs (bound-triggered), response must explain why

## Affected Areas

- `src/providers/jinaReader.ts` — critical: verify/configure reader to return full content by default; handle reader's own truncation behavior
- `src/tools/read.ts` — set `content_mode: "full"` as default; add `content_mode` parameter for explicit truncation/excerpt
- `src/domain/types.ts` — ensure `ReadResult` includes `content_mode`, `content_truncated`, `truncation_reason`, `applied_limit`
- `src/tools/gather.ts` — inherit content policy for nested reads; aggregate truncation status across all fetched pages
- `src/config.ts` — define content-related bounds (max_bytes) with clear defaults

## Quality Gates

- Default `read` call (no parameters) returns full content from reader provider
- Response `content_mode` is `"full"` when no truncation applied
- Explicit `content_mode: "excerpt"` returns truncated content with clear indication
- Hard bound triggered → response includes `content_truncated: true`, `truncation_reason`, `applied_limit`
- `gather` correctly aggregates truncation status: if any read truncated, gather reports truncation
- Full content fixture test: known URL returns expected full content (not excerpt)

## Gotchas

- **CRITICAL:** `jina-ai/reader` may apply its own truncation — verify adapter configuration disables this OR detects and reports it
- Large pages may hit max_bytes bound; ensure graceful truncation with clear reporting
- Changing default from excerpt to full will increase response sizes — verify no timeout regressions
- Existing tests may assume excerpted output; will need updates

**Risk Rating:** HIGHEST — This task has the largest behavior delta from current state and gates the critical path.

---
<!-- COMPLETION - appended by Orchestrator after verification -->

## Changes
- `src/providers/jinaReader.ts` — verified the adapter preserves full extracted content by default and only applies truncation when `content_mode: "excerpt"` is requested
- `src/tools/read.ts` — verified the tool defaults `content_mode` to `full`, preserves shared response metadata, and surfaces truncation metadata in the envelope
- `src/tools/gather.ts` — verified nested reads inherit the default full-content policy unless explicitly overridden
- `src/tools/read.test.ts` — added hard-limit coverage for `provider_limit` and `max_bytes` truncation metadata
- `src/providers/jinaReader.test.ts` — added provider-boundary coverage for full-content default, explicit excerpt mode, request shaping, and typed reader error handling
- Verification — `pnpm test` passed with 289/289 tests and `pnpm typecheck` passed with zero errors

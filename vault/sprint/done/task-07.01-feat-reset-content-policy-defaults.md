---
id: "07.01"
title: "Reset content policy defaults"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 2
depends_on: ["06.01"]
blocks: ["08.01", "09.01"]
parent: "07"
branch: "feat/task-07-contract-reset"
assignee: dev
enriched: true
rmcp_id: "RMCP-01-A"
---

# Task 07.01: Reset Content Policy Defaults

## Business Requirements

### Problem
The old sprint story and current code indicate excerpt-first behavior, but the canonical product direction now requires full content by default. The content policy must be reset before provider work can be completed against the right user promise.

### User Story
As an OpenCode user, I want reads and gathers to return full content by default so that I do not lose context unless I explicitly request truncation or excerpting.

### Acceptance Criteria
- [ ] A default `read` request returns full extracted content rather than an implicit excerpt-only response.
- [ ] Any truncated or excerpted `read` response clearly reports that truncation was applied, why it happened, and what limit caused it.
- [ ] A default `gather` request inherits the same full-content-by-default rule for fetched pages.
- [ ] No response path silently shortens content unless the request explicitly asks for it or a documented enforced limit is triggered.
- [ ] Product-facing tool descriptions and request options no longer imply excerpt-first behavior as the normal path.

### Business Rules
- `content_mode` defaults to `full`.
- Truncation and excerpting are explicit user choices unless a hard safety/resource bound is hit.
- When truncation happens, the response must surface `content_truncated` and the applied reason.

### Out of Scope
- Search ranking changes.
- Cache behavior.
- Packaging changes.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Data shape** — The content policy controls default response size and truncation behavior across all read paths.

**Pattern: Default-overload with explicit-opt-out** — `content_mode: full` is the baseline; truncation/excerpting only occurs when (1) caller explicitly requests it, or (2) a hard resource bound is triggered.

**Rationale:** Full-content default maximizes downstream AI context without hidden data loss. Explicit truncation ensures caller awareness.

**Constraints this creates:**
- Every `read` and `gather` response must include `content_mode` and `content_truncated` fields
- Truncation reasons must be machine-readable and user-visible
- Provider adapters must not apply implicit excerpting

## Affected Areas

- `src/domain/types.ts` — add/lock `content_mode` enum, `content_truncated` boolean, truncation reason types
- `src/providers/jinaReader.ts` — ensure full content passthrough; add explicit truncation only when bounds triggered
- `src/tools/read.ts` — set `content_mode: full` as default; expose truncation options in tool schema
- `src/tools/gather.ts` — inherit content policy for nested reads; report aggregate truncation status
- `src/config.ts` — add content policy defaults to configuration schema

## Quality Gates

- Default `read` request returns full content (measured by response byte count vs. known full-page fixture)
- Response includes `content_mode: "full"` when no truncation applied
- When truncation occurs, response includes `content_truncated: true`, `truncation_reason`, and `applied_limit` fields
- Tool schema in MCP manifest reflects content_mode options correctly

## Gotchas

- `jina-ai/reader` may have its own truncation behavior — verify adapter doesn't silently lose content
- `gather` performs multiple reads; truncation status must aggregate correctly
- Changing defaults may break existing tests that assume excerpted output

---
<!-- COMPLETION — appended by Orchestrator after verification -->

## Changes
- `src/domain/types.ts` — added `ContentMode`, `ContentTruncation` types; updated `ReadOptions`, `ReadResult`, `GatherOptions` with content_mode and truncation fields
- `src/providers/jinaReader.ts` — full content passthrough by default; explicit truncation metadata on response
- `src/tools/read.ts` — `content_mode` defaults to `full`; truncation options exposed in tool schema
- `src/tools/gather.ts` — inherits content policy for nested reads; aggregate truncation status
- `src/config.ts` — content policy defaults added
- `src/tools/read.test.ts` — new: content policy BDD tests
- `src/tools/gather.test.ts` — updated: reflects full-content-default behavior

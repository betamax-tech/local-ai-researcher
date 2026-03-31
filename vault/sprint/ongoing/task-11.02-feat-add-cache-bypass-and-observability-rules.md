---
id: "11.02"
title: "Add cache bypass and observability rules"
type: feat
priority: medium
complexity: S
difficulty: moderate
sprint: 5
depends_on: ["11.01"]
blocks: []
parent: "11"
branch: "feat/task-11-optional-sqlite-cache"
assignee: dev
enriched: true
rmcp_id: "RMCP-05-B"
---

# Task 11.02: Add Cache Bypass And Observability Rules

## Business Requirements

### Problem
Optional cache support is incomplete if operators and callers cannot tell when cached behavior was used or bypass it when correctness matters more than reuse. The canonical direction requires bypassable cache behavior rather than hidden persistence.

### User Story
As an operator or caller, I want cache usage to be explicit and bypassable so that I can choose fresh retrieval when needed.

### Acceptance Criteria
- [ ] Requests can explicitly bypass cache behavior when the caller wants fresh results.
- [ ] Responses or operational metadata make cache use observable enough for troubleshooting.
- [ ] Cache bypass does not change the frozen response contract beyond the allowed cache-related metadata.
- [ ] Disabled-by-default behavior remains unchanged when cache features are not enabled.

### Business Rules
- Cache bypass must work per request.
- Observability must distinguish cache hits, cache misses, and bypassed requests.

### Out of Scope
- Changes to the default uncached startup path.
- Release packaging.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: State lifecycle** — Cache must be bypassable per-request and its usage must be observable.

**Pattern: Opt-out-cache-with-observability** — Requests can force fresh fetch; responses report cache status in metadata.

**Rationale:** Operators need control over cache for freshness-critical scenarios. Observability enables debugging cache-related issues.

**Constraints this creates:**
- `bypass_cache` parameter available on all cacheable tools
- Response metadata includes `cache_status: "hit" | "miss" | "bypass" | "disabled"`
- Bypass does not affect cache state for other requests

## Affected Areas

- `src/lib/cache.ts` — add bypass logic; return appropriate status
- `src/tools/search.ts` — add `bypass_cache` parameter to tool schema
- `src/tools/read.ts` — add `bypass_cache` parameter to tool schema
- `src/tools/gather.ts` — add `bypass_cache` parameter; propagate to constituent reads
- `src/domain/types.ts` — add `cache_status` enum to response metadata

## Quality Gates

- `bypass_cache: true` returns fresh results even if valid cache entry exists
- Response includes `cache_status` field with values: `hit`, `miss`, `bypass`, `disabled`
- `cache_status: "disabled"` when cache is not enabled in config
- Bypass does not invalidate existing cache entries for other requests
- Observability: logs distinguish cache hit/miss/bypass for troubleshooting

## Gotchas

- `gather` bypass must propagate to all nested reads — verify end-to-end
- Cache status must be accurate; no false "hit" when bypass was requested
- Consider: should bypass update cache with fresh result? Document the decision.

---
id: "08.02"
title: "Verify search readiness and failure states"
type: feat
priority: medium
complexity: S
difficulty: moderate
sprint: 3
depends_on: ["08.01"]
blocks: ["10.02"]
parent: "08"
branch: "feat/task-08-searxng-provider-v1"
assignee: dev
enriched: true
rmcp_id: "RMCP-02-B"
---

# Task 08.02: Verify Search Readiness And Failure States

## Business Requirements

### Problem
Operators need an explicit answer when search is healthy, degraded, or unavailable. The canonical v1 plan calls for readiness reporting that reflects the real provider state, not only whether the server process started.

### User Story
As an operator, I want search readiness and failure states to be explicit so that I can tell whether the Researcher MCP is safe to use before I depend on it in OpenCode.

### Acceptance Criteria
- [ ] Readiness reporting states whether the search lane is ready against the configured SearXNG provider.
- [ ] Search-provider failures are surfaced in a user-comprehensible way that distinguishes availability problems from validation or safety problems.
- [ ] Readiness output keeps the shared traceability metadata needed for contract testing.
- [ ] Search readiness behavior can be validated independently from the reader lane.

### Business Rules
- Readiness must report provider reachability, not only local process health.
- Failure reporting must stay consistent with the locked v1 error semantics.

### Out of Scope
- Reader readiness.
- Packaging or release documentation.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Integration** — Readiness reporting must reflect actual provider connectivity, not just process startup.

**Pattern: Health-check-with-provenance** — Health tool queries each provider's health endpoint and reports readiness with traceability metadata.

**Rationale:** Operators need to know if SearXNG is reachable before relying on search. "Server started" is insufficient.

**Constraints this creates:**
- Health check must perform real network call to SearXNG
- Health response distinguishes: ready, degraded, unavailable
- Failure states are mapped to specific error categories

## Affected Areas

- `src/tools/health.ts` — add search-lane readiness check that calls SearXNG health/ping endpoint
- `src/providers/searxng.ts` — expose `checkHealth()` method returning provider status
- `src/domain/types.ts` — define `ProviderHealth` type with status enum and latency
- `src/lib/errors.ts` — ensure search-specific failures have distinct error codes

## Quality Gates

- `health` response includes `search` lane status: `ready | degraded | unavailable`
- Search health check makes actual HTTP call to configured SearXNG instance
- Response includes latency measurement for search lane
- SearXNG unreachable → status `unavailable` with error details in meta
- SearXNG slow (above threshold) → status `degraded` with latency in meta
- Search readiness independent from reader readiness (can report one ready, other not)

## Gotchas

- SearXNG may not have a dedicated health endpoint; use a lightweight search query (e.g., empty or known term)
- Network timeout during health check must not hang the health tool — use short timeout
- Health check frequency should not overwhelm provider — consider caching health status briefly

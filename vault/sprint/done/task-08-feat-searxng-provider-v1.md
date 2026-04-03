---
id: "08"
title: "Deliver SearXNG provider v1"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 3
depends_on: ["07.01", "07.02", "07.03"]
blocks: ["08.01", "08.02"]
branch: "feat/task-08-searxng-provider-v1"
assignee: pm
enriched: true
rmcp_id: "RMCP-02"
---

# Epic 08: Deliver SearXNG Provider V1

## Vision
Complete the search lane against the locked v1 provider choice. This epic turns the approved self-hosted SearXNG direction into a normalized, testable, operator-ready search experience.

## Requirements
- Deliver normalized search results from self-hosted SearXNG.
- Preserve canonical response metadata and failure semantics.
- Expose readiness signals that let operators understand whether search is available.

## Non-Functional Requirements
- Search behavior must stay within the locked safety/resource baseline.
- Search outputs must be stable enough for Wave 4 schema freeze.

## Success Metrics
- Search responses are canonical and traceable.
- Search readiness and failure behavior are explicit enough for contract testing.

## Out of Scope
- Additional search providers.
- Search-side caching policy beyond the optional Wave 5 cache work.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Epic-level guidance; subtasks contain implementation details -->

## Architecture Notes

**Epic Type: Provider Delivery** — Search lane implementation against locked v1 provider.

**Parallelism:** This epic runs in parallel with Epic 09 (Reader) after Wave 2 completes.

**Pattern:** Normalize provider output → Verify readiness → Lock for schema freeze.

## Affected Areas

- `src/providers/searxng.ts` — provider adapter
- `src/tools/search.ts` — search tool wrapper
- `src/tools/health.ts` — search lane readiness

## Quality Gates

- 08.01 (normalization) completes before 08.02 (readiness verification)
- Search lane ready for schema freeze (10.01)

## Gotchas

- SearXNG version differences may affect response format — test against target version
- This epic is NOT on the critical path; reader lane (09.01) carries the larger behavior change

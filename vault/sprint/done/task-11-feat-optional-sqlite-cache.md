---
id: "11"
title: "Add optional SQLite cache"
type: feat
priority: medium
complexity: M
difficulty: complex
sprint: 5
depends_on: ["10.01"]
blocks: ["11.01", "11.02"]
branch: "feat/task-11-optional-sqlite-cache"
assignee: pm
enriched: true
rmcp_id: "RMCP-05"
---

# Epic 11: Add Optional SQLite Cache

## Vision
Extend the v1 server with optional persistence without changing the default local-first uncached behavior. This epic captures the approved cache scope as additive, explicit, and safely outside the main release critical path.

## Requirements
- Support SQLite-backed caching as an optional capability.
- Keep cache disabled by default.
- Allow callers and operators to bypass cache behavior when needed.

## Non-Functional Requirements
- Cache behavior must not change the default request contract when disabled.
- Cache work must preserve the locked safety/privacy baseline.

## Success Metrics
- Operators can enable cache deliberately.
- Default uncached behavior stays identical to the frozen v1 contract.

## Out of Scope
- Mandatory caching.
- Persistent indexing, crawling, or knowledge-base features.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Epic-level guidance; subtasks contain implementation details -->

## Architecture Notes

**Epic Type: Additive Feature** — Optional cache that does NOT affect default behavior.

**NOT on Critical Path:** Cache work can complete in parallel with packaging (12.01) after schema freeze.

**Pattern:** Opt-in cache layer → Bypass/observability → Preserve uncached contract.

## Affected Areas

- `src/lib/cache.ts` — new module for SQLite cache
- `src/config.ts` — cache configuration (disabled by default)
- `src/providers/*.ts` — optional cache wrapper
- `src/tools/*.ts` — cache_status in response metadata

## Quality Gates

- Cache disabled by default; zero overhead when disabled
- Cache enabled does not change response shape (only adds metadata)
- Cache bypass works per-request

## Gotchas

- This epic is OPTIONAL for v1 release — can ship without cache if time-constrained
- Cache key must include content_mode (full vs excerpt are different entries)
- Do not cache error responses (or use very short TTL)

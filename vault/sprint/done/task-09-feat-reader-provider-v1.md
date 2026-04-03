---
id: "09"
title: "Deliver reader provider v1"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 3
depends_on: ["07.01", "07.02", "07.03"]
blocks: ["09.01", "09.02"]
branch: "feat/task-09-reader-provider-v1"
assignee: pm
enriched: true
rmcp_id: "RMCP-03"
---

# Epic 09: Deliver Reader Provider V1

## Vision
Complete the read lane against the canonical v1 promise that reading returns full content by default and surfaces explicit truncation when limits apply. This epic carries the main behavior correction from the legacy excerpt-first direction into the new release plan.

## Requirements
- Deliver `read` behavior through self-hosted `jina-ai/reader`.
- Make full-content default the normal path while keeping explicit truncation and excerpt support.
- Preserve provenance, failure semantics, and readiness reporting.

## Non-Functional Requirements
- Reader behavior must honor the mandatory safety/resource baseline.
- Reader outputs must be stable enough for schema freeze and contract tests.

## Success Metrics
- Default reads return the expected full-content behavior.
- Reader readiness and provenance are explicit enough for operator use and contract testing.

## Out of Scope
- Search ranking changes.
- Persistent storage beyond the optional cache epic.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Epic-level guidance; subtasks contain implementation details -->

## Architecture Notes

**Epic Type: Provider Delivery (HIGH RISK)** — Reader lane implementation with the largest behavior delta from current state.

**Critical Path:** 09.01 is on the critical path. The full-content default change is the primary v1 behavior correction.

**Pattern:** Realign defaults → Verify readiness → Lock for schema freeze.

## Affected Areas

- `src/providers/jinaReader.ts` — provider adapter (CRITICAL: verify full-content passthrough)
- `src/tools/read.ts` — read tool with content_mode parameter
- `src/tools/gather.ts` — inherits reader content policy
- `src/tools/health.ts` — reader lane readiness

## Quality Gates

- 09.01 (full-content realignment) is HIGHEST RISK — prioritize careful implementation
- 09.01 must complete before 09.02 (readiness verification)
- Reader lane ready for schema freeze (10.01)

## Gotchas

- **CRITICAL PATH TASK:** 09.01 delays cascade to 10.01, 10.02, 12.02
- Existing tests may assume excerpt-first behavior; expect test updates
- jina-ai/reader may have its own truncation — verify adapter disables or detects this

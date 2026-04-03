---
id: "07"
title: "Reset v1 contracts to canonical defaults"
type: feat
priority: high
complexity: L
difficulty: complex
sprint: 2
depends_on: ["06.01"]
blocks: ["07.01", "07.02", "07.03"]
branch: "feat/task-07-contract-reset"
assignee: pm
enriched: true
rmcp_id: "RMCP-01"
---

# Epic 07: Reset V1 Contracts To Canonical Defaults

## Vision
Turn the canonical Researcher MCP rules into the active execution contract for the sprint. This epic removes the gap between the newer planning memory and the legacy assumptions still implied by the old backlog.

## Requirements
- Lock full-content-by-default behavior as the user-facing expectation for reading and gathering.
- Lock the response metadata and provider provenance required by the canonical SRS.
- Lock the mandatory safety, resource-bound, and redacted-logging baseline across all outbound work.

## Non-Functional Requirements
- Contract changes must be explicit enough for later schema freeze and contract testing.
- The reset must not silently preserve obsolete defaults.

## Success Metrics
- Wave 3 provider work can proceed without reopening default behavior or safety expectations.
- Every downstream tool contract task inherits one shared v1 baseline.

## Out of Scope
- Provider-specific delivery work.
- Packaging and release readiness.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Epic-level guidance; subtasks contain implementation details -->

## Architecture Notes

**Epic Type: Foundation** — This epic establishes the v1 contract baseline that all provider work depends on.

**Parallel Subtasks:** 07.01, 07.02, 07.03 can execute in parallel after 06.01 completes.

**Pattern:** Three independent contract domains (content policy, metadata, safety) that converge on a shared baseline.

## Affected Areas

- `src/domain/types.ts` — primary contract definitions
- `src/lib/` — safety infrastructure (ssrf, http, logger)
- `src/providers/` — adapter contracts
- `src/tools/` — tool-level response shaping

## Quality Gates

- All three subtasks complete before Wave 3 begins
- No subtask reopens decisions made in sibling subtasks

## Gotchas

- 07.01 (content policy) and 07.03 (safety) both affect response shapes — coordinate field naming
- These contracts will be frozen in Wave 4; changes after freeze require explicit version bump

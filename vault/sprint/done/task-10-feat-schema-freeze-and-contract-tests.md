---
id: "10"
title: "Freeze v1 schemas and contract coverage"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 4
depends_on: ["08.01", "09.01"]
blocks: ["10.01", "10.02"]
branch: "feat/task-10-schema-freeze"
assignee: pm
enriched: true
rmcp_id: "RMCP-04"
---

# Epic 10: Freeze V1 Schemas And Contract Coverage

## Vision
Turn the canonical v1 response rules into an enforceable release contract. This epic prevents the provider lanes from drifting after the contract reset and gives packaging work a stable surface to ship.

## Requirements
- Freeze the response schemas and fixtures for the v1 tool set.
- Enforce contract coverage for the tool behaviors the canonical SRS calls out explicitly.
- Verify gather and health behavior using the shared v1 contract.

## Non-Functional Requirements
- Contract enforcement must be repeatable and deterministic.
- Coverage must focus on release-critical behavior, not only happy-path examples.

## Success Metrics
- Later tasks can treat the v1 schemas as locked.
- Contract tests catch regressions in gather, read, search, and health behavior.

## Out of Scope
- Optional cache delivery.
- Release packaging itself.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Epic-level guidance; subtasks contain implementation details -->

## Architecture Notes

**Epic Type: Contract Lock** — Freezes v1 schemas and enforces via contract tests.

**Critical Path:** 10.01 (schema freeze) gates cache work (11.x) and packaging (12.x).

**Pattern:** Freeze types/fixtures → Enforce via contract tests → Gate downstream work.

## Affected Areas

- `src/domain/types.ts` — frozen v1 type definitions
- `tests/fixtures/` — frozen response fixtures
- `src/tools/*.test.ts` — contract tests for gather, health

## Quality Gates

- 10.01 (freeze) completes before 10.02 (tests) can finalize
- No schema changes after freeze without explicit version bump decision
- 10.02 contract tests must pass before release

## Gotchas

- **BLOCKING:** Cache (11.x) and packaging (12.x) cannot proceed until 10.01 freeze is complete
- Fixtures must represent full-content default, not legacy excerpt behavior
- This epic is the quality gate for v1 release readiness

---
id: "10.02"
title: "Enforce contract coverage for gather and health"
type: test
priority: high
complexity: M
difficulty: moderate
sprint: 4
depends_on: ["08.02", "09.02", "10.01"]
blocks: ["12.02"]
parent: "10"
branch: "feat/task-10-schema-freeze"
assignee: qa
enriched: true
rmcp_id: "RMCP-04-B"
---

# Task 10.02: Enforce Contract Coverage For Gather And Health

## Business Requirements

### Problem
The canonical plan specifically calls for gather dedup reporting, AI-ingestible payloads, and health readiness to be enforced after schemas are frozen. These are release-critical behaviors that cannot rely on ad hoc spot checks.

### User Story
As the release team, I want contract coverage for gather and health so that the shipped v1 server proves the behavior promised in the canonical SRS.

### Acceptance Criteria
- [ ] Contract coverage verifies that `gather` returns request-level dedup stats in the frozen v1 shape.
- [ ] Contract coverage verifies that `gather` returns both structured output and an AI-ingestible text payload.
- [ ] Contract coverage verifies that `health` reports overall server readiness plus provider-specific readiness for the v1 providers.
- [ ] Contract coverage exercises representative failure paths for gather and health using the frozen schema expectations.
- [ ] Contract coverage does not preserve legacy assumptions such as excerpt-first defaults or hidden truncation.

### Business Rules
- Gather validation must treat request-scoped dedup as enabled by default.
- Health validation must cover both provider lanes and overall server readiness.
- Contract coverage is judged against the frozen Wave 4 schema, not pre-freeze behavior.

### Out of Scope
- Load or soak testing.
- Optional cache behavior.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Data shape verification** — Contract tests enforce that runtime behavior matches frozen schemas.

**Pattern: Schema-conformance tests** — Tests use frozen fixtures and runtime type guards to verify response shapes for gather and health.

**Rationale:** Gather and health are the highest-value integration points. Gather combines search+read+dedup; health reports system state. Both must match contract.

**Constraints this creates:**
- Tests must pass against frozen fixtures
- Tests must pass against live provider responses (integration tests)
- Coverage is measured against frozen schema, not implementation details

## Affected Areas

- `src/tools/gather.test.ts` — contract tests for:
  - Gather returns `dedup_stats` in frozen shape
  - Gather returns both `structured` and `ai_ingestible` payloads
  - Gather inherits content policy (full content default)
  - Gather aggregates truncation status correctly
- `src/tools/health.test.ts` — contract tests for:
  - Health returns overall `status` and per-provider status
  - Health includes latency measurements
  - Health distinguishes ready/degraded/unavailable
- `src/domain/types.ts` — type guards for runtime validation in tests

## Quality Gates

- `gather` test verifies `dedup_stats.urls_deduped` and `urls_total` fields exist and are numbers
- `gather` test verifies `payload.structured` and `payload.ai_ingestible` both exist
- `gather` test verifies content_mode reflects full-content default
- `health` test verifies `providers.search` and `providers.reader` status fields
- `health` test verifies overall `status` is derived from provider states
- All contract tests pass with frozen fixtures
- Contract tests do NOT assume excerpt-first behavior (verify full content in test assertions)

## Gotchas

- This is a QA-owned task (assignee: qa) — do not implement, only write tests
- Tests should fail if schema changes after freeze (detect drift)
- Integration tests require live provider access; mark as separate from unit contract tests

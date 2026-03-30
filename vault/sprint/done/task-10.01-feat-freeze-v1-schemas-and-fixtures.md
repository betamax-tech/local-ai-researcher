---
id: "10.01"
title: "Freeze v1 schemas and fixtures"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 4
depends_on: ["08.01", "09.01"]
blocks: ["10.02", "11.01", "12.01"]
parent: "10"
branch: "feat/task-10-schema-freeze"
assignee: dev
enriched: true
rmcp_id: "RMCP-04-A"
---

# Task 10.01: Freeze V1 Schemas And Fixtures

## Business Requirements

### Problem
The canonical v1 release needs stable schemas before tests, cache work, and packaging can finish. Without a freeze point, later work will keep renegotiating field names, defaults, and required metadata.

### User Story
As the release team, I want one frozen v1 response contract so that validation, packaging, and operator guidance all describe the same product behavior.

### Acceptance Criteria
- [ ] The v1 schema for `search`, `read`, `gather`, and `health` is frozen after the Wave 2 and Wave 3 contract work lands.
- [ ] Frozen fixtures cover the canonical metadata, provider provenance, and content-policy expectations required by the SRS.
- [ ] The frozen contract explicitly represents full-content default behavior for reading and gather-produced reads.
- [ ] The frozen contract is stable enough for downstream cache and packaging work to depend on it without reopening baseline fields.

### Business Rules
- Schema freeze happens only after both search and reader delivery tasks align to the canonical defaults.
- Frozen fixtures must represent both success and failure shapes that operators and tests rely on.

### Out of Scope
- Executing the full contract test suite.
- Release documentation.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Data shape** — Schema freeze locks the v1 response contract so downstream work (cache, packaging, docs) has a stable target.

**Pattern: Interface-lock with fixtures** — Types are finalized, and representative fixtures are committed for both success and failure shapes.

**Rationale:** Without a freeze point, cache and packaging work will chase a moving target. Fixtures enable contract testing without live providers.

**Constraints this creates:**
- No field name or type changes after freeze without explicit version bump
- Fixtures represent canonical v1 behavior including full-content default
- All downstream work depends on this freeze

## Affected Areas

- `src/domain/types.ts` — lock all v1 types: `SearchResult`, `ReadResult`, `GatherResult`, `HealthResult`, `ResponseMeta`, error envelopes
- `tests/fixtures/` (or equivalent) — create JSON fixtures for:
  - Search success (with results)
  - Search failure (provider unavailable)
  - Read success (full content, no truncation)
  - Read success (with truncation)
  - Read failure (SSRF blocked)
  - Gather success (with dedup stats)
  - Gather failure (partial results)
  - Health success (both providers ready)
  - Health degraded (one provider down)
- `src/tools/*.ts` — verify tool outputs match frozen types exactly

## Quality Gates

- All v1 types in `src/domain/types.ts` have JSDoc documenting freeze status
- TypeScript compilation succeeds with strict mode; no `any` escapes in response handling
- Each fixture has corresponding type guard that validates at runtime
- Fixtures include all required `meta` fields per SRS contract
- Fixtures represent full-content default (read fixtures show `content_mode: "full"`)
- No fixture contains legacy excerpt-first or hidden-truncation patterns

## Gotchas

- **Blocking task:** Cache (11.x) and packaging (12.x) cannot proceed until this freeze is complete
- Fixture URLs should use stable, long-lived test targets or synthetic data
- Error fixtures must preserve `meta` for traceability — verify this explicitly

## Changes

- Files modified:
  - `src/tools/search.ts` — replaced `fullText:boolean` with `content_mode:'full'|'excerpt'` (default: 'full'), updated tool description
  - `src/domain/types.ts` — added runtime type guards: `isToolResponseEnvelope`, `isSearchResult`, `isReadResult`, `isResponseMeta`
  - `src/tools/search.test.ts` — updated default values test to use `content_mode` instead of legacy `fullText`
- Tests run: `npx vitest run` → 413 tests passed, 0 failures
- Result: All 8 previously failing tests now pass
- Deviations from Technical Guidance: none

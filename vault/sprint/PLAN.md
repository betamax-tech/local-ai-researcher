# Researcher MCP Sprint Plan

## Overview

This sprint plan replaces the legacy execution story with the canonical Researcher MCP v1 direction from `vault/ai/docs/`. The backlog now treats the current codebase as a partial baseline that must be validated and realigned around OpenCode-first stdio delivery, self-hosted SearXNG plus self-hosted `jina-ai/reader`, full-content-by-default reads, request-scoped dedup, optional SQLite cache, and the mandatory security/privacy baseline.

## Wave 1 - Baseline Validation

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 06.01 | Validate canonical v1 baseline | feat | M | - | - |

## Wave 2 - Contract Reset

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 07.01 | Reset content policy defaults | feat | M | 06.01 | 07.02, 07.03 |
| 07.02 | Freeze response metadata contract | feat | M | 06.01 | 07.01, 07.03 |
| 07.03 | Lock safety and privacy baseline | feat | M | 06.01 | 07.01, 07.02 |

## Wave 3 - Provider Delivery

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 08.01 | Normalize SearXNG search responses | feat | M | 07.01, 07.02, 07.03 | 09.01 |
| 08.02 | Verify search readiness and failure states | feat | S | 08.01 | 09.02 |
| 09.01 | Realign reader outputs to full-content default | feat | M | 07.01, 07.02, 07.03 | 08.01 |
| 09.02 | Verify reader readiness and provenance | feat | S | 09.01 | 08.02 |

## Wave 4 - Schema Freeze

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 10.01 | Freeze v1 schemas and fixtures | feat | M | 08.01, 09.01 | - |
| 10.02 | Enforce contract coverage for gather and health | test | M | 08.02, 09.02, 10.01 | - |

## Wave 5 - Optional Cache And Packaging Prep

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 11.01 | Add opt-in SQLite cache baseline | feat | M | 10.01 | 12.01 |
| 11.02 | Add cache bypass and observability rules | feat | S | 11.01 | 12.01 |
| 12.01 | Package for `npx` and `pnpm dlx` launch | chore | M | 10.01 | 11.01, 11.02 |
| 12.03 | Add SearXNG bootstrap launch flow | feat | M | 12.01 | 11.01, 11.02 |

## Wave 6 - Release Readiness

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 12.02 | Publish operator-ready release guidance | docs | M | 10.02, 12.01 | - |

## Dependency Graph

```text
06.01 -> 07.01 -> 08.01 -> 08.02 -> 10.02 -> 12.02
      -> 07.02 -> 09.01 -> 09.02 -> 10.02
      -> 07.03 -> 08.01
                  -> 09.01

08.01 + 09.01 -> 10.01 -> 11.01 -> 11.02
                         -> 12.01 -> 12.03 -> 12.02
10.01 -> 10.02
```

## Critical Path

`06.01 -> contract reset (07.01/07.02/07.03) -> 09.01 -> 10.01 -> 10.02 -> 12.02`

This is the minimum serial chain because the reader lane carries the largest behavior change from the current excerpt-first baseline into the canonical full-content-default release posture.

## Parallelism Notes

- Wave 2 is intentionally split into three independent contract tasks so content defaults, response metadata, and safety/privacy rules can advance together after baseline validation.
- Wave 3 keeps the SearXNG and reader lanes parallel once the shared contract reset is done.
- Wave 5 keeps optional cache work off the release critical path; packaging can begin as soon as schemas are frozen.

## Scope Resets From Legacy Plan

- Remove the legacy assumption that Waves 1-3 are complete enough to skip replanning; the canonical docs now define the source of truth.
- Remove excerpt-first behavior as an approved default; full content is now the locked default unless truncation or excerpting is explicitly requested.
- Remove backlog scope that implied local/custom source expansion, alternate transports, or other non-v1 directions.
- Treat optional SQLite cache as explicit follow-on scope instead of implicit global caching.

## Done Definition For This Plan

- Every backlog task below maps to the canonical RMCP wave structure and keeps traceability through `rmcp_id`.
- Dependencies are explicit enough for later tech-lead enrichment and orchestrator dispatch.
- No product code, docs under `docs/`, or files under `vault/ai/docs/` are changed by this planning refresh.

## Integration [Wave 2] — 2026-03-27
Commands: tsc | vitest run | (lint: placeholder skipped)
Build:  PASS
Tests:  PASS — 228/228
Lint:   SKIPPED — not configured
Status: CLEAN
Gate:   PASS

## Integration [Wave 3] — 2026-03-29
Commands: pnpm typecheck | pnpm test | (lint: placeholder skipped)
Build:  PASS
Tests:  PASS — 289/289
Lint:   SKIPPED — not configured
Status: CLEAN
Gate:   PASS

## Integration [Wave 3] — 2026-03-31
Commands: npm run build | npm test | npm run lint
Build:  PASS
Tests:  PASS — 310/310
Lint:   PASS — placeholder script
Status: CLEAN
Gate:   PASS

## Integration [Wave 4] — 2026-03-31
Commands: npm run build | npm test | npm run lint
Build:  PASS
Tests:  PASS — 463/463
Lint:   PASS — placeholder script
Status: CLEAN
Gate:   PASS

## Wave 4.5 - Provider Interface Refactor

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 13.01 | Define provider interfaces and align concrete providers | refactor | M | - | - |
| 13.02 | Retype tool factories to provider contracts | refactor | M | 13.01 | - |

### Dependency Addendum

```text
13.01 -> 13.02
```

### Critical Path Addendum

`13.01 -> 13.02`

### Parallelism Notes

- No safe parallel split is planned inside Wave 4.5 because the tool-layer typing depends on the shared provider contract being established first.
- Wave 4.5 is intentionally behavior-neutral and should preserve the same passing build and test gates recorded for Wave 4.

## Integration [Wave 4.5] — 2026-03-31
Commands: npm run build | npm test | npm run lint
Build:  PASS
Tests:  PASS — 498/498
Lint:   PASS — placeholder script
Status: CLEAN
Gate:   PASS

## Integration [Wave 5] — 2026-03-31
Commands: npm run build | npm test | npm run lint
Build:  PASS
Tests:  PASS — 589/589
Lint:   PASS — placeholder script
Status: CLEAN
Gate:   PASS

## Release v0.1.0 — 2026-03-31
Tag:     v0.1.0 (annotated)
Branch:  main (merged from feat/task-11-optional-sqlite-cache)
Tests:   589/589 passing
Build:   PASS
Commits: f3bf640 (merge) ← 75c81a0..
Status:  RELEASED

## Wave 6 - Baseline Quality Wins

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 14.01 | Tune SearXNG relevance defaults | feat | S | - | 14.02 |
| 14.02 | Detect degraded read results | feat | M | - | 14.01 |

## Wave 7 - Reader Extraction Resilience

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 14.03 | Tune Jina Reader for JS-heavy pages | feat | M | 14.02 | - |

## Wave 8 - Gather Synthesis Upgrade

| ID | Title | Type | Cx | Depends | Parallel With |
|----|-------|------|----|---------|---------------|
| 14.04 | Improve gather synthesis quality | feat | M | 14.01, 14.02, 14.03 | - |

## Dependency Addendum - Quality Improvements

```text
14.01 -> 14.04
14.02 -> 14.03 -> 14.04
14.02 ---------> 14.04
```

## Critical Path Addendum - Quality Improvements

`14.02 -> 14.03 -> 14.04`

This is the minimum serial chain because degraded-read semantics must be defined before JS-heavy tuning can be evaluated cleanly, and the gather synthesis upgrade depends on the final read-quality signals.

## Parallelism Notes - Quality Improvements

- Wave 6 starts with the highest-signal, lowest-effort wins: search relevance tuning and degraded-read detection can begin immediately in parallel.
- Wave 7 stays isolated after 14.02 because reader tuning and degraded-read semantics are likely to touch the same read-path behavior and should not race.
- Wave 8 is intentionally sequenced after the search and read improvements so synthesis can rely on improved ranking inputs and explicit degraded-read visibility.

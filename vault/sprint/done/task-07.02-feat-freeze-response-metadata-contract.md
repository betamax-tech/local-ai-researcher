---
id: "07.02"
title: "Freeze response metadata contract"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 2
depends_on: ["06.01"]
blocks: ["08.01", "09.01"]
parent: "07"
branch: "feat/task-07-contract-reset"
assignee: dev
enriched: true
rmcp_id: "RMCP-01-B"
---

# Task 07.02: Freeze Response Metadata Contract

## Business Requirements

### Problem
The canonical SRS requires a richer response contract than the legacy sprint plan described. Without a locked metadata contract, providers and tests can drift and later waves cannot verify whether responses are complete.

### User Story
As an AI workflow operator, I want every tool response to include consistent request metadata and provider provenance so that I can trust and trace the returned research context.

### Acceptance Criteria
- [ ] Every v1 tool response includes a `meta` object with a request identifier, timestamps, provider identifiers, and the applied limits for the request.
- [ ] `read` responses expose the active `content_mode` and any truncation status in a consistent shape.
- [ ] `gather` responses expose request-level dedup statistics and both structured and AI-ingestible payloads.
- [ ] Failure responses preserve the same traceability fields needed to understand which provider or request produced the failure.
- [ ] The shared response contract is stable enough to be frozen in Wave 4 without reopening field names or required values.

### Business Rules
- Request metadata must be present on success and failure paths.
- Provider provenance must identify the actual v1 provider used for each tool result.
- Applied limits must describe the request the user actually received, not only system defaults.

### Out of Scope
- Provider-specific ranking logic.
- Release packaging.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Data shape** — Response metadata provides traceability and observability for all tool outputs.

**Pattern: Envelope-with-provenance** — Every response wraps domain content in a `meta` object containing request_id, timestamps, provider identifiers, and applied limits.

**Rationale:** Consistent metadata enables debugging, auditing, and future caching without per-tool divergence.

**Constraints this creates:**
- `meta` object is required on success and failure paths
- Field names and types are frozen after this task
- Provider adapters must populate provenance; tools must not strip it

## Affected Areas

- `src/domain/types.ts` — define frozen `ResponseMeta` type with: `request_id`, `timestamp`, `provider_id`, `provider_name`, `applied_limits`
- `src/tools/search.ts` — ensure search responses include meta with SearXNG provenance
- `src/tools/read.ts` — ensure read responses include meta with reader provenance plus `content_mode`/`content_truncated`
- `src/tools/gather.ts` — ensure gather responses include meta plus dedup stats and AI-ingestible payload indicator
- `src/tools/health.ts` — ensure health responses include meta plus provider readiness
- `src/lib/errors.ts` — ensure error envelopes preserve meta fields for traceability

## Quality Gates

- Every tool response (success and failure) includes `meta` object with all required fields
- `meta.request_id` is unique per request (UUID or equivalent)
- `meta.provider_id` identifies actual provider used (not generic)
- Failure responses preserve `meta` for debugging
- TypeScript types compile without `any` escapes in meta handling

## Gotchas

- `gather` calls multiple providers; meta must reflect orchestration, not just last provider
- Error paths often skip metadata in naive implementations — verify failure envelope includes meta
- `applied_limits` must reflect actual limits used, not just defaults

---
<!-- COMPLETION — appended by Orchestrator after verification -->

## Changes
- `src/domain/types.ts` — added `ResponseMeta` interface with request_id, timestamp, provider_id, provider_name, applied_limits
- `src/tools/search.ts` — meta populated with SearXNG provenance on success and failure
- `src/tools/read.ts` — meta populated with reader provenance + content_mode/content_truncated
- `src/tools/gather.ts` — meta populated with orchestration provenance + dedup stats
- `src/tools/health.ts` — meta populated with provider readiness
- `src/lib/errors.ts` — error envelopes preserve meta fields for traceability
- `src/tools/search.test.ts` — new: meta contract BDD tests
- `src/tools/health.test.ts` — new: meta contract BDD tests

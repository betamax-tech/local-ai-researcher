---
id: "09.02"
title: "Verify reader readiness and provenance"
type: feat
priority: medium
complexity: S
difficulty: moderate
sprint: 3
depends_on: ["09.01"]
blocks: ["10.02"]
parent: "09"
branch: "feat/task-09-reader-provider-v1"
assignee: dev
enriched: true
rmcp_id: "RMCP-03-B"
---

# Task 09.02: Verify Reader Readiness And Provenance

## Business Requirements

### Problem
Operators need confidence that the reader lane is actually usable and that each response can be traced back to the approved provider. Canonical readiness reporting must reflect the health of the reader path, not just generic server startup.

### User Story
As an operator, I want reader readiness and provenance to be explicit so that I can trust the extracted content returned to OpenCode.

### Acceptance Criteria
- [ ] Readiness reporting states whether the reader lane is ready against the configured self-hosted reader provider.
- [ ] Reader failures distinguish provider unavailability, safety-triggered refusal, and invalid request situations.
- [ ] Successful reader responses preserve provider provenance and request metadata needed for downstream audits.
- [ ] Reader readiness behavior can be validated independently from search readiness.

### Business Rules
- Provider provenance must identify the approved reader provider on success paths.
- Readiness must reflect real provider availability, not only local process status.

### Out of Scope
- Search readiness.
- Release packaging.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Integration** — Reader readiness must validate actual provider connectivity and response quality, not just configuration.

**Pattern: Health-check-with-sample-read** — Reader lane health performs a lightweight read to verify extraction works end-to-end.

**Rationale:** Reader failures are more impactful than search (lost content vs. lost results list). End-to-end verification catches config and content extraction issues.

**Constraints this creates:**
- Health check performs actual read against a known-good URL
- Provenance is verified in responses (provider_id matches expected)
- Failure categories are distinct: unavailable, safety-blocked, extraction-failed

## Affected Areas

- `src/tools/health.ts` — add reader-lane readiness check with sample read
- `src/providers/jinaReader.ts` — expose `checkHealth()` method; optionally perform test extraction
- `src/domain/types.ts` — extend `ProviderHealth` for reader-specific status
- `src/lib/errors.ts` — define reader-specific error codes: `reader_unavailable`, `ssrf_blocked`, `extraction_failed`

## Quality Gates

- `health` response includes `reader` lane status: `ready | degraded | unavailable`
- Reader health check performs test read (or ping) to configured jina-ai/reader instance
- Response includes latency measurement for reader lane
- Reader unreachable → status `unavailable` with error details
- SSRF-blocked URL request returns distinct error from provider-unavailable
- Reader responses preserve `meta.provider_id` and `meta.provider_name` for provenance
- Reader readiness independent from search readiness

## Gotchas

- jina-ai/reader may not have dedicated health endpoint; use a known-simple URL for test read
- Test read URL must not be SSRF-blocked (use public HTTP URL)
- Health check read should be lightweight (small page) to minimize latency impact

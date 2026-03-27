---
id: "08.01"
title: "Normalize SearXNG search responses"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 3
depends_on: ["07.01", "07.02", "07.03"]
blocks: ["08.02", "10.01"]
parent: "08"
branch: "feat/task-08-searxng-provider-v1"
assignee: dev
enriched: true
rmcp_id: "RMCP-02-A"
---

# Task 08.01: Normalize SearXNG Search Responses

## Business Requirements

### Problem
The search provider already exists, but the old planning direction does not guarantee alignment with the canonical v1 contract. Search output must now be treated as a product contract, not just a provider passthrough.

### User Story
As an OpenCode user, I want search results from my self-hosted SearXNG instance to arrive in a stable normalized shape so that downstream prompts can consume them without provider-specific cleanup.

### Acceptance Criteria
- [ ] A successful `search` call returns ranked normalized results from the configured self-hosted SearXNG provider.
- [ ] Search responses include the shared v1 metadata contract and identify SearXNG as the serving provider.
- [ ] Search results preserve enough provenance to trace each result back to its source URL and provider response.
- [ ] Search failures map into the locked v1 failure semantics without leaking provider secrets or raw internals.
- [ ] Search behavior does not imply support for non-v1 providers or non-web source types.

### Business Rules
- SearXNG is the only approved v1 search provider.
- Search output must be normalized for AI ingestion before release.
- Search responses inherit the shared safety/resource baseline from Wave 2.

### Out of Scope
- Reader behavior changes.
- Alternate search engines.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Integration** — Search provider adapter translates SearXNG API responses into domain-normalized `SearchResult` objects.

**Pattern: Adapter-with-normalization** — Provider module owns all SearXNG-specific translation; tool layer sees only domain types.

**Rationale:** Isolating provider details enables future provider swaps without tool-layer changes. Normalized output is AI-ingestible by design.

**Constraints this creates:**
- `src/providers/searxng.ts` is the only module that knows SearXNG response shape
- Tool output must not include raw SearXNG fields
- Normalized results must include: title, url, snippet, source_engine (provenance)

## Affected Areas

- `src/providers/searxng.ts` — normalize SearXNG JSON response to domain `SearchResult[]`
- `src/domain/types.ts` — verify `SearchResult` type includes required provenance fields
- `src/tools/search.ts` — wrap provider output in frozen response envelope with meta
- `src/lib/url.ts` — ensure URL canonicalization for stable dedup keys

## Quality Gates

- Search response includes `results` array with normalized `SearchResult` objects
- Each result has: `title`, `url` (normalized), `snippet`, `source_engine`
- Response `meta.provider_id` identifies SearXNG instance
- SearXNG-specific fields (e.g., `engines`, `categories`) are not leaked to tool output
- Empty result set returns `results: []` with success status, not error
- Search errors map to domain error types (provider_unavailable, rate_limited, invalid_query)

## Gotchas

- SearXNG instances may have different result formats depending on version — test against target version
- Some results may have empty snippets; handle gracefully without null errors
- URL normalization must handle protocol variants (http vs https) and trailing slashes

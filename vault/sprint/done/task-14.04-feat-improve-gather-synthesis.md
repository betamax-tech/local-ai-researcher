---
id: "14.04"
title: "Improve gather synthesis quality"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 8
depends_on: ["14.01", "14.02", "14.03"]
blocks: []
branch: "feat/task-14-research-quality-improvements"
assignee: dev
enriched: true
affected_areas:
  - src/tools/gather.ts
  - src/lib/synthesis.ts
  - src/tools/gather.test.ts
---

# Task 14.04: Improve Gather Synthesis Quality

## Business Requirements

### Problem
`gather` currently provides less value than it could because concatenated source text forces users to sift through duplication, weak passages, and degraded reads manually. This is the highest-value quality improvement because `gather` is the combined research path most likely to shape the default user experience.

### User Story
As a researcher, I want `gather` to return a cleaner synthesized research packet so that I can act on the most relevant content faster without relying on extra post-processing.

### Affected Areas
- The default gathered research packet returned to downstream agents and users.
- How duplicate or overlapping source passages are represented in the primary synthesis.
- How degraded reads are surfaced separately from the primary synthesized body.
- How the default gather output prioritizes higher-signal results when multiple sources compete for inclusion.

### Acceptance Criteria
- [ ] A successful `gather` response returns a primary synthesized body that is materially different from a source-order concatenation of all successful reads.
- [ ] When at least two gathered sources contain duplicate or near-duplicate passages, the primary synthesized body includes only one representative treatment of that repeated content.
- [ ] When both higher-ranked non-degraded reads and lower-ranked or degraded reads are present, the default synthesized body prefers the higher-ranked non-degraded material.
- [ ] Reads marked degraded remain visible in the `gather` response context and summary counts but are excluded from the default primary synthesized body.
- [ ] When `gather` has no non-degraded reads, the response still completes successfully, keeps degraded-read visibility explicit, and does not present degraded content as if it were normal synthesis output.

### Business Rules
- Synthesis improvements must use lightweight local methods and must not introduce an LLM or cloud summarization dependency.
- Gather output should favor relevance, deduplication, and readability over source-order concatenation.
- Degraded-read visibility from Task 14.02 is part of the required gather behavior.
- Recent ecosystem-only updates to research routing guidance and the `zai-web-reader` MCP label are already handled outside product backlog scope and must not be reopened by this task unless gather behavior itself is affected.

### Out of Scope
- Replacing the search or read providers.
- Adding paid summarization services.
- Revisiting ecosystem configuration naming or non-product routing conventions.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Technical Guidance

### Architecture Notes

**Axis**: Data transformation — synthesis quality via local text processing heuristics.

**Pattern**: Extend `buildSynthesis()` with three processing stages: (1) degraded-read exclusion, (2) relevance-based ordering, (3) content deduplication via n-gram similarity. Chosen over: (a) LLM-based summarization — violates business rule; (b) TextRank/graph algorithms — overkill for dedup task; (c) external libraries — adds dependency weight. Accept tradeoff: simple heuristics may miss some duplicates; acceptable for "materially different" bar.

**Current State** (`buildSynthesis`, lines 364-396 in `gather.ts`):
- Concatenates all search results and reads in source order
- Attaches read content to matching search result by URL
- No deduplication, no relevance scoring, no degraded filtering
- Degraded reads already flagged via `ReadResult.degraded: true` (from task 14.02)

**Required Changes**:
1. Filter degraded reads from primary synthesis body (keep in `context.reads`)
2. Sort non-degraded reads by relevance (use `SearchResult.relevance` if present, else query term overlap)
3. Deduplicate content passages using shingle/n-gram Jaccard similarity
4. Format output with clear separation: primary synthesis → degraded section (if any)

### Affected Files

- `src/tools/gather.ts` — Modify `buildSynthesis()` function; add relevance/dedup logic
- `src/lib/synthesis.ts` — **New file**: helper functions for similarity scoring and deduplication
- `src/tools/gather.test.ts` — Add tests for synthesis quality behaviors

### Implementation Approach

**Stage 1: Degraded-read handling**

Separate reads into `normalReads` and `degradedReads` before synthesis:

```typescript
const normalReads = reads.filter(r => r.degraded !== true);
const degradedReads = reads.filter(r => r.degraded === true);
```

If `normalReads.length === 0`, synthesis body is empty but includes explicit degraded-visibility section.

**Stage 2: Relevance ordering**

Score each read by relevance to query:
1. If corresponding `SearchResult.relevance` exists, use it
2. Otherwise, compute simple query term overlap score

```typescript
function scoreRelevance(query: string, content: string): number {
  const queryTerms = new Set(query.toLowerCase().split(/\s+/));
  const contentTerms = new Set(content.toLowerCase().split(/\s+/));
  let overlap = 0;
  for (const term of queryTerms) {
    if (contentTerms.has(term)) overlap++;
  }
  return overlap / queryTerms.size; // 0-1 normalized
}
```

Sort normal reads by combined relevance (provider score or computed), descending.

**Stage 3: Content deduplication**

Use 3-word shingles (trigrams) with Jaccard similarity to detect near-duplicate passages:

```typescript
function shingleSimilarity(a: string, b: string): number {
  const shinglesA = getShingles(a, 3);
  const shinglesB = getShingles(b, 3);
  const intersection = new Set([...shinglesA].filter(x => shinglesB.has(x)));
  const union = new Set([...shinglesA, ...shinglesB]);
  return intersection.size / union.size; // Jaccard coefficient
}
```

Dedup strategy: when two reads exceed similarity threshold (suggest 0.6), keep the higher-relevance one and note the duplicate in a brief marginal note.

**Output format** (new synthesis structure):

```
## Research Results for: {query}

Found {n} result(s). {dedupNote}

{synthesis_body}

{degraded_section_if_any}
```

Where:
- `dedupNote`: "Deduplicated X similar passages." or ""
- `synthesis_body`: Ordered, deduplicated content from non-degraded reads
- `degraded_section_if_any`: 
  ```
  ---
  ## Degraded Sources (excluded from synthesis)
  {count} source(s) returned insufficient content for reliable use.
  ```

### Invariants

- `GatherResult.synthesis` remains a string (type contract unchanged)
- `context.reads` includes ALL reads (degraded and normal) — filtering is synthesis-only
- `summary.degradedReads` count is already populated (task 14.02) — use it for consistency
- No external NLP/ML dependencies

### Test Approach (BDD ACs → Test Cases)

**AC1**: Synthesis materially different from source-order concatenation
- Test: Mock 3 reads with different content → verify synthesis is not just `[1][2][3]` order
- Test: Mock 3 reads with identical content → verify synthesis shows only one

**AC2**: Duplicate passages deduplicated
- Test: Two reads with >80% content overlap → synthesis includes only one
- Test: Include marginal note indicating deduplication occurred

**AC3**: Higher-ranked non-degraded reads preferred
- Test: Two reads, one with higher relevance score → higher-relevance content appears first
- Test: Degraded read + normal read → normal read in synthesis, degraded in separate section

**AC4**: Degraded reads visible but excluded from primary body
- Test: One degraded, one normal → synthesis body has normal; degraded section exists
- Test: Verify degraded content is NOT in synthesis body string

**AC5**: All-degraded case handled gracefully
- Test: All reads degraded → synthesis body empty, degraded section explicit, response ok:true

**Test cases to add** (`src/tools/gather.test.ts`):

```typescript
describe('synthesis quality (task 14.04)', () => {
  describe('degraded-read handling', () => {
    it('excludes degraded reads from primary synthesis body', async () => {
      // Mock: one degraded, one normal
      // Assert: synthesis does not contain degraded content
      // Assert: synthesis contains normal content
    });

    it('includes degraded visibility section when degraded reads exist', async () => {
      // Mock: one degraded read
      // Assert: synthesis contains "Degraded Sources" section
    });

    it('handles all-degraded case with empty body and explicit degraded section', async () => {
      // Mock: all reads degraded
      // Assert: synthesis body is minimal/empty
      // Assert: degraded section is present with count
      // Assert: response is ok:true (not error)
    });
  });

  describe('relevance ordering', () => {
    it('orders non-degraded reads by relevance score descending', async () => {
      // Mock: two normal reads, different relevance
      // Assert: higher-relevance content appears before lower-relevance
    });

    it('uses query term overlap when provider relevance unavailable', async () => {
      // Mock: SearchResult without relevance field
      // Assert: still orders by computed term overlap
    });
  });

  describe('content deduplication', () => {
    it('deduplicates near-identical passages keeping higher-relevance version', async () => {
      // Mock: two reads with >60% content overlap, different relevance
      // Assert: only higher-relevance content in synthesis
    });

    it('includes deduplication note when duplicates removed', async () => {
      // Mock: two near-identical reads
      // Assert: synthesis contains "Deduplicated" note
    });

    it('keeps distinct passages from different sources', async () => {
      // Mock: two reads with <30% overlap
      // Assert: both appear in synthesis
    });
  });
});
```

### Quality Gates

- [ ] All new synthesis quality tests pass (minimum 8 test cases)
- [ ] Existing `gather.test.ts` tests remain passing (no contract regression)
- [ ] Manual smoke: `gather('react hooks tutorial')` returns cleaner synthesis than before
- [ ] No new runtime dependencies added to `package.json`

### Gotchas

1. **Similarity threshold tuning**: The 0.6 Jaccard threshold is a starting point. If too aggressive (collapses distinct content) or too weak (misses obvious dupes), adjust. Make threshold a constant for easy tuning.

2. **Short content edge case**: Very short reads (<50 words) may have artificially high similarity scores. Consider minimum content length before applying dedup.

3. **Degraded visibility format**: The degraded section must be parseable (for downstream agents) but not confused with synthesis body. Use markdown `---` separator and distinct heading.

  4. **Cache invalidation**: Synthesis changes will not invalidate existing cache entries automatically. Consider versioning synthesis format (e.g., include format version in output) or accept that cached responses use old format until TTL expires.

---

## Changes

- Files modified:
  - `src/lib/synthesis.ts` — New helper module for local relevance scoring and deduplication
  - `src/tools/gather.ts` — Updated gather synthesis to prefer higher-signal non-degraded content and exclude degraded reads from the primary synthesis body
  - `src/tools/gather.test.ts` — Added synthesis-quality coverage for deduplication, degraded-read visibility, ordering, and all-degraded fallback behavior
- Verification: `npx vitest run src/tools/gather.test.ts` passed
- Full-suite verification: `npm test` passed (`615 passed`)
- Independent verification: Complete and successful
- Deviations from Technical Guidance: None — implementation follows the three-stage pipeline (degraded-read exclusion → relevance ordering → content deduplication) with lightweight local heuristics as specified

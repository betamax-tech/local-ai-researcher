---
id: "14.01"
title: "Tune SearXNG relevance defaults"
type: feat
priority: high
complexity: S
difficulty: routine
sprint: 6
depends_on: []
blocks: ["14.04"]
parent: "14"
branch: "feat/task-14-research-quality-improvements"
assignee: dev
enriched: true
---

# Task 14.01: Tune SearXNG Relevance Defaults

## Business Requirements

### Problem
English-language research queries currently return too many irrelevant or non-English results for the default baseline experience. Because local-researcher is now the default research tool, poor default ranking directly reduces trust in the product.

### User Story
As a researcher using local-researcher with an English query, I want default search behavior to prefer relevant English results so that I spend less time filtering noise before reading sources.

### Acceptance Criteria
- [ ] A `search` request with no explicit `language` value applies the approved English-biased default behavior.
- [ ] For the English relevance fixture used by QA, at least 4 of the first 5 returned results are English-language pages when the SearXNG instance offers mixed-language results.
- [ ] An explicit non-English `language` request still returns results aligned to the requested language and is not overridden by the English default.
- [ ] The approved low-quality engine changes do not break successful `search` responses or search-lane readiness.

### Business Rules
- English should be the default relevance posture when the caller does not request another language.
- Explicit caller language selection always wins over defaults.
- Quality tuning must stay within the self-hosted SearXNG baseline and must not introduce cloud search dependencies.

### Out of Scope
- Read or gather behavior changes.
- Adding or replacing search providers.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Technical Guidance

### Architecture Notes

**Axis**: API boundary configuration — SearXNG request parameter tuning for English relevance bias.

**Pattern**: Extend query param construction in `SearxngProvider.search()` with conditional engine exclusion when using English default. Chosen over: (a) caller-side config — would leak implementation detail; (b) separate "relevance profile" abstraction — overkill for routine task. Accept tradeoff: engine exclusion list is hardcoded, not configurable. Reversible by removing the `engines` param.

**Current State** (line 231-239 in `searxng.ts`):
- Already passes `language: options.language ?? 'en'` — English default exists.
- No `engines` param currently — SearXNG uses all enabled engines by default.

**SearXNG `language` vs `locale` distinction**:
- `language` — Controls result language preference (e.g., `en`, `de`, `all`). Affects ranking.
- `locale` — UI locale for SearXNG interface (not relevant here; we use JSON API).
- For English bias, use `language=en` (already present). Engine exclusion is an additional signal.

### Affected Files

- `src/providers/searxng.ts` — Add engine exclusion for English default case
- `src/providers/searxng.test.ts` — Add tests for language/engine behavior

### Implementation Approach

**Change**: In `search()` method, when `options.language` is undefined or `'en'`, add `engines` param to exclude low-quality engines:

```
engines: -bing news,-google news,-yahoo news,-ddg definitions
```

**Rationale for engine exclusion list**:
| Engine | Reason for Exclusion |
|--------|---------------------|
| `bing news` | Often returns non-English headlines for English queries |
| `google news` | Similar mixed-language issue; news sources vary by region |
| `yahoo news` | Lower-quality results, regional bias |
| `ddg definitions` | Dictionary definitions rarely useful for research queries |

**Invariants**:
- Explicit `options.language` value (including `'en'` string) → respect caller intent, do not apply exclusion.
- `options.language` undefined → apply English default with engine exclusion.
- Never modify `options` object directly; construct params independently.

**Pseudocode** (lines 231-241 area):
```typescript
const language = options.language ?? 'en';
const isEnglishDefault = options.language === undefined;

const params = new URLSearchParams({
  q: query,
  format: 'json',
  language,
});

// Apply engine exclusion only for English default (no explicit language specified)
if (isEnglishDefault) {
  params.append('engines', '-bing news,-google news,-yahoo news,-ddg definitions');
}
```

### Test Approach (BDD ACs → Test Cases)

**AC1**: No explicit language → English-biased default behavior
- Test: `search('test')` with no options → verify HTTP call includes `language=en` and `engines=-bing news,...`
- Mock: Return valid response; assert on `mockHttpClient.get` call args

**AC2**: 4 of 5 results are English for fixture
- This is an integration-level AC requiring live SearXNG — defer to manual QA or E2E.
- Unit test can verify the param is sent; cannot verify SearXNG's ranking behavior.

**AC3**: Explicit non-English language is not overridden
- Test: `search('test', { language: 'de' })` → verify HTTP call includes `language=de` and NO `engines` exclusion
- Test: `search('test', { language: 'en' })` → verify HTTP call includes `language=en` and NO `engines` exclusion (explicit `'en'` wins)

**AC4**: Engine changes don't break responses
- Test: Mock response with results from excluded engines → provider still returns normalized results (exclusion is request-side, not response filtering)
- Test: Empty results → still works
- Test: Existing error mapping tests continue to pass

**Test cases to add**:
```typescript
describe('language and engine configuration', () => {
  it('applies English default with engine exclusion when language not specified', async () => {
    // Call search with no language option
    // Assert URL contains language=en AND engines param with exclusions
  });

  it('respects explicit English language without engine exclusion', async () => {
    // Call search with { language: 'en' }
    // Assert URL contains language=en but NO engines param
  });

  it('respects explicit non-English language without engine exclusion', async () => {
    // Call search with { language: 'de' }
    // Assert URL contains language=de and NO engines param
  });

  it('excluded engines list does not affect response normalization', async () => {
    // Mock response with results from 'bing news'
    // Assert results are still normalized correctly
  });
});
```

### Quality Gates

- [ ] All 4 new test cases pass
- [ ] Existing tests in `searxng.test.ts` remain passing (no regression)
- [ ] Manual smoke test: `search('machine learning')` returns predominantly English results against live SearXNG

### Gotchas

1. **Engine names are SearXNG-specific**: The engine identifiers (`bing news`, `google news`) are SearXNG's internal names, not generic. If the SearXNG instance has different engine names configured, the exclusion will silently do nothing. Document this in code comment.

2. **Explicit `'en'` string vs undefined**: The business rule says "explicit caller language selection always wins" — this includes `language: 'en'`. Only `undefined` triggers the English-biased default with engine exclusion.

3. **No response-side filtering**: The `engines` param affects what SearXNG returns, not what the provider filters. Results from excluded engines won't appear in the response at all. Do NOT add post-hoc filtering.

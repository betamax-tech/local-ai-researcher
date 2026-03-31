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
enriched: false
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

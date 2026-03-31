---
id: "14.04"
title: "Improve gather synthesis quality"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 8
depends_on: ["14.01", "14.02", "14.03"]
blocks: []
parent: "14"
branch: "feat/task-14-research-quality-improvements"
assignee: dev
enriched: false
---

# Task 14.04: Improve Gather Synthesis Quality

## Business Requirements

### Problem
`gather` currently provides less value than it could because concatenated source text forces users to sift through duplication, weak passages, and degraded reads manually. This is the highest-value quality improvement because `gather` is the combined research path most likely to shape the default user experience.

### User Story
As a researcher, I want `gather` to return a cleaner synthesized research packet so that I can act on the most relevant content faster without relying on extra post-processing.

### Acceptance Criteria
- [ ] `gather` returns a synthesized research body that is not a raw concatenation of every successful read in original order.
- [ ] When two gathered sources contain duplicate or near-duplicate passages, the synthesized output includes only one representative passage for that repeated content.
- [ ] Higher-ranked search results and higher-quality reads are preferred over lower-ranked or degraded reads when selecting synthesis content.
- [ ] Degraded reads remain visible in the response but are excluded from the default synthesized body.

### Business Rules
- Synthesis improvements must use lightweight local methods and must not introduce an LLM or cloud summarization dependency.
- Gather output should favor relevance, deduplication, and readability over source-order concatenation.
- Degraded-read visibility from Task 14.02 is part of the required gather behavior.

### Out of Scope
- Replacing the search or read providers.
- Adding paid summarization services.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

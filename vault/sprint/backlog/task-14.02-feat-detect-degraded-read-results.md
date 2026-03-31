---
id: "14.02"
title: "Detect degraded read results"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 6
depends_on: []
blocks: ["14.03", "14.04"]
parent: "14"
branch: "feat/task-14-research-quality-improvements"
assignee: dev
enriched: false
---

# Task 14.02: Detect Degraded Read Results

## Business Requirements

### Problem
Very short or obviously degraded extracts can currently appear as successful reads, which misleads users and pollutes downstream gather output. The baseline research tool must distinguish real extraction success from near-empty or low-value content.

### User Story
As a researcher, I want degraded read outcomes to be flagged clearly so that I can trust successful reads and quickly spot sources that need retrying or manual review.

### Acceptance Criteria
- [ ] Any `read` result with fewer than 20 extracted words is surfaced as degraded and not counted as a successful full-content extraction.
- [ ] `read` responses expose a visible quality signal that distinguishes normal extraction from degraded extraction.
- [ ] `gather` responses report degraded reads separately from successful reads in their returned result semantics.
- [ ] Reads that exceed the degraded threshold and contain normal article text continue to appear as successful reads.

### Business Rules
- Two-word or similarly near-empty extracts must never be treated as successful reads.
- Degraded reads must remain visible to the caller instead of disappearing silently.
- The quality signal must be explicit enough for QA to verify in both `read` and `gather` outputs.

### Out of Scope
- Changing the core reader provider.
- Improving extraction quality for JS-heavy pages beyond degraded-result detection.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

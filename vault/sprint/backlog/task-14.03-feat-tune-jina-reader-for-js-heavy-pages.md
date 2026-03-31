---
id: "14.03"
title: "Tune Jina Reader for JS-heavy pages"
type: feat
priority: medium
complexity: M
difficulty: moderate
sprint: 7
depends_on: ["14.02"]
blocks: ["14.04"]
parent: "14"
branch: "feat/task-14-research-quality-improvements"
assignee: dev
enriched: false
---

# Task 14.03: Tune Jina Reader For JS-Heavy Pages

## Business Requirements

### Problem
JS-heavy pages are more likely to produce degraded or incomplete extracts even when the underlying content is available. Improving extraction behavior with supported reader options is a low-to-medium effort way to increase baseline research quality without changing providers.

### User Story
As a researcher, I want local-researcher to extract useful content from JS-heavy pages more reliably so that modern web pages are not disproportionately unusable in my research flow.

### Acceptance Criteria
- [ ] The approved reader request options for slower or JS-heavy pages can be applied without changing the public provider choice.
- [ ] For the JS-heavy extraction fixture used by QA, a successful `read` returns more than 100 extracted words and is not marked degraded.
- [ ] Existing non-JS-heavy `read` behavior remains backward compatible for callers that do not use the new tuning behavior.
- [ ] Extraction failures on JS-heavy pages remain visible with explicit failure or degraded semantics rather than silent success.

### Business Rules
- Jina Reader remains the only approved read provider for this work.
- Supported provider options may improve extraction, but they must not require paid services or cloud provider replacement.
- Tuning behavior must preserve explicit visibility into degraded or failed reads.

### Out of Scope
- Replacing Jina Reader.
- New gather synthesis logic beyond what depends on improved read quality.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

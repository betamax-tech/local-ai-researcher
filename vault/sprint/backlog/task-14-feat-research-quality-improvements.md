---
id: "14"
title: "Improve local researcher result quality"
type: feat
priority: high
complexity: L
difficulty: complex
sprint: 6
depends_on: []
blocks: ["14.01", "14.02", "14.03", "14.04"]
branch: "feat/task-14-research-quality-improvements"
assignee: pm
enriched: false
---

# Epic 14: Improve Local Researcher Result Quality

## Vision
Strengthen the default local-researcher experience so the baseline research tool produces more relevant search results, surfaces degraded reads honestly, extracts better from JS-heavy pages, and returns more useful gathered research context without adding cloud dependencies.

## Requirements
- Tune default SearXNG behavior toward better English-language relevance for English queries.
- Detect degraded read results and surface them explicitly instead of counting them as normal successful reads.
- Improve Jina Reader extraction behavior on JS-heavy pages using supported provider options while keeping the same provider choice.
- Improve `gather` output quality beyond raw concatenation using lightweight local synthesis methods.

## Non-Functional Requirements
- Preserve the privacy-first, zero-cost product direction.
- Do not replace SearXNG or Jina Reader with hosted cloud providers.
- Keep result semantics explicit enough for QA validation and operator troubleshooting.

## Success Metrics
- English-language search queries return more relevant English-biased defaults without breaking explicit language overrides.
- Degraded reads are visible and excluded from being mistaken for successful full extractions.
- JS-heavy page extraction succeeds more often without changing the default provider choice.
- Gathered research output is more concise, less duplicate-heavy, and more useful for downstream agent consumption.

## Out of Scope
- Replacing core providers.
- Adding paid external services.
- Expanding the tool surface beyond the approved quality improvements.

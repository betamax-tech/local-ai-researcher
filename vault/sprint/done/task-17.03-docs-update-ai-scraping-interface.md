---
id: "17.03"
title: "Update product docs and examples for the redesigned scraping interface"
type: docs
priority: medium
complexity: M
difficulty: moderate
sprint: 11
depends_on: ["17.01", "17.02"]
blocks: []
parent: "17"
branch: "feat/task-17-ai-oriented-scraping-interface"
assignee: dev
enriched: true
---

# Task 17.03: Update Product Docs And Examples For The Redesigned Scraping Interface

## Business Requirements

### Problem
Without documentation updates, AI callers and operators will continue to think in terms of the old `extract` surface rather than the new task-shaped interface.

### User Story
As an operator or AI caller, I want docs and examples that clearly show when to use `read`, `scrape_page`, `scrape_listing`, and `scrape_many`, so I can route tasks reliably.

### Acceptance Criteria
- [x] PRD, SRS, SPEC, and README all describe the task-shaped scraping interface.
- [x] Examples include realistic research flows such as product and job-listing research.
- [x] Legacy framing around `extract` is either removed or explicitly downgraded to compatibility status.

### Business Rules
- Docs must reflect shipped behavior.
- Examples should emphasize AI-facing task shape rather than provider internals.

### Out of Scope
- Marketing material.
- Crawl/session workflow tutorials.

---

## Changes
- `README.md` — tool overview and tool reference now center on `scrape_page`, `scrape_listing`, and `scrape_many`
- `vault/ai/docs/researcher-mcp-plan.md` / `task-skeletons.md` — planning docs updated for Wave 11
- `vault/sprint/PLAN.md` — recorded Wave 11 integration and smoke tests

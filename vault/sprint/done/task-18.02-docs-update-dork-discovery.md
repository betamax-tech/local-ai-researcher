---
id: "18.02"
title: "Update docs and specs for dork discovery"
type: docs
priority: medium
complexity: S
difficulty: routine
sprint: 12
depends_on: ["18.01"]
blocks: []
parent: "18"
branch: "feat/task-18-google-only-dork-discovery"
assignee: dev
enriched: true
---

# Task 18.02: Update Docs And Specs For Dork Discovery

## Business Requirements

### Problem
Without docs, AI callers would not know that dork-style discovery is separate from normal search and listing scraping.

### User Story
As an AI caller or operator, I want docs that explain when to use `search_dork` and what it actually guarantees.

### Acceptance Criteria
- [x] README mentions `search_dork` and its role.
- [x] PRD/SRS/SPEC mention the dork-discovery lane.

---

## Changes
- `README.md` — added `search_dork` overview and reference
- `vault/ai/docs/researcher-mcp-prd.md` / `researcher-mcp-srs.md` / `SPEC.md` — documented dork-discovery behavior
- `vault/sprint/PLAN.md` — recorded Wave 12

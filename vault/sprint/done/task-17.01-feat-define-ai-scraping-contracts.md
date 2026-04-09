---
id: "17.01"
title: "Define AI-oriented scraping contracts and routing rules"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 11
depends_on: []
blocks: ["17.02", "17.03"]
parent: "17"
branch: "feat/task-17-ai-oriented-scraping-interface"
assignee: dev
enriched: true
---

# Task 17.01: Define AI-Oriented Scraping Contracts And Routing Rules

## Business Requirements

### Problem
The existing `extract` tool exposes an implementation-flavored surface. AI callers usually know the task shape and desired data, but not the right scraping mechanism.

### User Story
As an AI caller, I want tool boundaries framed around tasks like scraping one page, scraping a listing page, or enriching many URLs, so I can choose correctly without reasoning about fetchers or stealth modes.

### Acceptance Criteria
- [x] Canonical product docs define when to use `read`, `scrape_page`, `scrape_listing`, and `scrape_many`.
- [x] The tool contracts ask for AI-meaningful inputs such as entity type, goal, and requested fields.
- [x] The redesign preserves additive compatibility with the existing search/read/gather foundation.

### Business Rules
- Tool boundaries should optimize for AI reliability, not Scrapling internals.
- Low-level fetcher selection remains an internal system concern.

### Out of Scope
- Provider-side crawl/session expansion.

---

## Changes
- `vault/ai/docs/researcher-mcp-prd.md` — AI-oriented scraping product direction
- `vault/ai/docs/researcher-mcp-srs.md` — task-shaped scraping lanes and routing rules
- `SPEC.md` — current tool surface updated for page/listing/many scraping
- `src/domain/types.ts` — task-shaped scrape contracts and entity hints

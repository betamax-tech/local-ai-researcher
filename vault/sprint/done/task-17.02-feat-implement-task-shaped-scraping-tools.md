---
id: "17.02"
title: "Redesign Scrapling surface into task-shaped scraping tools"
type: feat
priority: high
complexity: L
difficulty: complex
sprint: 11
depends_on: ["17.01"]
blocks: ["17.03"]
parent: "17"
branch: "feat/task-17-ai-oriented-scraping-interface"
assignee: dev
enriched: true
---

# Task 17.02: Redesign Scrapling Surface Into Task-Shaped Scraping Tools

## Business Requirements

### Problem
`extract` is too generic for the strongest AI scraping workflows. Product research, job-listing research, and listing-to-detail workflows need their own first-class tool shapes.

### User Story
As an AI caller, I want separate tools for scraping a page, scraping a listing, and scraping many URLs in parallel, so I can match the tool directly to the task I have.

### Acceptance Criteria
- [x] `scrape_page`, `scrape_listing`, and `scrape_many` exist as MCP tools.
- [x] The provider layer supports listing-oriented repeated-record extraction.
- [x] The interface returns structured outputs suitable for product/job/event/directory research tasks.
- [x] Existing platform verification remains green.

### Business Rules
- The redesign must not break `search`, `read`, `gather`, or `health`.
- If `extract` remains for compatibility, it must no longer be the primary AI-facing recommendation.

### Out of Scope
- Session-management tool exposure.
- Full spider/crawl APIs.

---

## Changes
- `src/tools/scrapePage.ts` / `scrapeListing.ts` / `scrapeMany.ts` — new MCP tool surface
- `src/providers/interfaces.ts` — new `ScrapeProvider` contract
- `src/providers/scrapling.ts` — page/listing scraping support plus compatibility extract alias
- `scripts/scrapling_sidecar.py` — added `/scrape-page` and `/scrape-listing` with field/listing heuristics
- `src/index.ts` — registered the new task-shaped tools
- `src/providers/scrapling.test.ts` and new tool tests — coverage for the redesigned interface

---
id: "17"
title: "AI-oriented scraping interface"
type: feat
priority: high
complexity: L
difficulty: complex
sprint: 11
depends_on: []
blocks: []
branch: "feat/task-17-ai-oriented-scraping-interface"
assignee: dev
enriched: true
---

# Epic 17: AI-Oriented Scraping Interface

## Vision
Refactor the Scrapling-backed surface so AI callers choose tools by task shape and data intent rather than by low-level scraping mechanics.

## Requirements
- Introduce task-shaped scraping tools for page, listing, and multi-page enrichment workflows.
- Preserve `search`, `read`, `gather`, and `health` behavior.
- Move the product away from raw `extract` as the main AI-facing surface.
- Update docs and planning artifacts to teach AI callers when to use each tool.

## Success Metrics
- Tool boundaries are understandable from an AI caller perspective.
- Listing and bulk-enrichment workflows are first-class.
- The interface makes `read` vs scraping selection clearer than before.

## Out of Scope
- Full crawl/session orchestration.
- Replacing search/read with scraping defaults.

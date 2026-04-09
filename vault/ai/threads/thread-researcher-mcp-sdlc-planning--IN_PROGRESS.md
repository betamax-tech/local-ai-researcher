---
id: thread-researcher-mcp-sdlc-planning
title: "Researcher MCP SDLC planning"
status: in-progress
priority: high
created: 2026-03-18
updated: 2026-04-09
owner: orchestrator
links:
  - vault/ai/docs/researcher-mcp-prd.md
  - vault/ai/docs/researcher-mcp-srs.md
  - vault/ai/docs/researcher-mcp-plan.md
  - vault/ai/docs/researcher-mcp-task-skeletons.md
next_action: "Decide the next follow-on after adding Google-only dork discovery (likely session/crawl support or stronger routing heuristics)."
---

## Intent

Route the Researcher MCP planning work through the proper SDLC pipeline so the canonical vault docs become executable sprint artifacts without skipping lifecycle checks.

## Current State

- Canonical PRD/SRS/plan/task-skeleton docs have been updated to the v2 direction.
- `vault/sprint/PLAN.md` now records Wave 9 for provider governance + Scrapling extraction.
- Executable sprint artifacts for v2 were completed and recorded in `vault/sprint/done/task-15*`.
- The repo now includes a provider governance manifest, pinned SearXNG image reference, and an additive Scrapling-backed `extract` lane.
- Wave 10 has now been executed: Scrapling moved from host-Python preference to Docker-optional runtime detection and sidecar delivery.
- Wave 11 has now been executed: Scrapling was redesigned around task-shaped tools (`scrape_page`, `scrape_listing`, `scrape_many`).
- Wave 12 has now been executed: `search_dork` was added for Google-forced operator-heavy discovery via local SearXNG.

## Next Action

Decide the next follow-on after the Google-only dork discovery addition. The strongest candidates are: (1) session/crawl support on top of the sidecar, or (2) stronger agent-facing routing heuristics for deciding between `search`, `search_dork`, `read`, `scrape_page`, `scrape_listing`, and `scrape_many`.

## Notes / Parking Lot

- Future planning can use the completed v2 docs plus `task-15*`, `task-16*`, `task-17*`, and `task-18*` artifacts as the current baseline.

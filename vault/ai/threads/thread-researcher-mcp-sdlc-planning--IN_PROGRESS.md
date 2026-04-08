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
next_action: "Decide the next post-v2 follow-on after the completed governance + Scrapling extract sprint (likely crawl/session lane or routing guidance refinement)."
---

## Intent

Route the Researcher MCP planning work through the proper SDLC pipeline so the canonical vault docs become executable sprint artifacts without skipping lifecycle checks.

## Current State

- Canonical PRD/SRS/plan/task-skeleton docs have been updated to the v2 direction.
- `vault/sprint/PLAN.md` now records Wave 9 for provider governance + Scrapling extraction.
- Executable sprint artifacts for v2 were completed and recorded in `vault/sprint/done/task-15*`.
- The repo now includes a provider governance manifest, pinned SearXNG image reference, and an additive Scrapling-backed `extract` lane.

## Next Action

Decide the next follow-on after the completed v2 sprint. The obvious candidates are: (1) crawl/session capabilities on top of Scrapling, or (2) improved routing guidance so AI callers know when to use `read` vs `extract`.

## Notes / Parking Lot

- Future planning can use the completed v2 docs and `task-15*` artifacts as the new baseline.

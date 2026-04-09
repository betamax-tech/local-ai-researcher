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
next_action: "Decide the next post-distribution follow-on now that Waves 9 and 10 are complete (likely crawl/session support or routing guidance improvements)."
---

## Intent

Route the Researcher MCP planning work through the proper SDLC pipeline so the canonical vault docs become executable sprint artifacts without skipping lifecycle checks.

## Current State

- Canonical PRD/SRS/plan/task-skeleton docs have been updated to the v2 direction.
- `vault/sprint/PLAN.md` now records Wave 9 for provider governance + Scrapling extraction.
- Executable sprint artifacts for v2 were completed and recorded in `vault/sprint/done/task-15*`.
- The repo now includes a provider governance manifest, pinned SearXNG image reference, and an additive Scrapling-backed `extract` lane.
- Wave 10 has now been executed: Scrapling moved from host-Python preference to Docker-optional runtime detection and sidecar delivery.

## Next Action

Decide the next follow-on after the Docker-backed distribution refactor. The strongest candidates are: (1) crawl/session support on top of the sidecar, or (2) better AI routing guidance for when to prefer `read` vs `extract`.

## Notes / Parking Lot

- Future planning can use the completed v2 docs plus `task-15*` and `task-16*` artifacts as the current baseline.

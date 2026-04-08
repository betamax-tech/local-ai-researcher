---
id: "15"
title: "V2 stability and extraction"
type: feat
priority: high
complexity: L
difficulty: complex
sprint: 9
depends_on: []
blocks: []
branch: "feat/task-15-v2-stability-and-extraction"
assignee: dev
enriched: true
---

# Epic 15: V2 Stability and Extraction

## Vision
Stabilize provider/runtime governance and expand the product from a discovery-plus-read backend into a multi-lane retrieval platform with a first Scrapling-backed extraction lane.

## Requirements
- Track provider/runtime expectations in a canonical manifest.
- Surface provider governance and version visibility through `health`.
- Add an additive Scrapling-backed `extract` lane without breaking v1 tools.
- Update docs and package assets so operators can enable and understand the new lane.

## Success Metrics
- Existing tests/build remain green.
- Health output exposes provider governance metadata.
- A new `extract` tool is shipped and documented.

## Out of Scope
- Full crawl/session orchestration.
- Replacing `read` with Scrapling by default.

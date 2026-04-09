---
id: "16.02"
title: "Refactor extract lane from host Python bridge to Docker sidecar"
type: refactor
priority: high
complexity: L
difficulty: complex
sprint: 10
depends_on: ["16.01"]
blocks: ["16.03"]
parent: "16"
branch: "feat/task-16-dockerized-scrapling-distribution"
assignee: dev
enriched: true
---

# Task 16.02: Refactor Extract Lane From Host Python Bridge To Docker Sidecar

## Business Requirements

### Problem
The `extract` lane currently depends on a host-local Python bridge. That makes the feature harder to distribute and inconsistent with the product’s Docker-friendly optional dependency model.

### User Story
As a product maintainer, I want the Scrapling extraction runtime to live behind an optional Docker sidecar so that the feature can be distributed cleanly while remaining additive and easy to disable.

### Acceptance Criteria
- [x] Scrapling runtime no longer requires host Python in the preferred distribution path.
- [x] The MCP server can detect and talk to a Docker-backed Scrapling runtime when enabled.
- [x] Compose/runtime assets exist for the optional Scrapling sidecar.
- [x] `extract` and `health` reflect the new runtime path correctly.
- [x] Existing non-Scrapling workflows remain stable and verified.

### Business Rules
- Keep `extract` additive; do not mutate `read` into a hidden scraping lane.
- Maintain SSRF/resource-bound expectations around the new sidecar communication path.
- Prefer graceful degradation when Docker is absent or Scrapling sidecar is unhealthy.

### Out of Scope
- Crawl/session orchestration.
- Broad provider architecture redesign outside the Scrapling lane.

---

## Changes
- `src/providers/scrapling.ts` — replaced subprocess bridge with HTTP sidecar provider
- `scripts/scrapling_sidecar.py` — new Scrapling HTTP sidecar
- `docker/scrapling/Dockerfile` — new optional sidecar image
- `docker-compose.yml` — added Scrapling sidecar service/profile
- `src/providers/scrapling.test.ts` — updated provider tests for HTTP sidecar semantics
- `src/index.ts` — wired provider through shared `HttpClient`

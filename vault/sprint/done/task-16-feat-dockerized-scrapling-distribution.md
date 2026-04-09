---
id: "16"
title: "Dockerized Scrapling distribution"
type: feat
priority: high
complexity: L
difficulty: complex
sprint: 10
depends_on: []
blocks: []
branch: "feat/task-16-dockerized-scrapling-distribution"
assignee: dev
enriched: true
---

# Epic 16: Dockerized Scrapling Distribution

## Vision
Refactor the new Scrapling extraction lane so the product keeps its low-friction `pnpx github:...` distribution while automatically unlocking scraping when Docker is available.

## Requirements
- Preserve easy default distribution without a host Python dependency.
- Make Scrapling an optional Docker-backed capability that can be auto-detected.
- Keep `extract` additive and health-visible.
- Ensure failure to run Docker-backed scraping degrades gracefully rather than breaking the base MCP server.

## Success Metrics
- Base `pnpx github:...` flow works without Python installation.
- When Docker is available and enabled, `extract` becomes usable through a containerized Scrapling runtime.
- Health/diagnostics clearly report the Docker-backed capability state.

## Out of Scope
- Full crawl/session orchestration.
- Forcing Docker as a required dependency for all users.

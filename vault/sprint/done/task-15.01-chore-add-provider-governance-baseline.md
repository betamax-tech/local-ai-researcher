---
id: "15.01"
title: "Add provider governance baseline"
type: chore
priority: high
complexity: M
difficulty: moderate
sprint: 9
depends_on: []
blocks: ["15.02", "15.03"]
parent: "15"
branch: "feat/task-15-v2-stability-and-extraction"
assignee: dev
enriched: true
---

# Task 15.01: Add Provider Governance Baseline

## Business Requirements

### Problem
Provider drift was invisible: SearXNG used a floating `latest` image, Jina runtime expectations lived only in prose, and there was no canonical operator-readable record of what versions the repo expected.

### User Story
As an operator, I want a canonical provider/runtime manifest and visible health diagnostics so that I can keep the stack stable across upgrades.

### Acceptance Criteria
- [x] The repo contains a canonical provider manifest covering SearXNG, Jina Reader, and Scrapling.
- [x] SearXNG runtime reference is pinned away from `latest` in the local Docker config.
- [x] `health` can surface provider governance metadata and expected versions when available.

### Business Rules
- Governance is additive and must not break v1 tool contracts.
- Optional providers may be reported separately from required ones.

### Out of Scope
- Automatic provider upgrades.

---

## Changes
- `provider-manifest.json` — new canonical provider/runtime manifest
- `docker-compose.yml` — pinned SearXNG image tag
- `src/lib/provider-governance.ts` — new governance loader
- `src/tools/health.ts` — governance-aware health output
- `src/tools/health-governance.test.ts` — governance coverage

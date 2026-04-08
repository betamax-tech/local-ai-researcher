---
id: "15.02"
title: "Add Scrapling extract lane MVP"
type: feat
priority: high
complexity: L
difficulty: complex
sprint: 9
depends_on: ["15.01"]
blocks: ["15.03"]
parent: "15"
branch: "feat/task-15-v2-stability-and-extraction"
assignee: dev
enriched: true
---

# Task 15.02: Add Scrapling Extract Lane MVP

## Business Requirements

### Problem
The stack could discover and read pages, but it had no first-class lane for targeted extraction from JS-heavy pages, listings, or repeated entities.

### User Story
As a researcher agent, I want a dedicated `extract` lane so that I can pull structured or targeted content from known pages without abusing the generic `read` path.

### Acceptance Criteria
- [x] A new MCP `extract` tool exists.
- [x] Scrapling is integrated through an optional Python bridge rather than replacing the Node host runtime.
- [x] Tool/provider contracts are normalized and tested.
- [x] Existing v1 tools remain untouched in behavior.

### Business Rules
- `extract` is additive and explicit.
- Scrapling remains optional and health-visible.
- SSRF baseline still applies before subprocess-based extraction.

### Out of Scope
- Full crawl/session APIs.
- Hidden routing from `read` into Scrapling.

---

## Changes
- `src/domain/types.ts` — extract domain contract + scrapling config
- `src/providers/interfaces.ts` — extract provider interface
- `src/lib/errors.ts` — extract error taxonomy
- `src/providers/scrapling.ts` — new Scrapling provider adapter
- `scripts/scrapling_bridge.py` — Python bridge
- `src/tools/extract.ts` — new MCP tool
- `src/providers/scrapling.test.ts` — provider tests
- `src/tools/extract.test.ts` — tool tests
- `src/index.ts` — tool/provider registration
- `src/config.ts` / `src/config.test.ts` — Scrapling config wiring

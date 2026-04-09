---
id: "16.03"
title: "Update startup and distribution docs for optional Docker scraping"
type: docs
priority: medium
complexity: M
difficulty: moderate
sprint: 10
depends_on: ["16.01", "16.02"]
blocks: []
parent: "16"
branch: "feat/task-16-dockerized-scrapling-distribution"
assignee: dev
enriched: true
---

# Task 16.03: Update Startup And Distribution Docs For Optional Docker Scraping

## Business Requirements

### Problem
Once Scrapling moves behind Docker auto-detection, operators will need a simple explanation of what the default path is, what Docker unlocks, and how the runtime behaves when optional scraping is unavailable.

### User Story
As an operator, I want concise and accurate distribution docs so I can understand what installs are required, what is optional, and how to verify that Docker-backed scraping is enabled.

### Acceptance Criteria
- [x] README and operator guidance describe the base path versus Docker-enhanced path clearly.
- [x] Startup/detection semantics are documented without assuming host Python.
- [x] Health verification examples cover the optional Scrapling sidecar state.

### Business Rules
- Docs should optimize for the easy default installation story.
- Optional capability should be explained as additive, not mandatory.

### Out of Scope
- Marketing copy.
- Non-Scrapling distribution changes.

---

## Changes
- `README.md` — updated optional Docker-backed Scrapling distribution guidance
- `vault/ai/docs/researcher-mcp-prd.md` — reflected Docker-backed extraction lane distribution
- `vault/ai/docs/researcher-mcp-srs.md` — reflected Docker-backed sidecar runtime expectations
- `vault/ai/docs/researcher-mcp-plan.md` / `researcher-mcp-task-skeletons.md` — aligned planning docs with Docker-backed direction
- `vault/sprint/PLAN.md` — recorded Wave 10 integration and smoke-test results

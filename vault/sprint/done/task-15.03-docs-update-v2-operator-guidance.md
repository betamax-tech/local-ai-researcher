---
id: "15.03"
title: "Update v2 operator guidance"
type: docs
priority: high
complexity: M
difficulty: moderate
sprint: 9
depends_on: ["15.01", "15.02"]
blocks: []
parent: "15"
branch: "feat/task-15-v2-stability-and-extraction"
assignee: dev
enriched: true
---

# Task 15.03: Update V2 Operator Guidance

## Business Requirements

### Problem
Without documentation updates, operators and AI callers would not know the new tool surface, governance expectations, or Scrapling enablement path.

### User Story
As an operator, I want the README and canonical planning docs to reflect v2 so that setup, usage, and maintenance are clear.

### Acceptance Criteria
- [x] Canonical PRD/SRS/plan/task skeleton docs reflect the v2 direction.
- [x] README documents the new `extract` tool, governance manifest, and Scrapling env vars.
- [x] Package metadata includes new shipped assets required by v2.

### Business Rules
- Docs must describe shipped behavior, not speculative future work.

### Out of Scope
- Full release announcement collateral.

---

## Changes
- `vault/ai/docs/researcher-mcp-prd.md` — updated to v2
- `vault/ai/docs/researcher-mcp-srs.md` — updated to v2
- `vault/ai/docs/researcher-mcp-plan.md` — updated v2 waves
- `vault/ai/docs/researcher-mcp-task-skeletons.md` — updated v2 backlog framing
- `README.md` — operator and tool docs refreshed
- `package.json` — shipped manifest + version bump
- `vault/sprint/PLAN.md` — recorded wave 9 and integration results

---
id: "06"
title: "Validate canonical Researcher MCP baseline"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 1
depends_on: []
blocks: ["06.01"]
branch: "feat/task-06-v1-execution-validation"
assignee: pm
enriched: true
rmcp_id: "RMCP-00"
---

# Epic 06: Validate Canonical Researcher MCP Baseline

## Vision
Start the sprint from one locked interpretation of the product rather than the older mixed planning history. This epic establishes the current baseline against the canonical Researcher MCP direction so later work closes verified gaps instead of repeating legacy assumptions.

## Requirements
- Confirm the product is planned as an OpenCode-first MCP stdio server.
- Confirm the approved v1 provider pair remains self-hosted SearXNG plus self-hosted `jina-ai/reader`.
- Convert any mismatch between current behavior and the canonical v1 defaults into explicit follow-on backlog work.

## Non-Functional Requirements
- Validation findings must be reproducible from repository state and runnable behavior.
- Findings must clearly separate locked v1 scope from future ideas.

## Success Metrics
- A single validation task identifies the present-state gaps against the canonical v1 direction.
- All later execution tasks trace back to a confirmed requirement or confirmed gap.

## Out of Scope
- Fixing the identified gaps.
- Adding new providers, transports, or product surfaces.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Epic-level guidance; subtasks contain implementation details -->

## Architecture Notes

**Epic Type: Validation (Read-only)** — This epic produces a gap report, not code changes.

**Critical Path Entry:** Task 06.01 is the first task on the critical path. All Wave 2+ work depends on its output.

**Pattern:** Audit against canonical sources (`vault/ai/docs/`) and produce structured findings.

## Affected Areas

- All modules listed in `vault/ai/docs/architecture/module-map.md`
- No code changes; only documentation of current state

## Quality Gates

- Gap report is complete before Wave 2 tasks begin
- Findings are actionable (each gap maps to a follow-on task)

## Gotchas

- This epic gates all downstream work; prioritize completion

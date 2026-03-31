---
id: "12.02"
title: "Publish operator-ready release guidance"
type: docs
priority: high
complexity: M
difficulty: moderate
sprint: 6
depends_on: ["10.02", "12.01"]
blocks: []
parent: "12"
branch: "feat/task-12-packaging-release-readiness"
assignee: dev
enriched: true
rmcp_id: "RMCP-06-B"
---

# Task 12.02: Publish Operator-Ready Release Guidance

## Business Requirements

### Problem
The canonical direction changed the release story, provider story, and default content policy. Operators need guidance that reflects the frozen v1 product rather than the older excerpt-first or partially complete backlog narrative.

### User Story
As an operator, I want accurate release guidance for the canonical v1 server so that I can configure providers, understand defaults, and verify readiness before use.

### Acceptance Criteria
- [ ] Release guidance explains the approved v1 runtime, packaging path, and OpenCode-first stdio usage.
- [ ] Release guidance explains the required self-hosted SearXNG and self-hosted `jina-ai/reader` configuration expectations.
- [ ] Release guidance explains that full content is the default read behavior and that truncation or excerpting is explicit.
- [ ] Release guidance explains request-scoped dedup default behavior, optional SQLite cache behavior, and the disabled-by-default cache rule.
- [ ] Release guidance explains the mandatory safety/privacy baseline and how operators can verify readiness for the four v1 tools.

### Business Rules
- Guidance must reflect the frozen Wave 4 contract and the final packaging target.
- Guidance must not revive obsolete scope such as local files, custom sources, or alternate transports.

### Out of Scope
- Implementation work on product behavior.
- Non-v1 roadmap planning.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Documentation** — Release guidance is the operator-facing contract for v1 behavior.

**Pattern: Single-source-of-truth docs** — Documentation reflects frozen v1 contract; no speculation about future versions.

**Rationale:** Operators need accurate guidance. Docs that drift from implementation cause support burden and trust issues.

**Constraints this creates:**
- Docs must match frozen schema (10.01) and packaging (12.01)
- Docs must not describe out-of-scope features (local files, custom sources, cloud)
- Docs must clearly state defaults (full content, dedup enabled, cache disabled)

## Affected Areas

- `README.md` — primary operator entry point:
  - Quick start with npx/pnpm dlx
  - Environment variables for SearXNG and jina-ai/reader configuration
  - Default behaviors (full content, request-scoped dedup, no cache)
  - Safety baseline overview
- `docs/` (if exists) or inline docs:
  - Tool reference for search, read, gather, health
  - Content policy explanation (full default, explicit truncation)
  - Cache configuration (opt-in SQLite)
  - Troubleshooting common issues
- `CHANGELOG.md` or release notes — v1.0.0 release entry

## Quality Gates

- README includes working `npx` example that starts server
- Environment variable list is complete and accurate (matches `src/config.ts`)
- Default behaviors documented: full content, dedup enabled, cache disabled
- Tool descriptions match frozen v1 schema field names
- No mention of out-of-scope features (local files, custom sources, alternate transports)
- Safety/privacy baseline is documented as mandatory, not optional

## Gotchas

- Docs must be updated if any task changes behavior — verify against final implementation
- Environment variable names in docs must match code exactly
- Example commands should be copy-pasteable and work with minimal setup

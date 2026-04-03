---
id: "12"
title: "Prepare packaging and release readiness"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 6
depends_on: ["10.01"]
blocks: ["12.01", "12.02"]
branch: "feat/task-12-packaging-release-readiness"
assignee: pm
enriched: true
rmcp_id: "RMCP-06"
---

# Epic 12: Prepare Packaging And Release Readiness

## Vision
Package the canonical v1 server for the approved launch path and give operators a reliable release story. This epic turns the frozen Researcher MCP contract into something OpenCode users can run through `npx` or `pnpm dlx` with confidence.

## Requirements
- Package the server for `npx` and `pnpm dlx` launch.
- Describe operator-ready setup and verification for the approved v1 providers.
- Keep release guidance aligned with the frozen v1 schemas and contract coverage.

## Non-Functional Requirements
- Packaging must preserve OpenCode-first stdio usage.
- Release guidance must reflect the locked safety/privacy baseline and disabled-by-default cache behavior.

## Success Metrics
- A new operator can launch the packaged server through the approved distribution path.
- Release guidance matches the shipped v1 behavior without reviving obsolete scope.

## Out of Scope
- Alternate transports.
- Cloud deployment playbooks.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Epic-level guidance; subtasks contain implementation details -->

## Architecture Notes

**Epic Type: Release** — Packaging and documentation for v1 launch.

**Final Wave:** This epic is the last step before v1 release.

**Pattern:** Package for npx/pnpm → Document frozen contract → Ship.

## Affected Areas

- `package.json` — bin entry, files, engines
- Build configuration — ensure runnable output
- `README.md` — operator quick start
- `docs/` — tool reference, configuration, troubleshooting

## Quality Gates

- 12.01 (packaging) completes before 12.02 (docs)
- npx and pnpm dlx both work correctly
- Docs match frozen v1 contract exactly

## Gotchas

- Test packaging on clean install (rm -rf node_modules) to catch missing dependencies
- Docs must not describe out-of-scope features (local files, custom sources, cloud)
- Environment variable documentation must match config.ts exactly

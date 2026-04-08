# Researcher MCP - Task Skeletons (Vault Canonical, v2)

These are the canonical task skeletons for the current v2 increment.

## Stable Planning IDs

- Use `RMCP-V2-*` ids for discussion and dependency references.
- When converting into executable tasks, assign real task-wave IDs and keep `rmcp_id: RMCP-V2-*` in frontmatter.

## Global Acceptance Baseline (v2)

- Existing v1 tools remain contract-stable
- AI-ingestible outputs stay structured, consistent, and provenance-forward
- Provider/runtime versions are recorded in a canonical manifest and surfaced operationally
- Scrapling is added as an additive extraction lane, not a hidden replacement for `read`
- SSRF/resource-bound/redacted-logging baseline still applies to every outbound lane

## Epics (Wave Mapping)

- `RMCP-V2-01` (Wave 1): Define provider governance baseline and canonical manifest
- `RMCP-V2-02` (Wave 2): Surface provider/version compatibility in `health`
- `RMCP-V2-03` (Wave 3): Add Scrapling extraction provider bridge and normalized `extract` tool
- `RMCP-V2-04` (Wave 4): Verify, document, and package the v2 additive lane

## Recommended Executable Task Split

- `RMCP-V2-01A` — create repo-tracked provider manifest and pin SearXNG runtime reference
- `RMCP-V2-02A` — thread provider manifest data into diagnostics/health output
- `RMCP-V2-03A` — define extraction domain contract and provider interface
- `RMCP-V2-03B` — implement Scrapling Python bridge + Node provider adapter
- `RMCP-V2-03C` — add `extract` tool and integrate it into MCP registration
- `RMCP-V2-04A` — add tests for governance + extract lane
- `RMCP-V2-04B` — update README/operator guidance and shipped package assets

## Migration Note

The current codebase already satisfies most v1 goals. Treat the v2 task set as additive completion work layered on top of the released v1 baseline, not as a restart from scratch.

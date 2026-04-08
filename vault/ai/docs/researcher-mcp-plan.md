# Researcher MCP - Plan (Vault Canonical, v2)

This is the canonical plan for delivering the current v2 direction.

## Waves (High Level)

- Wave 1: Provider governance baseline (canonical provider manifest + pinned/runtime-aware diagnostics)
- Wave 2: Health and compatibility visibility (surface provider/runtime expectations in diagnostics)
- Wave 3: Scrapling extraction lane MVP (`extract` tool + Python bridge + normalized contract)
- Wave 4: Verification + packaging updates (tests, docs, shipped assets, version bump)

## Critical Path

Wave 1 -> Wave 2 -> Wave 3 -> Wave 4

## Parallelism

- Governance docs and runtime diagnostics can progress together once the manifest shape is chosen.
- Scrapling bridge and `extract` tool contract can advance in parallel conceptually, but should serialize in implementation because the tool contract depends on the provider result shape.
- README/operator docs can draft in parallel but should not finalize before verification passes.

## Sprint Focus

This increment is intentionally additive:

- preserve existing `search`, `read`, `gather`, and `health` behavior
- add version-governed provider observability
- add Scrapling as a new extraction lane rather than mutating `read`
- stop short of crawl/session orchestration for now

## Migration Into Task-Waves

- Treat `vault/ai/docs/researcher-mcp-task-skeletons.md` as the canonical backlog draft for this v2 increment.
- Reflect executed work into `vault/sprint/PLAN.md` and task files under `vault/sprint/done/` for auditability.

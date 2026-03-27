# SPEC — Local AI Researcher / Researcher MCP

## Purpose

`local-ai-researcher` is a TypeScript-on-Node.js MCP stdio server intended primarily for OpenCode. Its v1 goal is to turn a research prompt into high-signal web context by combining normalized search results with extracted page content while enforcing a strict safety baseline.

## Locked v1 Product Direction

- Runtime: TypeScript on Node.js
- Interface: OpenCode-first MCP `stdio` server
- Providers: self-hosted SearXNG for search and self-hosted `jina-ai/reader` for read/extract
- Content policy: full content by default; truncation or excerpting must be explicit
- Deduplication: request-scoped by default
- Cache: optional SQLite cache, disabled by default
- Packaging target: `npx` / `pnpm dlx`
- Security baseline: SSRF protection, bounded resources, redacted logging

## Core v1 Tools

- `search` — return normalized ranked results from SearXNG
- `read` — extract AI-ingestible page content from `jina-ai/reader`
- `gather` — orchestrate search + read with request-scoped dedup
- `health` — report server readiness and provider connectivity

## Canonical Planning Sources

The vault is the planning system of record for this direction.

- `vault/ai/docs/researcher-mcp-prd.md`
- `vault/ai/docs/researcher-mcp-srs.md`
- `vault/ai/docs/researcher-mcp-plan.md`
- `vault/ai/docs/researcher-mcp-task-skeletons.md`

`docs/RESEARCHER_MCP_*.md` may exist as reference material, but they are not the canonical planning memory.

## Delivery Constraints

- Planning and execution follow the repo SDLC workflow under `vault/sprint/`.
- Active sprint state must represent exactly one current planning stream.
- Older planning or execution artifacts may be preserved, but they must be archived or explicitly superseded before a new sprint becomes active.
- No provider or packaging scope expansion is allowed without updating the canonical vault docs first.

## Success Boundary For v1

The project is ready for Build when the sprint backlog in `vault/sprint/` has been re-planned against the locked Researcher MCP direction, the task graph reflects the current approved scope, and execution can proceed without ambiguity about which plan is active.

# SPEC — Local AI Researcher / Researcher MCP

## Purpose

`local-ai-researcher` is a TypeScript-on-Node.js MCP stdio server intended primarily for OpenCode. Its current goal is to turn a research prompt into high-signal web context and task-shaped web data by combining normalized search, readable page extraction, and AI-oriented scraping while enforcing a strict safety baseline.

## Current Product Direction

- Runtime: TypeScript on Node.js
- Interface: OpenCode-first MCP `stdio` server
- Providers: self-hosted SearXNG for search, `jina-ai/reader` for read, and optional Docker-backed Scrapling for scraping
- Content policy: full content by default; truncation or excerpting must be explicit
- Deduplication: request-scoped by default
- Cache: optional SQLite cache, disabled by default
- Packaging target: `npx` / `pnpm dlx`
- Security baseline: SSRF protection, bounded resources, redacted logging

## Core Tool Surface

- `search` — return normalized ranked results from SearXNG
- `read` — extract AI-ingestible page content from `jina-ai/reader`
- `scrape_page` — scrape a known page for fields, records, or exact page data
- `scrape_listing` — scrape listing/category/search-result pages into repeated records
- `scrape_many` — scrape multiple known URLs in parallel with a shared extraction intent
- `gather` — orchestrate search + read with request-scoped dedup
- `health` — report server readiness and provider connectivity

## AI Interface Rule

The MCP surface should optimize for what an AI caller usually knows:

- the task shape
- the entity type (for example product, job, event, vendor, property)
- the fields or records it wants

The MCP surface should not force AI callers to choose low-level scraping mechanics such as static vs dynamic vs stealth fetchers. Those remain internal provider decisions.

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

## Success Boundary

The project is ready for Build/Release when the sprint backlog in `vault/sprint/` reflects the current approved Researcher MCP direction, including an AI-usable scraping interface, and execution can proceed without ambiguity about tool boundaries or which plan is active.

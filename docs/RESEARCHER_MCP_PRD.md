# RESEARCHER MCP - PRD v1

Version: 1.0 (Draft)
Last updated: 2026-03-16

## Vision

Provide a local-first research backend for OpenCode via an MCP stdio server that turns a user prompt into high-signal, AI-ingestible web context (search results plus extracted page content) while staying safe by default with SSRF protection, bounded resource use, and redacted logging.

## Problem

AI agents often need web context that is reliable, complete, and safe. Current workflows frequently rely on:

- Provider-specific APIs and brittle glue code
- Implicit truncation or excerpting that silently drops crucial details
- Unbounded fetches that waste time, tokens, or create security risks

The result is non-repeatable research with hidden failure modes.

## Target Users

- OpenCode users who want dependable research tool calls
- Operators who prefer one-machine operation and self-hosted dependencies

## Core Use Cases (v1)

1. Web search: run a query and receive ranked results with normalized metadata.
2. Read URL: extract page content for AI consumption.
3. Gather: search plus read top results and return an AI-ingestible bundle.
4. Health: verify readiness and provider connectivity.

## Product Principles

1. Local-first by default: one-machine operation preferred.
2. No hidden truncation: default content mode is full; excerpting is explicit.
3. Safety is baseline: SSRF protection and redirect defenses on every request.
4. Bounded work: time, concurrency, and bytes are limited and reported.
5. AI-ingestible outputs: structured, deduplicated, metadata-rich.

## Scope

### In scope (v1)

- Runtime: TypeScript on Node.js.
- Product surface: MCP stdio server intended for OpenCode.
- Search provider: self-hosted SearXNG.
- Read/extract provider: self-hosted jina-ai/reader.
- Default content mode: full content.
- Request-scoped deduplication enabled by default.
- Optional SQLite cache: lightweight, opt-in, and bypassable.
- Distribution target: `npx` / `pnpm dlx` ergonomics.

### Out of scope (v1)

- Requiring any cloud provider in v1.
- Persistent indexing, crawling, or building a knowledge base.
- Multi-user auth, accounts, or multi-tenancy.

## Requirements

### Functional

- Expose MCP tools for `search`, `read`, `gather`, and `health`.
- Search uses SearXNG and returns normalized results with stable per-response identifiers.
- Read uses jina-ai/reader and returns extracted content with extraction metadata.
- Gather orchestrates search plus reads and returns a single bundle optimized for AI ingestion.
- Deduplication is request-scoped by default and reported in response metadata.

### Output (AI ingestion)

- Include both:
  - A text payload suitable for direct prompt injection.
  - A structured payload containing full-fidelity fields.
- Default content mode is full.
- Any excerpting or truncation must be explicit via metadata.

### Cache posture (v1)

- SQLite cache support exists in v1.
- Cache is disabled by default.
- Cache can be enabled globally and bypassed per request.

### Security and privacy (mandatory)

- SSRF protection on every outbound HTTP request.
- Redirect handling must not allow SSRF bypass.
- Bounded resources: timeouts, concurrency limits, maximum response sizes.
- Redacted logging by default; no secrets and no full extracted content in logs.

### Operational

- Configurable provider endpoints for self-hosted services.
- Clear health reporting per provider.

## Success Metrics (v1)

- Runs as an MCP stdio server usable by OpenCode.
- Installs and runs with `npx` or `pnpm dlx` style UX.
- Returns coherent AI-ingestible bundles with full content by default and explicit truncation metadata when limits apply.
- SSRF protections demonstrably block private and internal network targets by default.

## Risks

- Provider variability: normalize outputs and expose diagnostics in metadata.
- Large pages: enforce max bytes and allow explicit excerpting.
- SSRF bypass attempts: strict DNS, IP, and redirect validation with conservative defaults.
- Cache correctness and privacy: opt-in, TTL-based, bypassable per request.

## Future (Post-v1)

- Optional cloud providers behind a provider abstraction.
- More advanced caching strategies and stores.
- Explicit chunking modes for very large documents, always metadata-driven.

# Researcher MCP - PRD (v2)

This is the canonical PRD for the current Researcher MCP planning direction.

Source: supersedes the earlier v1 direction derived from `docs/RESEARCHER_MCP_PRD.md` (non-canonical).

## Vision

Researcher MCP is a local-first retrieval backend for OpenCode via MCP stdio that turns a prompt into high-signal web data for AI systems: source discovery, readable page content, targeted extraction, and eventually crawl-depth acquisition, all with safety, bounded execution, and provider observability as baseline requirements.

## Problem Statement

The v1 stack is strong for discovery and article-style reading, but it leaves meaningful gaps for AI research workflows that need:

- JS-rendered pages and browser-backed acquisition
- structured extraction from listings, tables, and repeated entities
- deeper site navigation and session-aware retrieval
- explicit governance over drifting provider/runtime dependencies

To support complete search capability for AIs, the product must evolve from a fast text-ingestion backend into a multi-lane retrieval platform.

## Approved Direction (v2)

- Runtime: TypeScript on Node.js remains the MCP host runtime
- Interface: OpenCode-first MCP stdio server
- Retrieval lanes:
  - Discovery lane: SearXNG
  - Fast read lane: `jina-ai/reader`
  - Deep extraction lane: Scrapling
  - Future crawl lane: Scrapling-backed crawling/session workflows
- Content policy: full content default unless truncation is explicitly requested and clearly signaled
- Dedup: request-scoped by default where aggregation occurs
- Cache: optional SQLite cache, off by default
- Packaging: `npx` / `pnpm dlx`
- Mandatory baseline: SSRF protection, bounded resources, redacted logging, version-pinned provider dependencies, and provider compatibility visibility

## Product Goal for v2

Deliver a stable, version-governed retrieval platform that preserves the speed and ergonomics of v1 while adding a new structured extraction lane for data-oriented research.

## Core Use Cases (v2)

### Existing lanes to preserve

- `search`: run a query and return ranked normalized results
- `read`: extract readable content for a URL for AI consumption
- `gather`: search + read top results and return a single AI-ingestible bundle
- `health`: report readiness, provider connectivity, and provider/runtime version visibility

### New v2 lane to add

- `extract`: perform targeted or structured extraction from a known page, especially when the target is dynamic, repeated, or data-shaped rather than article-shaped

## Default-fit Research Jobs

Researcher MCP should be the default backend for:

- factual lookup and source gathering
- docs, changelog, and article synthesis
- comparison research across multiple sources
- structured extraction from product pages, directories, tables, listings, or result grids
- dynamic or JS-heavy target pages where simple text extraction is insufficient

## Product Principles

- Local-first by default
- No hidden truncation
- Safety is baseline, not an add-on
- Bounded work: timeouts, concurrency, max bytes, and explicit escalation to deeper lanes
- AI-ingestible outputs: structured, provenance-forward, and machine-routable
- Stable provider governance: provider/runtime drift must be visible and testable
- Additive evolution: new capability lanes should not silently break v1 behavior

## v2 Scope

### In scope

- Pin and track provider/runtime versions for SearXNG and Jina Reader, with Scrapling added under the same governance model
- Define provider compatibility expectations and expose them via diagnostics/health
- Add Scrapling as a new extraction lane for structured and dynamic page acquisition
- Preserve the current v1 search/read/gather contract while extending the product with additive capability

### Explicitly out of scope for this v2 increment

- Full persistent web indexing or knowledge-base construction
- Accounts/multi-tenancy
- Replacing the existing `read` lane with Scrapling by default
- Large autonomous crawling workflows as the first Scrapling deliverable

## Success Criteria

- Existing v1 workflows remain stable and contract-compatible
- Operators can state exactly which provider/runtime versions are in use
- Provider drift is detectable through contract tests and health output
- AI callers gain a clear new lane for structured/dynamic extraction without ambiguity about when to use it
- The system is better at acquiring exact web data, not just generic page text

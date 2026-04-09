---
id: "18"
title: "Google-only dork discovery"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 12
depends_on: []
blocks: []
branch: "feat/task-18-google-only-dork-discovery"
assignee: dev
enriched: true
---

# Epic 18: Google-Only Dork Discovery

## Vision
Add a product-level dork-search tool that uses the local SearXNG Google engine on a per-request basis, without mutating global SearXNG configuration.

## Requirements
- Introduce `search_dork` as a discovery-only tool.
- Force Google engine per request rather than changing `settings.yml` at runtime.
- Fail clearly if local SearXNG is unavailable.

## Out of Scope
- Raw Google API integration.
- Dynamic runtime rewriting of SearXNG engine configuration.

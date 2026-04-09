---
id: "18.01"
title: "Add Google-only dork search tool via local SearXNG"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 12
depends_on: []
blocks: ["18.02"]
parent: "18"
branch: "feat/task-18-google-only-dork-discovery"
assignee: dev
enriched: true
---

# Task 18.01: Add Google-Only Dork Search Tool Via Local SearXNG

## Business Requirements

### Problem
The product had no dedicated operator-heavy discovery tool, even though local SearXNG already enables Google.

### User Story
As an AI caller, I want a clear `search_dork` tool so I can run site-restricted and operator-heavy discovery without guessing whether Google is being used.

### Acceptance Criteria
- [x] `search_dork` exists and forces Google engine through local SearXNG.
- [x] SearXNG provider supports per-request engine forcing.
- [x] The tool fails clearly if local SearXNG is unavailable.

---

## Changes
- `src/tools/searchDork.ts` / `searchDork.test.ts` — new tool and tests
- `src/providers/searxng.ts` / `searxng.test.ts` — per-request forced engine support
- `src/index.ts` / `src/domain/types.ts` — tool registration and option support

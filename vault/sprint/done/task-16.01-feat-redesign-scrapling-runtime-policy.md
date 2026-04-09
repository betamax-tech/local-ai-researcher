---
id: "16.01"
title: "Redesign Scrapling provider runtime around Docker auto-detection"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 10
depends_on: []
blocks: ["16.02", "16.03"]
parent: "16"
branch: "feat/task-16-dockerized-scrapling-distribution"
assignee: dev
enriched: true
---

# Task 16.01: Redesign Scrapling Provider Runtime Around Docker Auto-Detection

## Business Requirements

### Problem
The current Scrapling MVP works, but it assumes a host Python installation and separate Scrapling dependency setup. That breaks the desired “easy distribution from GitHub” model.

### User Story
As an operator, I want Scrapling to become available automatically when Docker is present, without adding a host Python setup burden, so that advanced scraping feels like an optional upgrade rather than a separate installation track.

### Acceptance Criteria
- [x] A runtime policy is defined for Scrapling enablement with explicit modes such as disabled, auto, and required.
- [x] The detection flow clearly states when Docker-backed Scrapling should start, when it should stay off, and how long startup checks may take.
- [x] The new policy preserves the current lightweight base path for users who only want `search`, `read`, and `gather`.
- [x] Health semantics for optional Docker-backed providers are specified clearly enough to implement without ambiguity.

### Business Rules
- Docker-backed Scrapling must remain optional.
- Failure to start optional scraping must not fail the whole MCP server in the default path.
- Runtime detection should prefer bounded probing and explicit status reporting over silent hangs or ambiguous behavior.

### Out of Scope
- Implementing the refactor itself.
- Designing crawl/session features.

---

## Changes
- `src/domain/types.ts` — added optional-provider runtime mode for Scrapling config
- `src/config.ts` / `src/config.test.ts` — introduced `disabled|auto|required` config parsing and Docker bootstrap settings
- `scripts/start.sh` — bounded Docker detection and optional Scrapling startup policy
- `provider-manifest.json` — updated Scrapling runtime expectations to Docker sidecar form

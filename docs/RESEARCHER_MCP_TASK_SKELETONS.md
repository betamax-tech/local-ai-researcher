# Researcher MCP Task Skeletons (Documentation Only)

This document defines initial epics and task skeletons in a task-wave style.
It is documentation-only and does not modify existing sprint artifacts.

## How To Convert Into Executable Tasks Later

- Treat `rmcp_id` as the stable identifier for discussion and planning.
- When migrating into task-wave execution, assign real global task IDs and preserve `rmcp_id` in frontmatter.
- Dependencies reference `rmcp_id` to avoid collisions with existing task numbering in the repo.

## Global Acceptance Baseline (v1)

- Outputs are optimized for AI ingestion: structured, consistent, provenance-forward, minimal noise.
- Full content is the default for reading; truncation or excerpt requires explicit request input and is clearly signaled.
- Request-scoped deduplication is the default where aggregation occurs.
- Providers are self-hosted endpoints configured by the user.

---

## Epic: Wave 0 Spike/Validation

### Task Skeleton

---
rmcp_id: RMCP-00
wave: 0
title: Validate end-to-end MCP stdio execution with v1 providers
type: spike
difficulty: moderate
size: S
enriched: false
depends_on: []
blocks:
  - RMCP-01
---

### Business Requirements

- Enable a user to run the MCP server locally over stdio and exercise search plus read with real endpoints.
- Produce representative sample responses that demonstrate the intended AI-ingestion shape and provenance.
- Capture a written risk list with proposed mitigations.

### Acceptance Criteria

- A user can execute the server locally and receive valid MCP responses for:
  - Search against a configured SearXNG endpoint.
  - Read against a configured Jina Reader endpoint.
- Responses include, at minimum, request identifier, provider identifier, source URLs, and returned content fields.
- Truncation or excerpt behavior is demonstrable only when explicitly requested and is signaled in the response.
- A short risk list exists and is actionable.

### Out of Scope

- Caching, packaging, and comprehensive test coverage.

---

## Epic: Wave 1 Foundation + Provider Contracts

---
rmcp_id: RMCP-01
wave: 1
title: Define v1 tool contracts, response schema, and provider boundaries
type: feat
difficulty: complex
size: M
enriched: false
depends_on:
  - RMCP-00
blocks:
  - RMCP-02
  - RMCP-03
  - RMCP-04
---

### Business Requirements

- Provide stable tool contracts so downstream AI agents can rely on consistent behavior.
- Define provider boundaries so adding a new provider later does not require changing tool semantics.
- Define default behaviors for full content vs truncation, request-scoped deduplication, and provenance.
- Define a consistent error taxonomy that is machine-actionable.

### Acceptance Criteria

- Tool contracts are documented with inputs, outputs, and error cases.
- A golden example response exists for each tool that can later be used for contract testing.
- Default behaviors are explicit and testable.

### Out of Scope

- Implementing provider-specific logic beyond what is needed to validate contracts.

---

### Task Skeleton

---
rmcp_id: RMCP-01.01
wave: 1
title: Specify tool inputs/outputs and golden examples
type: docs
difficulty: moderate
size: S
enriched: false
depends_on:
  - RMCP-00
blocks:
  - RMCP-02
  - RMCP-03
---

### Business Requirements

- Document each v1 tool's user-visible behavior so implementation and testing are unambiguous.
- Provide golden example inputs and outputs for contract tests.

### Acceptance Criteria

- Each tool has at least one golden example with concrete values.
- Golden examples include full content default, explicit truncation or excerpt, and dedup behavior.

---

### Task Skeleton

---
rmcp_id: RMCP-01.02
wave: 1
title: Define v1 error taxonomy and retry guidance
type: feat
difficulty: moderate
size: S
enriched: false
depends_on:
  - RMCP-00
blocks:
  - RMCP-04
---

### Business Requirements

- Ensure errors are machine-actionable and consistent across providers.
- Provide guidance about retryable vs non-retryable failures.

### Acceptance Criteria

- Error responses include a stable error code, short human-readable message, and provider attribution when applicable.
- Retry guidance is explicit for timeouts, rate limits, and invalid inputs.

---

## Epic: Wave 2 SearXNG Provider v1

---
rmcp_id: RMCP-02
wave: 2
title: Deliver SearXNG search provider with normalized results
type: feat
difficulty: moderate
size: M
enriched: false
depends_on:
  - RMCP-01
blocks:
  - RMCP-04
---

### Business Requirements

- Enable a user to submit a query and receive normalized results suitable for AI ingestion.
- Preserve provenance for each result.
- Handle common endpoint failures in a predictable, contract-compliant way.

### Acceptance Criteria

- Search responses include a list of results with stable fields and a per-request identifier.
- Endpoint failures return contract-compliant errors with stable codes.
- The provider supports an explicit result limit with a documented default.

---

### Task Skeleton

---
rmcp_id: RMCP-02.01
wave: 2
title: Implement normalized search results and provenance fields
type: feat
difficulty: moderate
size: M
enriched: false
depends_on:
  - RMCP-01.01
blocks:
  - RMCP-04
---

### Business Requirements

- Normalize the provider's raw output into the v1 response shape.
- Ensure each result has provenance fields usable by downstream AI agents.

### Acceptance Criteria

- For representative queries, returned results match the documented schema and golden examples.
- Each result includes at least `title`, `url`, and a short text field when available.

---

### Task Skeleton

---
rmcp_id: RMCP-02.02
wave: 2
title: Add provider failure handling aligned with v1 error taxonomy
type: feat
difficulty: moderate
size: S
enriched: false
depends_on:
  - RMCP-01.02
blocks:
  - RMCP-04
---

### Business Requirements

- Convert common provider failures into v1 error codes with retry guidance.

### Acceptance Criteria

- Timeouts, non-2xx responses, and invalid upstream payloads map to stable error codes.
- Error responses remain machine-ingestible and include provider attribution.

---

## Epic: Wave 3 Jina Reader Provider v1

---
rmcp_id: RMCP-03
wave: 3
title: Deliver Jina Reader content extraction with explicit truncation
type: feat
difficulty: moderate
size: M
enriched: false
depends_on:
  - RMCP-01
blocks:
  - RMCP-04
---

### Business Requirements

- Enable a user to read a URL and obtain extracted text optimized for AI ingestion.
- Default to full content.
- Support explicit truncation or excerpt requests and clearly signal truncation.

### Acceptance Criteria

- Default read returns full extracted content for a representative URL set.
- When explicit truncation or excerpt input is provided, the response signals truncation and the applied limit.
- Provider failures map to the v1 error taxonomy.

---

### Task Skeleton

---
rmcp_id: RMCP-03.01
wave: 3
title: Return full extracted content by default with provenance
type: feat
difficulty: moderate
size: M
enriched: false
depends_on:
  - RMCP-01.01
blocks:
  - RMCP-04
---

### Business Requirements

- Provide extracted content plus provenance fields that downstream AI agents can use.

### Acceptance Criteria

- Responses include extracted text plus source URL and provider attribution.
- Output is structured and consistent with golden examples.

---

### Task Skeleton

---
rmcp_id: RMCP-03.02
wave: 3
title: Support explicit truncation/excerpt with clear signaling
type: feat
difficulty: moderate
size: S
enriched: false
depends_on:
  - RMCP-01.01
blocks:
  - RMCP-04
---

### Business Requirements

- Allow callers to explicitly request a shorter excerpt of content.

### Acceptance Criteria

- When explicit truncation or excerpt inputs are used, the response includes the applied limit and a clear signal that truncation occurred.

---

## Epic: Wave 4 Schema Freeze + Contract Tests

---
rmcp_id: RMCP-04
wave: 4
title: Freeze v1 schemas and enforce via contract tests
type: test
difficulty: complex
size: M
enriched: false
depends_on:
  - RMCP-02
  - RMCP-03
blocks:
  - RMCP-05
  - RMCP-06
---

### Business Requirements

- Prevent accidental breaking changes by freezing schemas and tool contracts.
- Provide contract tests that validate golden examples and key error modes.

### Acceptance Criteria

- Contract tests exist for each tool and both providers.
- A change to any v1 response schema requires updating the documented contract and tests.

---

### Task Skeleton

---
rmcp_id: RMCP-04.01
wave: 4
title: Create contract test suite from golden examples
type: test
difficulty: moderate
size: M
enriched: false
depends_on:
  - RMCP-01.01
  - RMCP-02.01
  - RMCP-03.01
blocks:
  - RMCP-06
---

### Business Requirements

- Ensure v1 behavior stays stable as the project evolves.

### Acceptance Criteria

- Tests validate response shapes, provenance fields, and truncation or dedup signaling.

---

### Task Skeleton

---
rmcp_id: RMCP-04.02
wave: 4
title: Standardize error codes across tools and providers
type: feat
difficulty: moderate
size: S
enriched: false
depends_on:
  - RMCP-01.02
  - RMCP-02.02
blocks:
  - RMCP-06
---

### Business Requirements

- Make failures predictable for AI agents so they can recover or escalate appropriately.

### Acceptance Criteria

- The same class of failure yields the same error code across providers.

---

## Epic: Wave 5 Optional SQLite Cache

---
rmcp_id: RMCP-05
wave: 5
title: Add an optional SQLite cache for provider outputs
type: feat
difficulty: complex
size: M
enriched: false
depends_on:
  - RMCP-04
blocks: []
---

### Business Requirements

- Allow users to enable a local cache to reduce repeated network calls.
- Keep caching off by default and behaviorally transparent when disabled.

### Acceptance Criteria

- When cache is disabled, behavior is identical to the no-cache baseline.
- When enabled, repeated identical requests can return from cache.
- Cache supports a user-configurable TTL policy.

### Out of Scope

- Distributed caching or cross-machine sync.

---

### Task Skeleton

---
rmcp_id: RMCP-05.01
wave: 5
title: Define cache policy and user controls (TTL, on/off)
type: feat
difficulty: moderate
size: S
enriched: false
depends_on:
  - RMCP-04
blocks:
  - RMCP-05.02
---

### Business Requirements

- Ensure caching is predictable and user-controlled.

### Acceptance Criteria

- Policy describes cache keying, TTL behavior, and invalidation rules.

---

### Task Skeleton

---
rmcp_id: RMCP-05.02
wave: 5
title: Implement cache read/write with safe defaults
type: feat
difficulty: complex
size: M
enriched: false
depends_on:
  - RMCP-05.01
blocks: []
---

### Business Requirements

- Reduce redundant provider calls when cache is enabled.

### Acceptance Criteria

- Cache hits and misses are observable without polluting MCP protocol responses.

---

## Epic: Wave 6 Packaging, Docs, Release

---
rmcp_id: RMCP-06
wave: 6
title: Ship v1 as an npx/pnpm dlx runnable MCP server
type: release
difficulty: moderate
size: M
enriched: false
depends_on:
  - RMCP-04
blocks: []
---

### Business Requirements

- Make it easy for users to run the MCP server without cloning the repo.
- Provide concise documentation covering configuration, security posture, and tool behavior.

### Acceptance Criteria

- A user can run the server via `npx` or `pnpm dlx` and complete a basic search plus read flow.
- Documentation includes required configuration, provider prerequisites, and a clear statement of full-content default and explicit truncation.
- A release checklist exists and includes a contract-test pass requirement.

---

### Task Skeleton

---
rmcp_id: RMCP-06.01
wave: 6
title: Enable one-command execution via npx/pnpm dlx
type: release
difficulty: moderate
size: M
enriched: false
depends_on:
  - RMCP-04
blocks: []
---

### Business Requirements

- Eliminate manual build and install steps for typical users.

### Acceptance Criteria

- A fresh machine can run the tool in one command with minimal setup.

---

### Task Skeleton

---
rmcp_id: RMCP-06.02
wave: 6
title: Publish concise user documentation and release checklist
type: docs
difficulty: routine
size: S
enriched: false
depends_on:
  - RMCP-04
blocks: []
---

### Business Requirements

- Provide just enough guidance for successful configuration and safe use.

### Acceptance Criteria

- Docs cover configuration, provider expectations, and tool contract behavior at a user-action level.

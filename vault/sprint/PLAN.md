# PLAN.md — Local Researcher Tool v1 Execution

## Wave Structure

Five execution waves, dependency-ordered:

### Wave 1: Foundation
Initialize project scaffold, package structure, tooling.

**Tasks:**
- `01`: Project bootstrap (TypeScript, ESLint, Jest setup)
- `01.01`: Package.json and dependency tree
- `01.02`: tsconfig.json and build pipeline
- `01.03`: ESLint and Prettier config
- `01.04`: Jest config and test harness
- `01.05`: CI/CD pipeline skeleton (GitHub Actions)

**Dependencies:** None (foundational)

**Acceptance Gate:** Build, lint, and test commands execute cleanly with no errors.

---

### Wave 2: Protocol & Contracts
Implement MCP `stdio` transport and canonical tool interfaces.

**Tasks:**
- `02`: MCP stdio transport layer
- `02.01`: MCP message framing and I/O
- `02.02`: Tool contract interfaces and types
- `02.03`: Error code taxonomy and boundaries

**Dependencies:** Wave 1 complete

**Acceptance Gate:** MCP server starts, accepts tool registration, sends/receives valid JSON-RPC messages.

---

### Wave 3: Safety & Data Handling
Deterministic, repeatable data retrieval with request-scoped dedup.

**Tasks:**
- `03`: Request-scoped deduplication engine
- `03.01`: `read()` tool with file I/O and sandboxing
- `03.02`: `search()` tool with URL canonicalization
- `03.03`: `gather()` orchestrator and synthesis

**Dependencies:** Wave 2 complete

**Acceptance Gate:** Request-scoped dedup verifiable; `read()` respects boundaries; `search()` produces canonical result IDs.

---

### Wave 4: Provider Integration
Integrate external source adapters (web search, local MCP, custom).

**Tasks:**
- `04`: Web search integration (Brave API, fallback)
- `04.01`: Local file and directory source adapter
- `04.02`: Custom MCP server adapter and registry

**Dependencies:** Wave 3 complete

**Acceptance Gate:** Web search, local files, and custom MCP servers all retrievable via single `search()/read()` call.

---

### Wave 5: Orchestration & Shipping
CLI, health checks, logging, documentation, and shipping.

**Tasks:**
- `05`: Health check endpoint and resource monitoring
- `05.01`: CLI interface with config loading
- `05.02`: Structured logging, audit trail, and v1 docs

**Dependencies:** Wave 4 complete

**Acceptance Gate:** CLI launches, health check passes, all logs are structured JSON, README and API docs complete.

---

## Dependency Diagram

```
Wave 1 (Foundation)
    ↓
Wave 2 (Protocol & Contracts)
    ↓
Wave 3 (Safety & Data Handling)
    ↓
Wave 4 (Provider Integration)
    ↓
Wave 5 (Orchestration & Shipping)
```

## Task Numbering

- `01–01.05`: Wave 1
- `02–02.03`: Wave 2
- `03–03.03`: Wave 3
- `04–04.02`: Wave 4
- `05–05.02`: Wave 5

Total: 21 tasks across 5 waves.

---

## Success Criteria (Acceptance for v1)

1. All task files in `vault/sprint/backlog/` have acceptance criteria and architecture notes.
2. All tasks completed and committed to `main` (via `gitflow[orchestrator]`).
3. E2E tests for `search`, `read`, `gather`, and `health` all passing.
4. Config loading (environment + file) working.
5. Structured logging output verified.
6. All error codes from PRD taxonomy properly raised and logged.
7. TypeScript strict mode, no `any`.
8. Public API fully documented with JSDoc.
9. v1 README and API reference published.

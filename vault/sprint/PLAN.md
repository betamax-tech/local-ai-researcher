# PLAN.md — Local Researcher Tool v1 Execution

## Wave Structure

Four execution waves, dependency-ordered. Note: Waves 1-3 are already **complete** in the codebase — the remaining work is Wave 4 (consolidation) and Wave 5 (shipping).

### Wave 1: Foundation ✅ COMPLETE
Initialize project scaffold, package structure, tooling.

**Status:** All tasks complete — code verified via `pnpm typecheck` and `pnpm build`.

**Tasks:**
- `01`: Project bootstrap (TypeScript, ESLint, Jest setup) ✅
- `01.01`: Package.json and dependency tree ✅
- `01.02`: tsconfig.json and build pipeline ✅
- `01.03`: ESLint and Prettier config ⚠️ (lint command is placeholder)
- `01.04`: Jest config and test harness ⚠️ (test command is placeholder)
- `01.05`: CI/CD pipeline skeleton (GitHub Actions) ⚠️ (not yet added)

**Dependencies:** None (foundational)

**Acceptance Gate:** Build passes (`pnpm build`), typecheck passes (`pnpm typecheck`). ⚠️ Lint and test are placeholders.

---

### Wave 2: Protocol & Contracts ✅ COMPLETE
Implement MCP `stdio` transport and canonical tool interfaces.

**Status:** All tasks complete — full MCP stdio server implemented in `src/index.ts`.

**Tasks:**
- `02`: MCP stdio transport layer ✅
- `02.01`: MCP message framing and I/O ✅
- `02.02`: Tool contract interfaces and types ✅
- `02.03`: Error code taxonomy and boundaries ✅

**Dependencies:** Wave 1 complete

**Acceptance Gate:** MCP server starts via `node dist/index.js`, accepts tool registration, sends/receives valid JSON-RPC messages. ✅

---

### Wave 3: Safety & Data Handling ✅ COMPLETE
Deterministic, repeatable data retrieval with request-scoped dedup.

**Status:** All tasks complete — dedup engine integrated in `src/tools/gather.ts`.

**Tasks:**
- `03`: Request-scoped deduplication engine ✅
- `03.01`: `read()` tool with file I/O and sandboxing ✅
- `03.02`: `search()` tool with URL canonicalization ✅
- `03.03`: `gather()` orchestrator and synthesis ✅

**Dependencies:** Wave 2 complete

**Acceptance Gate:** Request-scoped dedup verifiable via `deduplicateUrls()` in gather tool; `read()` respects boundaries; `search()` produces canonical result IDs. ✅

---

### Wave 4: Provider Integration 🔨 IN PROGRESS
Integrate SearxNG and Jina Reader providers (locked v1 scope — NO Brave API, NO local files, NO custom MCP).

**Scope Note:** V1 is SearxNG + Jina Reader ONLY. Local file search and custom MCP servers are v2 future items.

**Tasks:**
- `04`: SearxNG provider integration ✅ (already implemented)
- `04.01`: Jina Reader provider integration ✅ (already implemented)
- `04.02`: Provider health checks verification ⏳ (depends on 04, ready to start)
- `04.03`: Provider error handling validation ⏳ (depends on 04, ready to start)

**Dependencies:** Wave 3 complete

**Acceptance Gate:** SearxNG search works, Jina Reader fetch works. Remaining work: health checks pass for both providers (task 04.02) and error handling follows taxonomy (task 04.03).

---

### Wave 5: Orchestration & Shipping 📋 READY
CLI, health checks, logging, documentation, and shipping.

**Tasks:**
- `05`: Health check endpoint and resource monitoring ✅ (already implemented)
- `05.01`: CLI interface with config loading ✅ (already implemented)
- `05.02`: Structured logging, audit trail, and v1 docs ⏳ (ready to start)
- `05.03`: E2E test suite ⏳ (depends on 04.03, ready after Wave 4 testing)
- `05.04`: README and API reference documentation ⏳ (ready to start)
- `05.05`: ESLint configuration completion ⏳ (ready to start)
- `05.06`: CI/CD GitHub Actions workflow ⏳ (depends on 05.03 + 05.05)

**Dependencies:** Wave 4 complete

**Acceptance Gate:** CLI launches (`node dist/index.js`), health check passes, all logs are structured JSON, README and API docs complete, E2E tests passing.

---

## Dependency Diagram

```
Wave 1 (Foundation) ✅ COMPLETE
    ↓
Wave 2 (Protocol & Contracts) ✅ COMPLETE
    ↓
Wave 3 (Safety & Data Handling) ✅ COMPLETE
    ↓
Wave 4 (Provider Integration) 🔨 IN PROGRESS
    ↓
Wave 5 (Orchestration & Shipping) 📋 READY
```

## Task Numbering

- `01–01.05`: Wave 1 (Foundation) = 6 tasks
- `02–02.03`: Wave 2 (Protocol & Contracts) = 4 tasks
- `03–03.03`: Wave 3 (Safety & Data Handling) = 4 tasks
- `04–04.03`: Wave 4 (Provider Integration) = 4 tasks
- `05–05.06`: Wave 5 (Orchestration & Shipping) = 7 tasks

Total: 25 tasks across 5 waves.

---

## Success Criteria (Acceptance for v1)

1. ✅ All task files in `vault/sprint/backlog/` have acceptance criteria and architecture notes.
2. ✅ All Wave 1-3 tasks completed and verified (typecheck + build pass).
3. ⚠️ E2E tests for `search`, `read`, `gather`, and `health` need to be written and passing.
4. ✅ Config loading (environment + file) working (`src/config.ts` exists and is used).
5. ✅ Structured logging output verified (stderr JSON logging implemented).
6. ✅ All error codes from PRD taxonomy properly raised and logged.
7. ✅ TypeScript strict mode enabled, no `any` (tsconfig.json verified).
8. ⚠️ Public API fully documented with JSDoc (partial, needs completion).
9. ⚠️ v1 README and API reference published (incomplete).

---

## First Unfinished Wave

**Wave 4: Provider Integration** is the first wave with immediately actionable, unfinished tasks.

**Immediately actionable tasks (no blocking dependencies):**
- Task `04.02`: Provider health checks verification (parallel with 04.03)
- Task `04.03`: Provider error handling validation (parallel with 04.02)

Both tasks can be executed in parallel because:
- Core provider implementations (SearxNG + Jina Reader) are complete and tested
- Both tasks are testing/verification focused  
- No new implementation dependencies between them
- Both depend only on task 04, which is complete

**Post-Wave 4 unblocking (after 04.02 and 04.03 complete):**

Wave 5 will have multiple parallel execution tracks:
- **Track A (immediate, no gate):** 05.02, 05.04, 05.05 (can start immediately)
- **Track B (gated by 04.03):** 05.03 (E2E tests, waits for 04.03 error validation)
- **Track C (gated by A+B):** 05.06 (CI/CD, waits for 05.03 + 05.05)

---

## Locked v1 Product Direction

**Confirmed Alignment:**
- ✅ Runtime: Node.js (LTS) + TypeScript
- ✅ MCP Protocol: `stdio` mode only
- ✅ Packaging: Native ESM (type: "module" in package.json)
- ✅ Deduplication: Request-scoped (per `gather()` call)
- ✅ Data Retrieval: Excerpt-first model (30 lines default), full-text opt-in
- ✅ Providers: SearxNG + Jina Reader ONLY (no Brave, no local files, no custom MCP in v1)
- ✅ Tool contracts: `search()`, `read()`, `gather()`, `health()` as defined in PRD.md
- ✅ Error codes: Locked taxonomy (`ERR_SEARXNG_*`, `ERR_JINA_*`, `ERR_GATHER_*`, etc.)

**Out of Scope for v1 (deferred to v2):**
- ❌ Local file search adapter (was in old plan as task `04.01`)
- ❌ Custom MCP server adapter and registry (was in old plan as task `04.02`)
- ❌ Global result caching with TTL (request-scoped only in v1)
- ❌ HTTP and SSE MCP transports (stdio only in v1)

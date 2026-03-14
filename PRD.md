# PRD: Local Researcher Tool

## Vision

Local Researcher Tool is a Node.js/TypeScript CLI and library that provides a unified interface for local LLM-powered research and code analysis. It bridges language models with local data sources (files, directories, web archives, documentation) via Model Context Protocol (MCP) servers, enabling deterministic, repeatable, and auditable research workflows.

## Goals

1. **Deterministic research:** Request-scoped deduplication ensures reproducible tool calls with predictable token usage.
2. **Flexible sourcing:** Support local file operations, web search integration, and custom MCP servers.
3. **Operator control:** Human-readable prompt composition, audit trails, and config-driven behavior.
4. **Production-ready:** Type-safe, error boundaries, structured logging, graceful degradation.

## Non-Goals

- Cloud synchronization or multi-user collaboration in v1.
- Automatic prompt optimization or chain-of-thought internals.
- Third-party package distribution beyond NPM.
- WASM/browser runtime support in v1.

## Locked v1 Decisions

### Architecture
- **Runtime:** Node.js (LTS) + TypeScript.
- **MCP Protocol:** `stdio` mode only (no `sse`, `http`).
- **Packaging:** Native CommonJS/ESM, no Docker wrapper by default.
- **Deduplication:** Request-scoped (per `gather()` call), not global caching.
- **Data Retrieval:** Excerpt-first model (30 lines default), full-text opt-in via `fullText: true`.

### Canonical Tool Contracts

#### `search(query: string, options: SearchOptions)`
Searches local and remote sources (web, files, docs).

**Input:**
```typescript
interface SearchOptions {
  sources?: ('web' | 'local' | 'custom')[];
  limit?: number; // default 5
  fullText?: boolean; // default false
  timeout?: number; // ms, default 5000
}
```

**Output:**
```typescript
interface SearchResult {
  id: string; // deterministic hash of source + query + offset
  title: string;
  url: string;
  excerpt: string; // 30 lines by default or full if fullText: true
  source: 'web' | 'local' | 'custom';
  relevance: number; // 0–1
}
```

**Error Codes:** `SEARCH_TIMEOUT`, `SEARCH_SOURCE_UNAVAILABLE`, `SEARCH_MALFORMED_QUERY`.

#### `read(path: string, options: ReadOptions)`
Reads and excerpts files from the local filesystem.

**Input:**
```typescript
interface ReadOptions {
  lines?: [number, number]; // start, end (1-indexed), optional
  encoding?: 'utf-8' | 'binary'; // default utf-8
}
```

**Output:**
```typescript
interface ReadResult {
  path: string;
  content: string;
  encoding: 'utf-8' | 'binary';
  lineCount: number;
}
```

**Error Codes:** `READ_NOT_FOUND`, `READ_PERMISSION_DENIED`, `READ_ENCODING_ERROR`.

#### `gather(prompt: string, sources: Source[], options: GatherOptions)`
Orchestrates search/read across multiple sources and synthesizes results for the LLM.

**Input:**
```typescript
interface Source {
  type: 'web' | 'local' | 'custom';
  target: string; // URL, file path, or custom identifier
}

interface GatherOptions {
  dedup?: boolean; // default true (request-scoped)
  timeout?: number; // ms, default 10000
  maxTokens?: number; // approximate, for sampling
  strategy?: 'parallel' | 'sequential'; // default parallel
}
```

**Output:**
```typescript
interface GatherResult {
  id: string; // request-scoped unique ID
  prompt: string;
  context: {
    sources: Source[];
    results: (SearchResult | ReadResult)[];
    dedupStats: { total: number; deduped: number };
  };
  synthesis: string; // formatted context block for LLM
}
```

**Error Codes:** `GATHER_NO_SOURCES`, `GATHER_TIMEOUT`, `GATHER_PARTIAL`.

#### `health()`
Reports MCP server readiness and resource status.

**Output:**
```typescript
interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  mcp: {
    stdio: { ready: boolean; version: string };
    servers: Array<{ name: string; status: 'connected' | 'error'; error?: string }>;
  };
  resources: {
    memoryMB: number;
    cwd: string;
  };
}
```

**Error Codes:** `HEALTH_CHECK_FAILED`.

### URL Canonicalization Rules

1. **Scheme:** Always lowercase (`HTTP://` → `http://`).
2. **Hostname:** Always lowercase and remove `www.` prefix unless it's the only subdomain.
3. **Trailing slash:** Remove for comparison (e.g., `https://example.com/` → `https://example.com`).
4. **Query params:** Sort alphabetically by key for consistent deduplication.
5. **Fragments:** Strip for deduplication (preserve if user-provided in results).

### Security

- **Sandboxing:** `read()` operations respect `cwd` boundary and `.gitignore` by default.
- **MCP isolation:** Each MCP server runs in isolated stdio context with resource limits.
- **Secrets:** No credentials stored in task files; sourced from environment or secure config.
- **Rate limits:** Configurable per-source timeout and request backoff.

### Error Code Taxonomy

All errors follow the pattern `[COMPONENT]_[CAUSE]`:

| Code | Meaning | Retry? |
|------|---------|--------|
| `SEARCH_TIMEOUT` | Search exceeded time limit | Yes (backoff) |
| `SEARCH_SOURCE_UNAVAILABLE` | Source is offline/unreachable | Yes (backoff) |
| `SEARCH_MALFORMED_QUERY` | Query syntax invalid | No |
| `READ_NOT_FOUND` | File does not exist | No |
| `READ_PERMISSION_DENIED` | Insufficient permissions | No |
| `READ_ENCODING_ERROR` | File encoding mismatch | No |
| `GATHER_NO_SOURCES` | No valid sources provided | No |
| `GATHER_TIMEOUT` | Multi-source gather exceeded limit | Yes (sample) |
| `GATHER_PARTIAL` | Some sources failed; partial results available | Yes (manual) |
| `HEALTH_CHECK_FAILED` | MCP server health check failed | Yes (backoff) |

### Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Search latency** | p50 < 1s, p99 < 5s per source |
| **Read latency** | p50 < 100ms, p99 < 500ms per file (< 10MB) |
| **Gather latency** | p50 < 3s, p99 < 10s (3 sources parallel) |
| **Memory footprint** | < 100MB base, < 500MB with full-text cache |
| **Determinism** | 100% — same request = same results (request-scoped dedup) |
| **Availability** | Graceful degradation if 1 source fails (partial results OK) |
| **Logging** | Structured JSON, all tool calls and errors logged by default |

### Configuration

**Environment variables:**
```bash
# MCP server path (default: auto-detect)
LOCAL_RESEARCHER_MCP_PATH=/path/to/mcp/server

# Logging level
LOCAL_RESEARCHER_LOG_LEVEL=debug|info|warn|error (default: info)

# Request timeout (ms)
LOCAL_RESEARCHER_REQUEST_TIMEOUT=10000

# Working directory for read() operations
LOCAL_RESEARCHER_CWD=$(pwd)
```

**Config file (`~/.local-researcher/config.json`):**
```json
{
  "mcp": {
    "timeout": 5000,
    "retries": 2
  },
  "search": {
    "sources": ["web", "local"],
    "defaultLimit": 5
  },
  "gather": {
    "strategy": "parallel",
    "dedupEnabled": true
  },
  "logging": {
    "level": "info",
    "format": "json"
  }
}
```

## Acceptance Criteria

- [ ] MCP `stdio` protocol fully implemented and tested.
- [ ] `search()`, `read()`, `gather()`, and `health()` contracts executable via CLI and library API.
- [ ] Request-scoped deduplication working with audit trail.
- [ ] All error codes from taxonomy properly raised and caught.
- [ ] Config loading from environment and file.
- [ ] Structured logging to stdout/file.
- [ ] TypeScript strict mode enabled; no `any`.
- [ ] All public APIs documented with JSDoc.
- [ ] E2E tests for each tool contract.

## v2 Future Items

- Global result caching with TTL and invalidation.
- HTTP and SSE MCP transports.
- Streaming responses for large syntheses.
- Plugin system for custom source adapters.
- Web UI for prompt composition and result exploration.
- Multi-user collaboration and result sharing.

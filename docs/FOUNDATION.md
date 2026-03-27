# FOUNDATION — System Boundaries and Contracts

## Purpose

This document defines the Local Researcher's scope, boundaries, and core contracts. It anchors all design and implementation decisions.

## System Boundary

**What We Are:**
- A local research assistant using your infrastructure
- MCP stdio server exposing search/read/gather tools
- Security-first with SSRF protection
- Configurable provider integration (SearxNG, Jina Reader)

**What We Are Not:**
- Not a general-purpose web scraper
- Not a content store or caching layer
- Not a search engine itself (we delegate)
- Not a LLM or AI model

## Core Contracts

### 1. Provider Contract

All providers must implement:

```typescript
interface Provider {
  name: string;
  isHealthy(): Promise<boolean>;
  // Provider-specific methods
}
```

**Responsibilities:**
- Network I/O with SSRF protection
- Error handling and retries (configurable)
- Health monitoring
- Response normalization

### 2. Tool Contract

All MCP tools must:

```typescript
interface Tool {
  name: string;
  description: string;
  handler(params: unknown): Promise<ToolResponse>;
}
```

**Responsibilities:**
- Input validation
- Business logic coordination
- Response formatting
- Error translation to MCP errors

### 3. Logger Contract

```typescript
interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

**Requirement:**
- All output MUST go to stderr
- MCP stdout is reserved for JSON-RPC protocol
- Structured logging (JSON preferred)

### 4. HTTP Client Contract

```typescript
interface HttpClient {
  get(url: string, options?: RequestOptions): Promise<HttpResponse>;
  post(url: string, body: unknown, options?: RequestOptions): Promise<HttpResponse>;
}
```

**Requirements:**
- SSRF protection on every request
- Configurable timeouts
- Automatic retries (with backoff)
- Request deduplication support

## Invariants

### 1. Security Invariants
- ✅ All HTTP requests are SSRF-protected
- ✅ Private/internal IPs are blocked unless explicitly allowed
- ✅ Logs go to stderr only
- ✅ No credentials in logs

### 2. Protocol Invariants
- ✅ MCP stdout is JSON-RPC only
- ✅ Tool responses are structured and typed
- ✅ Errors follow MCP error format

### 3. Operational Invariants
- ✅ Provider health is checkable
- ✅ Timeouts are bounded (no hanging requests)
- ✅ Resource limits are enforced

## Data Flow

```
MCP Client
    ↓ JSON-RPC
MCP stdio Server (index.ts)
    ↓ tool.handler()
Tool Layer (search/read/gather)
    ↓ Provider Call
Provider Layer (searxng/jinaReader)
    ↓ SSRF-protected HTTP
External Provider (SearxNG/Jina)
    ↓
Response (normalized)
```

## Decision Points

### 1. Why MCP stdio?
- Process isolation
- Language-agnostic client
- Simple deployment (single binary)
- Low latency (local IPC)

### 2. Why SearxNG + Jina Reader?
- Self-hostable SearxNG for privacy
- Jina Reader for clean text extraction
- Both HTTP-based (simple integration)
- No API keys required

### 3. Why request-scoped dedup?
- Simpler than persistent cache
- Privacy-preserving (no data retention)
- Sufficient for single-request workflows
- Can add persistent cache later

## Dependencies

### Runtime
- Node.js 18+
- TypeScript (compiled)

### External
- Your SearxNG instance (optional, public instances work)
- Your Jina Reader instance (optional, public API works)
- Internet access for fetching search results

### None of the following
- No databases
- No message queues
- No persistent storage
- No cloud services

## Non-Goals (v1)

The following are explicitly out of scope for v1:
- Persistent caching or dedup
- Web crawling beyond what providers support
- Rate limiting per user/session
- Authentication/authorization (delegated to MCP client)
- Multi-tenancy
- A/B testing or experimentation
- Metrics/observability beyond logging

## Extension Points

Future waves may add:
- Persistent dedup cache (Redis, etc.)
- Additional providers (other search engines, custom scrapers)
- Websocket-based MCP transport
- Metrics and tracing
- Rate limiting and quota management
- Content filtering or moderation

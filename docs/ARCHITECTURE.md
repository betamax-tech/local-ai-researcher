# ARCHITECTURE — Technical Design

## Overview

Local Researcher follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────┐
│           MCP Protocol Layer                │
│              (index.ts)                      │
└────────────────┬────────────────────────────┘
                 │ JSON-RPC
┌────────────────▼────────────────────────────┐
│            Tool Layer                       │
│   (search.ts, read.ts, gather.ts, health)  │
└────────────────┬────────────────────────────┘
                 │ Business Logic
┌────────────────▼────────────────────────────┐
│          Provider Layer                     │
│      (searxng.ts, jinaReader.ts)            │
└────────────────┬────────────────────────────┘
                 │ HTTP Requests
┌────────────────▼────────────────────────────┐
│            Lib Layer                        │
│  (http.ts, ssrf.ts, url.ts, logger.ts)     │
└─────────────────────────────────────────────┘
```

## Layer Responsibilities

### 1. MCP Protocol Layer (`index.ts`)

**Responsibilities:**
- Initialize MCP stdio transport
- Register tools with server
- Handle protocol-level errors
- Graceful shutdown

**What it does NOT do:**
- No business logic
- No direct HTTP requests
- No logging beyond setup errors

### 2. Tool Layer (`src/tools/`)

**Responsibilities:**
- Implement MCP tool handlers
- Validate inputs
- Orchestrate provider calls
- Format responses
- Handle tool-specific errors

**Tools:**
- `search.ts`: Query search provider, return results
- `read.ts`: Fetch URL, extract text via provider
- `gather.ts`: Search + read combined with dedup
- `health.ts`: Check provider health

### 3. Provider Layer (`src/providers/`)

**Responsibilities:**
- Abstract external providers (SearxNG, Jina Reader)
- Normalize responses to internal types
- Handle provider-specific quirks
- Health checking

**Interface:**
```typescript
interface Provider {
  name: string;
  isHealthy(): Promise<boolean>;
}
```

### 4. Lib Layer (`src/lib/`)

**Responsibilities:**
- HTTP client with SSRF protection
- URL validation and parsing
- Logging (stderr only)
- Error types and handling
- SSRF protection utilities

**No dependencies** on tool or provider layers.

## Type System

### Domain Types (`src/domain/types.ts`)

Core types shared across layers:

```typescript
// Search results
interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  source?: string;
}

// Read results
interface ReadResult {
  url: string;
  title?: string;
  content: string;
  excerpt?: string;
  wordCount?: number;
}

// Gather results
interface GatherResult {
  query: string;
  results: SearchResult[];
  reads: Map<string, ReadResult>;
  summary: {
    totalResults: number;
    successfulReads: number;
  };
}

// Configuration
interface Config {
  providers: {
    searxng: {
      endpoint: string;
      timeout: number;
      allowPrivateNetworks: boolean;
    };
    jinaReader: {
      endpoint: string;
      timeout: number;
      apiKey?: string;
    };
  };
  http: {
    timeout: number;
    maxRetries: number;
    retryDelay: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}
```

## HTTP Client Design

The HTTP client (`src/lib/http.ts`) provides:

1. **SSRF Protection** — Validates URLs before fetching
2. **Retry Logic** — Configurable retries with exponential backoff
3. **Timeouts** — Bounded request duration
4. **Request Dedup** — Optional in-memory dedup for concurrent requests

### SSRF Protection Strategy

`src/lib/ssrf.ts` implements:

- **Private IP Blocking**: Block 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x
- **Localhost Blocking**: Block localhost, 0.0.0.0, ::1
- **Metadata Services**: Block 169.254.169.254 (cloud metadata)
- **Allowlist Override**: Configurable exception list

### URL Validation Strategy

`src/lib/url.ts` implements:

- Parse and validate URL strings
- Extract hostname for SSRF checks
- Normalize URLs for deduplication
- Encode/decode helpers

## Error Handling

### Error Types (`src/lib/errors.ts`)

```typescript
class ResearcherError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ResearcherError';
    this.code = code;
    this.details = details;
  }
}

// Specific errors
class SsrfError extends ResearcherError { }
class ProviderError extends ResearcherError { }
class TimeoutError extends ResearcherError { }
class ValidationError extends ResearcherError { }
```

### Error Propagation

```
Lib Layer (HTTP/SSRF errors)
    ↓ ResearcherError
Provider Layer (ProviderError)
    ↓
Tool Layer (translate to MCP errors)
    ↓
MCP Client
```

## Logging Design

### Logger (`src/lib/logger.ts`)

- **Destination**: stderr only (stdout reserved for MCP)
- **Format**: JSON structured logging
- **Levels**: debug, info, warn, error
- **Context**: Attach request IDs or metadata where helpful

### Log Categories

1. **Request Logging**: Inbound/outbound HTTP requests
2. **Provider Logging**: Provider health, errors, latency
3. **Tool Logging**: Tool invocations, results, errors
4. **System Logging**: Startup, shutdown, config errors

### Sensitive Data

- Never log:
  - API keys (use `[REDACTED]`)
  - Full request bodies (log size or hash)
  - PII (log anonymized or `[REDACTED]`)

## MCP stdio Protocol

### Tool Registration

Tools register with the MCP server:

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search',
      description: 'Search using SearxNG',
      inputSchema: { /* JSON Schema */ }
    },
    // ... other tools
  ]
}));
```

### Tool Invocation

MCP client sends `CallToolRequest` → tool handler → `CallToolResponse`

### Error Format

MCP errors follow the JSON-RPC error format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": { "details": "..." }
  }
}
```

## Concurrency Model

### Request-Scoped

Each MCP request is independent:
- No shared state between requests
- Each request gets its own context
- Dedup is in-memory per-request (not cross-request)

### Parallelism

Tools may issue parallel HTTP requests:
- `gather()` can fetch multiple URLs concurrently
- Provider health checks can run in parallel
- All requests respect rate limits

### Thread Safety

- Node.js single-threaded event loop
- No shared mutable state across requests
- Async/await throughout

## Configuration

### Environment Loading (`src/config.ts`)

- Load from `.env` or environment
- Validate required fields
- Provide defaults where safe
- Fail fast on invalid config

### Priority

1. Environment variables (highest)
2. `.env` file
3. Hardcoded defaults (lowest)

## Testing Strategy (Planned)

### Unit Tests
- Lib layer (HTTP, SSRF, URL validation)
- Provider layer (response normalization)
- Tool layer (input validation)

### Integration Tests
- Provider contract compliance
- MCP tool registration and invocation
- End-to-end request flows

### Security Tests
- SSRF bypass attempts
- URL injection attacks
- Credential exposure checks

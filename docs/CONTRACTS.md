# CONTRACTS — Type Definitions and Interfaces

## Core Contracts

This document provides the canonical type definitions and interfaces used throughout Local Researcher.

## 1. Provider Contracts

### Base Provider Interface

```typescript
/**
 * Base interface for all external providers
 */
interface Provider {
  /** Human-readable provider name */
  name: string;

  /** Check if provider is accessible and responsive */
  isHealthy(): Promise<boolean>;
}
```

### Search Provider Interface

```typescript
/**
 * Search provider contract (implemented by SearxNG)
 */
interface SearchProvider extends Provider {
  /**
   * Execute a search query
   * @param query - Search query string
   * @param options - Optional search parameters
   * @returns Array of search results
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Get provider capabilities
   */
  getCapabilities(): SearchCapabilities;
}

interface SearchOptions {
  /** Number of results to return (default: 10, max: 50) */
  limit?: number;

  /** Search category (optional, provider-specific) */
  category?: string;

  /** Language code (optional) */
  language?: string;

  /** Time filter (e.g., 'day', 'week', 'month', 'year') */
  timeRange?: string;
}

interface SearchCapabilities {
  /** Maximum results per query */
  maxLimit: number;

  /** Supported categories */
  categories: string[];

  /** Supported time filters */
  timeFilters: string[];
}
```

### Read Provider Interface

```typescript
/**
 * Read/content extraction provider contract (implemented by Jina Reader)
 */
interface ReadProvider extends Provider {
  /**
   * Extract content from a URL
   * @param url - URL to read
   * @param options - Optional extraction parameters
   * @returns Extracted content
   */
  read(url: string, options?: ReadOptions): Promise<ReadResult>;

  /**
   * Check if URL is supported
   */
  canRead(url: string): boolean;
}

interface ReadOptions {
  /** Return full text or excerpt only (default: excerpt) */
  mode?: 'full' | 'excerpt';

  /** Target word count (for mode:excerpt) */
  targetWords?: number;

  /** Language (optional) */
  language?: string;
}
```

## 2. Tool Contracts

### Base Tool Interface

```typescript
/**
 * Base interface for MCP tools
 */
interface Tool {
  /** Tool name (must be unique) */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for input validation */
  inputSchema: Record<string, unknown>;

  /**
   * Handle tool invocation
   * @param params - Validated input parameters
   * @returns Tool response
   */
  handler(params: unknown): Promise<ToolResponse>;
}
```

### Tool Input Schemas

```typescript
/**
 * Search tool input
 */
interface SearchInput {
  query: string;
  limit?: number;
  category?: string;
}

/**
 * Read tool input
 */
interface ReadInput {
  url: string;
  mode?: 'full' | 'excerpt';
  targetWords?: number;
}

/**
 * Gather tool input
 */
interface GatherInput {
  query: string;
  maxResults?: number;
  readMode?: 'none' | 'excerpt' | 'full';
  dedup?: boolean;
}

/**
 * Health tool input
 */
interface HealthInput {
  provider?: 'searxng' | 'jinaReader' | 'all';
}
```

### Tool Output Schemas

```typescript
/**
 * Standard tool response
 */
interface ToolResponse {
  content: ToolContent[];
  isError?: boolean;
}

interface ToolContent {
  type: 'text' | 'resource';
  text?: string;
  data?: unknown;
}
```

## 3. HTTP Client Contracts

### HTTP Client Interface

```typescript
/**
 * HTTP client with SSRF protection
 */
interface HttpClient {
  /**
   * Perform GET request
   * @param url - Target URL (must pass SSRF check)
   * @param options - Request options
   * @returns HTTP response
   */
  get(url: string, options?: RequestOptions): Promise<HttpResponse>;

  /**
   * Perform POST request
   * @param url - Target URL (must pass SSRF check)
   * @param body - Request body
   * @param options - Request options
   * @returns HTTP response
   */
  post(url: string, body: unknown, options?: RequestOptions): Promise<HttpResponse>;
}

interface RequestOptions {
  /** Request timeout in milliseconds (default: from config) */
  timeout?: number;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Enable/disable retries (default: true) */
  retry?: boolean;

  /** Max retry attempts (default: from config) */
  maxRetries?: number;

  /** Request ID for tracing (optional) */
  requestId?: string;
}

interface HttpResponse {
  /** HTTP status code */
  status: number;

  /** Response headers */
  headers: Record<string, string>;

  /** Response body (parsed as JSON if possible) */
  body: unknown;

  /** Raw text body */
  text: string;

  /** Request duration in milliseconds */
  duration: number;
}
```

## 4. Logger Contracts

### Logger Interface

```typescript
/**
 * Logger interface (all output goes to stderr)
 */
interface Logger {
  /**
   * Log debug message
   */
  debug(message: string, meta?: LogMeta): void;

  /**
   * Log info message
   */
  info(message: string, meta?: LogMeta): void;

  /**
   * Log warning message
   */
  warn(message: string, meta?: LogMeta): void;

  /**
   * Log error message
   */
  error(message: string, meta?: LogMeta): void;
}

interface LogMeta {
  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /** Request ID (for correlation) */
  requestId?: string;

  /** Component/module name */
  component?: string;

  /** Additional context */
  [key: string]: unknown;
}
```

## 5. Error Contracts

### Error Types

```typescript
/**
 * Base error class for Local Researcher
 */
class ResearcherError extends Error {
  /** Error code for client handling */
  code: string;

  /** Additional error context */
  details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ResearcherError';
    this.code = code;
    this.details = details;
  }
}

/**
 * SSRF protection error
 */
class SsrfError extends ResearcherError {
  constructor(message: string, url: string, reason: string) {
    super(message, 'SSRF_BLOCKED', { url, reason });
    this.name = 'SsrfError';
  }
}

/**
 * Provider error (timeout, unavailable, etc.)
 */
class ProviderError extends ResearcherError {
  constructor(message: string, provider: string, details?: Record<string, unknown>) {
    super(message, 'PROVIDER_ERROR', { provider, ...details });
    this.name = 'ProviderError';
  }
}

/**
 * Request timeout error
 */
class TimeoutError extends ResearcherError {
  constructor(message: string, operation: string, timeout: number) {
    super(message, 'TIMEOUT', { operation, timeout });
    this.name = 'TimeoutError';
  }
}

/**
 * Input validation error
 */
class ValidationError extends ResearcherError {
  constructor(message: string, field?: string, value?: unknown) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
  }
}
```

## 6. Domain Types

### Result Types

```typescript
/**
 * Search result
 */
interface SearchResult {
  /** Result URL */
  url: string;

  /** Page title */
  title: string;

  /** Content snippet/preview */
  snippet: string;

  /** Source engine/category */
  source?: string;

  /** Publish date (if available) */
  date?: string;

  /** relevance score (if available) */
  score?: number;
}

/**
 * Read/result extraction result
 */
interface ReadResult {
  /** Original URL */
  url: string;

  /** Page title */
  title?: string;

  /** Extracted content */
  content: string;

  /** Content excerpt (if mode:excerpt) */
  excerpt?: string;

  /** Word count */
  wordCount?: number;

  /** Extraction duration (ms) */
  duration?: number;
}

/**
 * Gather/combined result
 */
interface GatherResult {
  /** Original search query */
  query: string;

  /** Search results */
  results: SearchResult[];

  /** Map of URL -> read result */
  reads: Map<string, ReadResult>;

  /** Summary statistics */
  summary: {
    totalResults: number;
    attemptedReads: number;
    successfulReads: number;
    failedReads: number;
    totalDuration: number;
  };
}
```

### Configuration Types

```typescript
/**
 * Application configuration
 */
interface Config {
  /** Provider configurations */
  providers: {
    searxng: SearxngConfig;
    jinaReader: JinaReaderConfig;
  };

  /** HTTP client configuration */
  http: HttpConfig;

  /** Logging configuration */
  logging: LoggingConfig;
}

interface SearxngConfig {
  /** SearxNG instance endpoint */
  endpoint: string;

  /** Request timeout (ms) */
  timeout: number;

  /** Allow requests to private networks */
  allowPrivateNetworks: boolean;

  /** API key (if required) */
  apiKey?: string;
}

interface JinaReaderConfig {
  /** Jina Reader endpoint */
  endpoint: string;

  /** Request timeout (ms) */
  timeout: number;

  /** API key (if required) */
  apiKey?: string;
}

interface HttpConfig {
  /** Default timeout (ms) */
  timeout: number;

  /** Max retry attempts */
  maxRetries: number;

  /** Initial retry delay (ms) */
  retryDelay: number;

  /** Maximum retry delay (ms) */
  maxRetryDelay: number;

  /** SSRF allowed networks */
  ssrfAllowedNetworks: string[];
}

interface LoggingConfig {
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** Enable JSON formatting */
  json: boolean;

  /** Include timestamps */
  timestamp: boolean;
}
```

## 7. MCP Protocol Types

### Request/Response Types

```typescript
/**
 * List tools request (MCP)
 */
interface ListToolsRequest {
  method: 'tools/list';
}

/**
 * List tools response (MCP)
 */
interface ListToolsResponse {
  tools: ToolDefinition[];
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Call tool request (MCP)
 */
interface CallToolRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * Call tool response (MCP)
 */
interface CallToolResponse {
  content: ToolContent[];
  isError?: boolean;
}
```

## Implementation Notes

### Type Safety
- All interfaces use TypeScript strict mode
- `unknown` used for unvalidated external data
- `never` used for unreachable code paths

### Validation
- Tool inputs validated against JSON Schema
- URLs validated before HTTP requests
- Config validated on startup

### Error Handling
- All errors extend `ResearcherError`
- Error codes are machine-readable strings
- `details` field provides structured context

### Concurrency
- All I/O operations are async
- No shared mutable state
- Request-scoped data only

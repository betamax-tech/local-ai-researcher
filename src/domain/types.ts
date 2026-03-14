/**
 * Domain types for Local Researcher — locked v1 contract.
 *
 * Design principles:
 * - AI-first: all output shapes are normalized for LLM/tool consumption.
 * - Stable contract: field names and required fields are locked for v1.
 * - Provider-agnostic: no provider-specific fields leak into domain types.
 * - schema_version on every envelope to enable forward-compatible clients.
 */

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

/** Current locked schema version for all tool response envelopes */
export const SCHEMA_VERSION = '1' as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Source type for search / gather operations */
export type SourceType = 'web' | 'local' | 'custom';

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Single search result — locked v1 contract.
 * `id` is a deterministic hash of source + query + offset (dedup key).
 * `excerpt` is always returned (30 lines or full if fullText requested).
 */
export interface SearchResult {
  /** Deterministic hash: source + canonical URL + position offset */
  id: string;

  /** Result URL (canonical form) */
  url: string;

  /** Page title */
  title: string;

  /**
   * Content excerpt — 30-line default per locked v1.
   * Full text only when `fullText: true` requested.
   */
  excerpt: string;

  /** Source type */
  source: SourceType;

  /** Relevance score 0–1 (if available from provider) */
  relevance?: number;

  /** Publish date ISO string (if available) */
  date?: string;

  /** Raw engine / category from provider (internal, not AI-facing) */
  _engine?: string;
}

/** Options for search() tool */
export interface SearchOptions {
  /** Source types to query (default: ['web']) */
  sources?: SourceType[];

  /** Max results (default: 5 per locked PRD) */
  limit?: number;

  /** Return full text instead of 30-line excerpt (default: false) */
  fullText?: boolean;

  /** Per-source timeout ms (default: 5000) */
  timeout?: number;

  /** Search category passed to provider (optional) */
  category?: string;

  /** Language code (optional) */
  language?: string;

  /** Time range filter (optional) */
  timeRange?: string;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * URL content extraction result — locked v1 contract.
 * Excerpt-first model: `excerpt` is always set; `content` is full text opt-in.
 */
export interface ReadResult {
  /** Source URL */
  url: string;

  /** Page title (from provider) */
  title?: string;

  /**
   * Excerpt: first 30 lines by default.
   * Full-text is in `content` when fullText opt-in is used.
   */
  excerpt: string;

  /** Full text content — only populated when fullText: true requested */
  content?: string;

  /** Approximate word count */
  wordCount?: number;

  /** Extraction duration ms */
  duration?: number;
}

/** Options for read() tool */
export interface ReadOptions {
  /** Return full text instead of 30-line excerpt (default: false) */
  fullText?: boolean;

  /** Target word count for excerpt trimming */
  targetWords?: number;

  /** Language hint (optional) */
  language?: string;
}

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------

/**
 * Deduplication statistics for a gather() call.
 */
export interface DedupStats {
  /** Total URLs considered before dedup */
  total: number;

  /** URLs deduplicated (skipped as duplicates) */
  deduped: number;
}

/**
 * Source descriptor for gather() inputs.
 */
export interface GatherSource {
  /** Source type */
  type: SourceType;

  /** URL, file path, or custom identifier */
  target: string;
}

/**
 * Combined result from gather() — locked v1 contract.
 * This is the primary AI-facing research envelope.
 */
export interface GatherResult {
  /** Request-scoped unique ID */
  id: string;

  /** Original search query / prompt */
  prompt: string;

  /** Gathered context */
  context: {
    sources: GatherSource[];
    results: SearchResult[];
    reads: ReadResult[];
    dedupStats: DedupStats;
  };

  /** Formatted context block ready for LLM insertion */
  synthesis: string;

  /** Performance summary */
  summary: {
    totalResults: number;
    attemptedReads: number;
    successfulReads: number;
    failedReads: number;
    totalDuration: number;
  };
}

/** Options for gather() tool */
export interface GatherOptions {
  /** Enable request-scoped dedup (default: true) */
  dedup?: boolean;

  /** Total gather timeout ms (default: 10000) */
  timeout?: number;

  /** Approximate max tokens for synthesis sampling */
  maxTokens?: number;

  /** Execution strategy (default: parallel) */
  strategy?: 'parallel' | 'sequential';

  /** Max results to search for (default: 5) */
  maxResults?: number;

  /** Return full text for reads (default: false, excerpt-first) */
  fullText?: boolean;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** MCP provider health entry */
export interface ProviderHealthEntry {
  name: string;
  status: 'connected' | 'error';
  error?: string;
}

/** Health check result — locked v1 contract */
export interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  mcp: {
    stdio: { ready: boolean; version: string };
    servers: ProviderHealthEntry[];
  };
  resources: {
    memoryMB: number;
    cwd: string;
  };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// MCP tool response envelope
// ---------------------------------------------------------------------------

/**
 * Normalized MCP tool response envelope — AI-first contract.
 * All tool responses are wrapped in this before serialization.
 */
export interface ToolResponseEnvelope<T> {
  /** Locked schema version — clients should check this */
  schema_version: SchemaVersion;

  /** Whether this response represents an error state */
  ok: boolean;

  /** Result payload (present when ok: true) */
  result?: T;

  /** Error payload (present when ok: false) */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** SearxNG provider configuration */
export interface SearxngConfig {
  /** SearxNG instance endpoint (must be a valid URL) */
  endpoint: string;

  /** Request timeout ms (default: 10000 per locked PRD) */
  timeout: number;

  /** Allow requests to private networks (default: false) */
  allowPrivateNetworks: boolean;

  /** API key (if required by instance) */
  apiKey?: string;
}

/** Jina Reader provider configuration */
export interface JinaReaderConfig {
  /**
   * Jina Reader base endpoint.
   * Default: `https://r.jina.ai/` (locked v1 — no http:// suffix in default)
   */
  endpoint: string;

  /** Request timeout ms (default: 15000) */
  timeout: number;

  /** API key (if required) */
  apiKey?: string;
}

/** HTTP client configuration */
export interface HttpConfig {
  /** Default request timeout ms */
  timeout: number;

  /** Max retry attempts */
  maxRetries: number;

  /** Initial retry delay ms */
  retryDelay: number;

  /** Maximum retry delay ms */
  maxRetryDelay: number;

  /** SSRF allowlist (CIDR notation, e.g. for local SearxNG) */
  ssrfAllowedNetworks: string[];
}

/** Logging configuration */
export interface LoggingConfig {
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** JSON formatting (must be true in production — MCP stdio uses stdout for protocol) */
  json: boolean;

  /** Include ISO timestamps */
  timestamp: boolean;
}

/** Search sub-config */
export interface SearchConfig {
  /** Default result limit (locked v1: 5) */
  defaultLimit: number;

  /** Default source types */
  sources: SourceType[];
}

/** Gather sub-config */
export interface GatherConfig {
  /** Default execution strategy */
  strategy: 'parallel' | 'sequential';

  /** Request-scoped dedup enabled by default */
  dedupEnabled: boolean;

  /** Default gather timeout ms */
  timeout: number;
}

/** MCP sub-config */
export interface McpConfig {
  /** Per-call timeout ms */
  timeout: number;

  /** Default retry count */
  retries: number;
}

/**
 * Full application configuration — locked v1 shape.
 */
export interface Config {
  /** Provider configurations */
  providers: {
    searxng: SearxngConfig;
    jinaReader: JinaReaderConfig;
  };

  /** HTTP client configuration */
  http: HttpConfig;

  /** Logging configuration */
  logging: LoggingConfig;

  /** Search defaults */
  search: SearchConfig;

  /** Gather defaults */
  gather: GatherConfig;

  /** MCP defaults */
  mcp: McpConfig;
}

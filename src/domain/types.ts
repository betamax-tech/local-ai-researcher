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
// Response Metadata (locked v1 contract)
// ---------------------------------------------------------------------------

/**
 * Response metadata — locked v1 contract.
 * Present on all tool responses (success and failure) for traceability.
 */
export interface ResponseMeta {
  /** Unique request identifier (UUID v4) */
  request_id: string;

  /** ISO-8601 timestamp of response generation */
  timestamp: string;

  /** Provider identifier (e.g., 'searxng', 'jina-reader', 'orchestrator') */
  provider_id: string;

  /** Human-readable provider name */
  provider_name: string;

  /** Limits applied to this request */
  applied_limits: {
    /** Request timeout in milliseconds */
    timeout_ms?: number;

    /** Maximum bytes in response */
    max_bytes?: number;

    /** Maximum number of results */
    max_results?: number;

    /** Maximum concurrent read operations (gather only) */
    max_concurrent_reads?: number;
  };
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Source type for search / gather operations */
export type SourceType = 'web' | 'local' | 'custom';

/** Content mode for read operations */
export type ContentMode = 'full' | 'excerpt';

/** Content truncation metadata — present only when content was truncated */
export interface ContentTruncation {
  /** The limit that was applied (bytes, chars, or lines depending on context) */
  applied_limit: number;

  /** Why truncation occurred */
  reason: 'max_bytes' | 'explicit_excerpt' | 'provider_limit';
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Single search result — locked v1 contract.
 * `id` is a deterministic hash of source + query + offset (dedup key).
 * `excerpt` contains the content preview.
 */
export interface SearchResult {
  /** Deterministic hash: source + canonical URL + position offset */
  id: string;

  /** Result URL (canonical form) */
  url: string;

  /** Page title */
  title: string;

  /**
   * Content excerpt/preview.
   * Full text only when `content_mode: 'full'` is requested.
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

  /** Content mode: 'full' for full text, 'excerpt' for preview (default: 'full') */
  content_mode?: ContentMode;

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
 * Full-content model: `content` is populated by default; truncation is explicit.
 */
export interface ReadResult {
  /** Source URL */
  url: string;

  /** Page title (from provider) */
  title?: string;

  /**
   * Content excerpt/preview.
   * When `content_mode: 'full'`, this may be identical to `content`.
   */
  excerpt: string;

  /** Full text content — populated by default; may be truncated if limits hit */
  content?: string;

  /** Content mode used for this result */
  content_mode: ContentMode;

  /** Whether the content was truncated */
  content_truncated: boolean;

  /** Truncation details — only present when content_truncated is true */
  truncation?: ContentTruncation;

  /** Approximate word count */
  wordCount?: number;

  /** Extraction duration ms */
  duration?: number;
}

/** Options for read() tool */
export interface ReadOptions {
  /** Content mode: 'full' for full content, 'excerpt' for preview (default: 'full') */
  content_mode?: ContentMode;

  /** Target word count for excerpt trimming (only used when content_mode: 'excerpt') */
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

  /** Content mode for reads: 'full' for full content, 'excerpt' for preview (default: 'full') */
  content_mode?: ContentMode;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** MCP provider health entry */
export interface ProviderHealthEntry {
  name: string;
  /** Provider connectivity status */
  status: 'connected' | 'degraded' | 'unavailable' | 'error';
  /** Round-trip latency in milliseconds (present when a real probe was made) */
  latency_ms?: number;
  /** Human-readable error description */
  error?: string;
  /** Locked v1 error code from taxonomy (e.g., ERR_SSRF_BLOCKED) */
  error_code?: string;
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

  /** Response metadata for traceability — present on all responses */
  meta: ResponseMeta;

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

/** Content policy sub-config */
export interface ContentPolicyConfig {
  /** Default content mode: 'full' or 'excerpt' (default: 'full') */
  defaultMode: ContentMode;
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

  /** Content policy defaults */
  contentPolicy: ContentPolicyConfig;

  /** MCP defaults */
  mcp: McpConfig;
}

// ---------------------------------------------------------------------------
// Runtime type guards (locked v1 contract)
// ---------------------------------------------------------------------------

/**
 * Runtime type guard for ResponseMeta.
 * Validates all required fields for traceability.
 */
export function isResponseMeta(v: unknown): v is ResponseMeta {
  if (typeof v !== 'object' || v === null) return false;
  const meta = v as Record<string, unknown>;
  return (
    typeof meta.request_id === 'string' &&
    typeof meta.timestamp === 'string' &&
    typeof meta.provider_id === 'string' &&
    typeof meta.provider_name === 'string' &&
    typeof meta.applied_limits === 'object' &&
    meta.applied_limits !== null
  );
}

/**
 * Runtime type guard for SearchResult.
 * Validates the locked v1 search result shape.
 */
export function isSearchResult(v: unknown): v is SearchResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.url === 'string' &&
    typeof r.title === 'string' &&
    typeof r.excerpt === 'string' &&
    (r.source === 'web' || r.source === 'local' || r.source === 'custom')
  );
}

/**
 * Runtime type guard for ReadResult.
 * Validates the locked v1 read result shape including content_mode.
 */
export function isReadResult(v: unknown): v is ReadResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.url === 'string' &&
    typeof r.excerpt === 'string' &&
    (r.content_mode === 'full' || r.content_mode === 'excerpt') &&
    typeof r.content_truncated === 'boolean'
  );
}

/**
 * Runtime type guard for ToolResponseEnvelope<T>.
 * Validates the locked v1 envelope structure.
 */
export function isToolResponseEnvelope<T>(
  v: unknown,
  resultGuard?: (r: unknown) => r is T
): v is ToolResponseEnvelope<T> {
  if (typeof v !== 'object' || v === null) return false;
  const env = v as Record<string, unknown>;
  
  // schema_version must be '1'
  if (env.schema_version !== '1') return false;
  
  // ok must be boolean
  if (typeof env.ok !== 'boolean') return false;
  
  // meta must be valid
  if (!isResponseMeta(env.meta)) return false;
  
  if (env.ok) {
    // Success envelope: result must be present, error must be absent
    if (env.result === undefined) return false;
    if (env.error !== undefined) return false;
    // If a result guard is provided, validate the result
    if (resultGuard && !resultGuard(env.result)) return false;
  } else {
    // Failure envelope: error must be present, result must be absent
    if (env.result !== undefined) return false;
    if (typeof env.error !== 'object' || env.error === null) return false;
    const err = env.error as Record<string, unknown>;
    if (typeof err.code !== 'string' || typeof err.message !== 'string' || typeof err.retryable !== 'boolean') {
      return false;
    }
  }
  
  return true;
}

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

  /** Whether this response was served from cache */
  cache_hit?: boolean;

  /** Cache key for this response (when cache is enabled) */
  cache_key?: string;

  /**
   * Cache status for this request — observability for troubleshooting.
   * 'hit'      — cache enabled, bypass_cache false, entry found and valid
   * 'miss'     — cache enabled, bypass_cache false, no entry found
   * 'bypass'   — cache enabled, bypass_cache true (lookup skipped)
   * 'disabled' — cache not enabled in config or no cache injected
   */
  cache_status?: 'hit' | 'miss' | 'bypass' | 'disabled';
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Source type for search / gather operations */
export type SourceType = 'web' | 'local' | 'custom';

/** Content mode for read operations */
export type ContentMode = 'full' | 'excerpt';

/** Extraction strategy for structured/dynamic reads */
export type ExtractMode = 'auto' | 'static' | 'dynamic' | 'stealth';

/** Optional-provider enablement mode for Docker-backed runtimes */
export type OptionalProviderMode = 'disabled' | 'auto' | 'required';

/** AI-facing scrape entity hint */
export type ScrapeEntityType = 'generic' | 'product' | 'job' | 'company' | 'event' | 'property';

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

  /** Internal provider hint to force specific SearXNG engines for this search */
  forcedEngines?: string[];
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

  /** Quality signal: true if extracted content is too short for meaningful use (<20 words) */
  degraded?: boolean;

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
// Extract
// ---------------------------------------------------------------------------

/** Structured fragment extracted from a page */
export interface ExtractSection {
  /** Human-readable section label */
  label: string;

  /** Extracted text for this section */
  text: string;
}

/** Structured record extracted from repeated page elements */
export interface ExtractRecord {
  /** Zero-based position in the extracted list */
  index: number;

  /** Primary text content for the record */
  text: string;

  /** Selected attributes when available */
  attributes?: Record<string, string>;
}

/** Targeted/structured extraction result for AI consumption */
export interface ExtractResult {
  /** Source URL */
  url: string;

  /** Page title (from provider) */
  title?: string;

  /** Extraction mode requested by caller */
  mode_requested: ExtractMode;

  /** Extraction mode actually used */
  mode_used: 'static' | 'dynamic' | 'stealth';

  /** Optional selector that scoped extraction */
  selector?: string;

  /** Optional natural-language extraction goal */
  goal?: string;

  /** Human-readable excerpt of the extracted result */
  excerpt: string;

  /** Full extracted text when content_mode is full */
  content?: string;

  /** Content mode used for this result */
  content_mode: ContentMode;

  /** Whether the extracted content was truncated */
  content_truncated: boolean;

  /** Truncation details — only present when content_truncated is true */
  truncation?: ContentTruncation;

  /** High-signal extracted sections */
  sections: ExtractSection[];

  /** Repeated extracted records when a selector or repeated structure is used */
  records: ExtractRecord[];

  /** Approximate word count of the extracted content */
  wordCount?: number;

  /** Quality signal: true if extracted content is too short for meaningful use */
  degraded?: boolean;

  /** Extraction duration ms */
  duration?: number;
}

/** Options for extract() tool */
/**
 * Per-request authentication / egress options shared by all fetch-backed
 * scraping surfaces. Lets a caller fetch behind sign-in walls (cookies/headers)
 * and control egress IP (proxy, or `direct` to pin to the sidecar's own IP).
 */
export interface FetchAuthOptions {
  /**
   * Session cookies to attach to the fetch. Accepts a `{ name: value }` map,
   * a raw `"k=v; k2=v2"` Cookie-header string, or a list of cookie objects
   * (`{ name, value, domain? }`). Used to fetch pages behind a login.
   */
  cookies?: Record<string, string> | string | Array<Record<string, unknown>>;

  /** Extra request headers (e.g. a custom User-Agent or Referer). */
  headers?: Record<string, string>;

  /**
   * Egress proxy URL (e.g. `http://host:port`). When omitted, the fetch uses
   * the sidecar's direct network egress. Mutually exclusive with `direct`.
   */
  proxy?: string;

  /**
   * Force direct egress (no proxy) even if a default proxy is configured.
   * Pin cookie'd traffic to a single consistent IP to avoid same-session
   * multi-IP fraud flags. When true, any `proxy` value is ignored.
   */
  direct?: boolean;
}

export interface ExtractOptions extends FetchAuthOptions {
  /** Extraction mode: auto tries static first then dynamic when needed */
  mode?: ExtractMode;

  /** Optional CSS selector to scope extraction */
  selector?: string;

  /** Optional natural-language extraction goal */
  goal?: string;

  /** Content mode: 'full' for full content, 'excerpt' for preview (default: 'full') */
  content_mode?: ContentMode;

  /** Target word count for excerpt trimming (only used when content_mode: 'excerpt') */
  targetWords?: number;

  /** Maximum number of repeated records to return */
  maxRecords?: number;
}

// ---------------------------------------------------------------------------
// AI-oriented scraping surface
// ---------------------------------------------------------------------------

/** Structured record for listing/detail scraping workflows */
export interface ScrapeRecord {
  index: number;
  title?: string;
  url?: string;
  text: string;
  attributes?: Record<string, string>;
  field_candidates?: Record<string, string>;
}

/** Known-page scraping result */
export interface ScrapePageResult {
  url: string;
  title?: string;
  entity_type: ScrapeEntityType;
  goal?: string;
  fields_requested: string[];
  mode_used: 'static' | 'dynamic' | 'stealth';
  excerpt: string;
  content?: string;
  content_mode: ContentMode;
  content_truncated: boolean;
  truncation?: ContentTruncation;
  sections: ExtractSection[];
  records: ScrapeRecord[];
  field_candidates?: Record<string, string>;
  wordCount?: number;
  degraded?: boolean;
  duration?: number;
}

/** Known-page scraping options */
export interface ScrapePageOptions extends FetchAuthOptions {
  entity_type?: ScrapeEntityType;
  fields?: string[];
  goal?: string;
  selector?: string;
  mode?: ExtractMode;
  content_mode?: ContentMode;
  targetWords?: number;
  maxRecords?: number;
}

/** Listing-page scraping result */
export interface ScrapeListingResult {
  url: string;
  entity_type: ScrapeEntityType;
  goal?: string;
  fields_requested: string[];
  item_selector?: string;
  records: ScrapeRecord[];
  item_count: number;
  mode_used: 'static' | 'dynamic' | 'stealth';
  duration?: number;
}

/** Listing-page scraping options */
export interface ScrapeListingOptions extends FetchAuthOptions {
  entity_type?: ScrapeEntityType;
  fields?: string[];
  goal?: string;
  item_selector?: string;
  mode?: ExtractMode;
  maxItems?: number;
}

/** Multi-page scraping result */
export interface ScrapeManyResult {
  entity_type: ScrapeEntityType;
  goal?: string;
  fields_requested: string[];
  results: ScrapePageResult[];
  failures: Array<{ url: string; error: string }>;
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
    totalDuration: number;
  };
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
    /** Number of reads flagged as degraded (wordCount < 20) — not included in successfulReads */
    degradedReads: number;
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
  /** Stable provider identifier */
  provider_id?: string;
  /** Retrieval lane served by this provider */
  lane?: 'discovery' | 'read' | 'extract' | 'crawl';
  /** Round-trip latency in milliseconds (present when a real probe was made) */
  latency_ms?: number;
  /** Human-readable error description */
  error?: string;
  /** Locked v1 error code from taxonomy (e.g., ERR_SSRF_BLOCKED) */
  error_code?: string;
  /** Whether the provider is optional in the current stack */
  optional?: boolean;
  /** Provider version expected by the local manifest */
  expected_version?: string;
  /** Provider version detected at runtime */
  detected_version?: string;
  /** Runtime details useful for operator diagnostics */
  runtime?: string;
}

/** Health check result — locked v1 contract */
export interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  mcp: {
    stdio: { ready: boolean; version: string };
    servers: ProviderHealthEntry[];
  };
  provider_governance?: {
    manifest_loaded: boolean;
    manifest_path?: string;
    tracked_providers: number;
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

/** Scrapling provider configuration */
export interface ScraplingConfig {
  /** Whether the Scrapling extraction lane is disabled, auto-detected, or required */
  enabled: OptionalProviderMode;

  /** HTTP endpoint for the Scrapling sidecar */
  endpoint: string;

  /** Whether startup scripts should attempt Docker bootstrap for Scrapling */
  bootstrapWithDocker: boolean;

  /** Extraction timeout ms */
  timeout: number;

  /** Allow requests to private networks (default: false) */
  allowPrivateNetworks: boolean;

  /** Default extraction mode */
  defaultMode: ExtractMode;

  /**
   * Default egress proxy for Scrapling fetches (empty = direct). Per-request
   * `direct: true` overrides this to force direct egress.
   */
  defaultProxy?: string;
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

/** Cache sub-config */
export interface CacheConfig {
  /** Cache enabled (default: false) */
  enabled: boolean;

  /** Cache database path (default: ./cache.db) */
  path: string;

  /** Cache TTL in seconds (default: 3600 = 1 hour) */
  ttl: number;
}

/**
 * Full application configuration — locked v1 shape.
 */
export interface Config {
  /** Provider configurations */
  providers: {
    searxng: SearxngConfig;
    jinaReader: JinaReaderConfig;
    scrapling: ScraplingConfig;
    /** Optional chained fallback SearXNG instances — empty or absent means chain disabled */
    searxngFallbacks?: SearxngConfig[];
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

  /** Cache configuration */
  cache: CacheConfig;
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

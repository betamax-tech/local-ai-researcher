/**
 * Error type definitions for Local Researcher
 *
 * Error code taxonomy follows the locked v1 PRD pattern [COMPONENT]_[CAUSE].
 * All codes are prefixed with ERR_ for namespacing clarity.
 */

// ---------------------------------------------------------------------------
// Error code constants (locked v1 taxonomy)
// ---------------------------------------------------------------------------

/**
 * Locked v1 error codes.
 * Consumers should switch on these string literals — never on error class names.
 */
export const ErrorCode = {
  // SearxNG provider errors
  ERR_SEARXNG_TIMEOUT: 'ERR_SEARXNG_TIMEOUT',
  ERR_SEARXNG_UNAVAILABLE: 'ERR_SEARXNG_UNAVAILABLE',
  ERR_SEARXNG_INVALID_RESPONSE: 'ERR_SEARXNG_INVALID_RESPONSE',

  // Jina Reader provider errors
  ERR_READER_TIMEOUT: 'ERR_READER_TIMEOUT',
  ERR_READER_UNAVAILABLE: 'ERR_READER_UNAVAILABLE',
  ERR_READER_INVALID_RESPONSE: 'ERR_READER_INVALID_RESPONSE',

  // SSRF protection
  ERR_SSRF_BLOCKED: 'ERR_SSRF_BLOCKED',

  // Engine / search validation
  ERR_INVALID_ENGINES: 'ERR_INVALID_ENGINES',
  ERR_SEARCH_MALFORMED_QUERY: 'ERR_SEARCH_MALFORMED_QUERY',
  ERR_SEARCH_SOURCE_UNAVAILABLE: 'ERR_SEARCH_SOURCE_UNAVAILABLE',
  ERR_SEARCH_TIMEOUT: 'ERR_SEARCH_TIMEOUT',

  // Read tool errors
  ERR_READ_NOT_FOUND: 'ERR_READ_NOT_FOUND',
  ERR_READ_PERMISSION_DENIED: 'ERR_READ_PERMISSION_DENIED',
  ERR_READ_ENCODING_ERROR: 'ERR_READ_ENCODING_ERROR',

  // Gather tool errors
  ERR_GATHER_NO_SOURCES: 'ERR_GATHER_NO_SOURCES',
  ERR_GATHER_TIMEOUT: 'ERR_GATHER_TIMEOUT',
  ERR_GATHER_PARTIAL: 'ERR_GATHER_PARTIAL',

  // Health check errors
  ERR_HEALTH_CHECK_FAILED: 'ERR_HEALTH_CHECK_FAILED',

  // General validation / config
  ERR_VALIDATION: 'ERR_VALIDATION',
  ERR_CONFIG: 'ERR_CONFIG',

  // Provider selection errors
  ERR_PROVIDER_UNAVAILABLE: 'ERR_PROVIDER_UNAVAILABLE',
} as const;

/** Union of all locked error codes */
export type ErrorCodeKey = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Base error class
// ---------------------------------------------------------------------------

/**
 * Base error class for Local Researcher.
 * All domain errors extend this so callers can `instanceof ResearcherError`.
 */
export class ResearcherError extends Error {
  /** Locked v1 error code — switch on this, not class name */
  readonly code: ErrorCodeKey;

  /** Whether the operation is retryable per PRD taxonomy */
  readonly retryable: boolean;

  /** Additional structured context for logging / AI consumption */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCodeKey,
    options?: { retryable?: boolean; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'ResearcherError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
    // Ensure proper prototype chain for `instanceof` checks in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// SSRF
// ---------------------------------------------------------------------------

/**
 * Thrown when a request is blocked by SSRF protection.
 * Code: ERR_SSRF_BLOCKED — not retryable.
 */
export class SsrfError extends ResearcherError {
  constructor(message: string, url: string, reason: string) {
    super(message, ErrorCode.ERR_SSRF_BLOCKED, {
      retryable: false,
      details: { url, reason },
    });
    this.name = 'SsrfError';
  }
}

// ---------------------------------------------------------------------------
// Provider errors (SearxNG)
// ---------------------------------------------------------------------------

/**
 * SearxNG timed out.
 * Code: ERR_SEARXNG_TIMEOUT — retryable with backoff.
 */
export class SearxngTimeoutError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_SEARXNG_TIMEOUT, { retryable: true, details });
    this.name = 'SearxngTimeoutError';
  }
}

/**
 * SearxNG is offline or unreachable.
 * Code: ERR_SEARXNG_UNAVAILABLE — retryable with backoff.
 */
export class SearxngUnavailableError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_SEARXNG_UNAVAILABLE, { retryable: true, details });
    this.name = 'SearxngUnavailableError';
  }
}

/**
 * SearxNG returned an unparseable or unexpected response.
 * Code: ERR_SEARXNG_INVALID_RESPONSE — not retryable.
 */
export class SearxngInvalidResponseError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_SEARXNG_INVALID_RESPONSE, { retryable: false, details });
    this.name = 'SearxngInvalidResponseError';
  }
}

// ---------------------------------------------------------------------------
// Provider errors (Jina Reader)
// ---------------------------------------------------------------------------

/**
 * Jina Reader timed out.
 * Code: ERR_READER_TIMEOUT — retryable with backoff.
 */
export class ReaderTimeoutError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_READER_TIMEOUT, { retryable: true, details });
    this.name = 'ReaderTimeoutError';
  }
}

/**
 * Jina Reader is offline or unreachable.
 * Code: ERR_READER_UNAVAILABLE — retryable with backoff.
 */
export class ReaderUnavailableError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_READER_UNAVAILABLE, { retryable: true, details });
    this.name = 'ReaderUnavailableError';
  }
}

/**
 * Jina Reader returned an unparseable response.
 * Code: ERR_READER_INVALID_RESPONSE — not retryable.
 */
export class ReaderInvalidResponseError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_READER_INVALID_RESPONSE, { retryable: false, details });
    this.name = 'ReaderInvalidResponseError';
  }
}

// ---------------------------------------------------------------------------
// Search tool errors
// ---------------------------------------------------------------------------

/**
 * Search exceeded time limit.
 * Code: ERR_SEARCH_TIMEOUT — retryable with backoff.
 */
export class SearchTimeoutError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_SEARCH_TIMEOUT, { retryable: true, details });
    this.name = 'SearchTimeoutError';
  }
}

/**
 * Search source is offline or unreachable.
 * Code: ERR_SEARCH_SOURCE_UNAVAILABLE — retryable with backoff.
 */
export class SearchSourceUnavailableError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_SEARCH_SOURCE_UNAVAILABLE, { retryable: true, details });
    this.name = 'SearchSourceUnavailableError';
  }
}

/**
 * Query syntax invalid.
 * Code: ERR_SEARCH_MALFORMED_QUERY — not retryable.
 */
export class SearchMalformedQueryError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_SEARCH_MALFORMED_QUERY, { retryable: false, details });
    this.name = 'SearchMalformedQueryError';
  }
}

/**
 * Invalid search engine(s) specified.
 * Code: ERR_INVALID_ENGINES — not retryable.
 */
export class InvalidEnginesError extends ResearcherError {
  constructor(message: string, engines?: string[]) {
    super(message, ErrorCode.ERR_INVALID_ENGINES, {
      retryable: false,
      details: engines ? { engines } : undefined,
    });
    this.name = 'InvalidEnginesError';
  }
}

// ---------------------------------------------------------------------------
// Gather tool errors
// ---------------------------------------------------------------------------

/**
 * No valid sources provided to gather().
 * Code: ERR_GATHER_NO_SOURCES — not retryable.
 */
export class GatherNoSourcesError extends ResearcherError {
  constructor(message: string) {
    super(message, ErrorCode.ERR_GATHER_NO_SOURCES, { retryable: false });
    this.name = 'GatherNoSourcesError';
  }
}

/**
 * Multi-source gather exceeded timeout.
 * Code: ERR_GATHER_TIMEOUT — retryable by sampling fewer sources.
 */
export class GatherTimeoutError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_GATHER_TIMEOUT, { retryable: true, details });
    this.name = 'GatherTimeoutError';
  }
}

/**
 * Some sources failed; partial results are available.
 * Code: ERR_GATHER_PARTIAL — retryable manually.
 */
export class GatherPartialError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_GATHER_PARTIAL, { retryable: true, details });
    this.name = 'GatherPartialError';
  }
}

// ---------------------------------------------------------------------------
// Read tool errors
// ---------------------------------------------------------------------------

/**
 * File does not exist.
 * Code: ERR_READ_NOT_FOUND — not retryable.
 */
export class ReadNotFoundError extends ResearcherError {
  constructor(message: string, path?: string) {
    super(message, ErrorCode.ERR_READ_NOT_FOUND, {
      retryable: false,
      details: path ? { path } : undefined,
    });
    this.name = 'ReadNotFoundError';
  }
}

/**
 * Insufficient permissions to read the file.
 * Code: ERR_READ_PERMISSION_DENIED — not retryable.
 */
export class ReadPermissionDeniedError extends ResearcherError {
  constructor(message: string, path?: string) {
    super(message, ErrorCode.ERR_READ_PERMISSION_DENIED, {
      retryable: false,
      details: path ? { path } : undefined,
    });
    this.name = 'ReadPermissionDeniedError';
  }
}

/**
 * File encoding mismatch.
 * Code: ERR_READ_ENCODING_ERROR — not retryable.
 */
export class ReadEncodingError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_READ_ENCODING_ERROR, { retryable: false, details });
    this.name = 'ReadEncodingError';
  }
}

// ---------------------------------------------------------------------------
// Provider selection errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an explicitly requested provider alias is not configured.
 * Code: ERR_PROVIDER_UNAVAILABLE — not retryable (caller must choose another provider).
 */
export class ProviderUnavailableError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_PROVIDER_UNAVAILABLE, { retryable: false, details });
    this.name = 'ProviderUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Health check errors
// ---------------------------------------------------------------------------

/**
 * MCP server health check failed.
 * Code: ERR_HEALTH_CHECK_FAILED — retryable with backoff.
 */
export class HealthCheckFailedError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_HEALTH_CHECK_FAILED, { retryable: true, details });
    this.name = 'HealthCheckFailedError';
  }
}

// ---------------------------------------------------------------------------
// General / config errors
// ---------------------------------------------------------------------------

/**
 * Input validation error.
 * Code: ERR_VALIDATION — not retryable.
 */
export class ValidationError extends ResearcherError {
  constructor(message: string, field?: string, value?: unknown) {
    super(message, ErrorCode.ERR_VALIDATION, {
      retryable: false,
      details: { field, value },
    });
    this.name = 'ValidationError';
  }
}

/**
 * Configuration error.
 * Code: ERR_CONFIG — not retryable.
 */
export class ConfigError extends ResearcherError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_CONFIG, { retryable: false, details });
    this.name = 'ConfigError';
  }
}

// ---------------------------------------------------------------------------
// Legacy aliases — kept for in-flight provider code; remove in wave-2
// ---------------------------------------------------------------------------

/**
 * @deprecated Use SearxngUnavailableError or ReaderUnavailableError instead.
 * Retained temporarily to avoid breaking provider callers before they are migrated.
 */
export class ProviderError extends ResearcherError {
  constructor(message: string, provider: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_SEARXNG_UNAVAILABLE, {
      retryable: true,
      details: { provider, ...details },
    });
    this.name = 'ProviderError';
  }
}

/**
 * @deprecated Use SearxngTimeoutError or ReaderTimeoutError instead.
 */
export class TimeoutError extends ResearcherError {
  constructor(message: string, operation: string, timeout: number) {
    super(message, ErrorCode.ERR_SEARXNG_TIMEOUT, {
      retryable: true,
      details: { operation, timeout },
    });
    this.name = 'TimeoutError';
  }
}

/**
 * @deprecated Use ValidationError instead.
 */
export class HttpError extends ResearcherError {
  constructor(message: string, status?: number, url?: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.ERR_VALIDATION, {
      retryable: false,
      details: { status, url, ...details },
    });
    this.name = 'HttpError';
  }
}

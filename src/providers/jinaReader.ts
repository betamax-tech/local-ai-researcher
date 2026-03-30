/**
 * Jina Reader provider — locked v1 implementation.
 *
 * Boundary contract:
 * - Outputs normalized ReadResult domain objects (no provider-specific leakage).
 * - Full-content model: `content` is populated by default; truncation is explicit.
 * - Throws typed error codes from the locked taxonomy (ERR_READER_*).
 */

import type { ReadResult, JinaReaderConfig, ContentMode, ContentTruncation } from '../domain/types.js';
import { HttpClient } from '../lib/http.js';
import type { ReaderProvider, ProviderHealth } from './interfaces.js';
import {
  ReaderTimeoutError,
  ReaderUnavailableError,
  ReaderInvalidResponseError,
  SsrfError,
  ErrorCode,
} from '../lib/errors.js';
import { TimeoutError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Jina Reader request options */
export interface JinaReaderOptions {
  /**
   * Content mode: 'full' returns full content, 'excerpt' returns truncated preview.
   * Default: 'full' (full-content-by-default model).
   */
  content_mode?: ContentMode;

  /** Target word count for excerpt trimming (only used when content_mode: 'excerpt') */
  targetWords?: number;

  /** Language hint for Jina Reader (optional) */
  language?: string;
}

/**
 * Jina Reader API response shape.
 *
 * Public cloud endpoint (r.jina.ai) wraps the payload under `data`:
 *   { code, status, data: { title, content, url, warning?, ... } }
 *
 * Self-hosted jina-ai/reader returns the flat shape directly:
 *   { title, content, url }
 *
 * Both shapes are normalised in `extractJinaPayload()`.
 */
interface JinaReaderResponse {
  // Flat shape (self-hosted)
  title?: string;
  content?: string;
  url?: string;
  warning?: string;
  // Wrapped shape (public cloud)
  code?: number;
  status?: number;
  data?: {
    title?: string;
    content?: string;
    url?: string;
    warning?: string;
  };
}

/** Normalise both Jina response shapes into a single flat payload. */
function extractJinaPayload(raw: JinaReaderResponse): {
  title?: string;
  content: string;
  url: string;
  warning?: string;
} {
  // Wrapped shape: public cloud { code, data: { ... } }
  if (raw.data && typeof raw.data === 'object') {
    const d = raw.data;
    if (typeof d.content !== 'string') {
      throw new Error('Jina Reader response missing content field (wrapped shape)');
    }
    return {
      title:   d.title,
      content: d.content,
      url:     d.url ?? '',
      warning: d.warning,
    };
  }
  // Flat shape: self-hosted { title, content, url }
  if (typeof raw.content !== 'string') {
    throw new Error('Jina Reader response missing content field');
  }
  return {
    title:   raw.title,
    content: raw.content,
    url:     raw.url ?? '',
    warning: raw.warning,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first `lines` lines of `text` (30-line excerpt default per PRD) */
function firstLines(text: string, lineCount: number): string {
  const lines = text.split('\n');
  if (lines.length <= lineCount) return text;
  return lines.slice(0, lineCount).join('\n') + '\n...';
}

/** Extract the first `targetWords` words from `text` */
function firstWords(text: string, targetWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= targetWords) return text;
  return words.slice(0, targetWords).join(' ') + '...';
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Jina Reader provider */
export class JinaReaderProvider implements ReaderProvider {
  private config: JinaReaderConfig;
  private httpClient: HttpClient;
  private logger: Logger;

  constructor(config: JinaReaderConfig, httpClient: HttpClient, logger: Logger) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger;
  }

  get id(): string {
    return 'jina-reader';
  }

  get name(): string {
    return 'Jina Reader';
  }

  /**
   * Check if Jina Reader endpoint is reachable.
   */
  async isHealthy(): Promise<boolean> {
    try {
      // HEAD request to the base endpoint
      const testUrl = `${this.config.endpoint}https://example.com`;
      const response = await this.httpClient.get(testUrl, {
        timeout: 5000,
        retry: false,
      });
      return response.status === 200;
    } catch (error) {
      this.logger.warn('Jina Reader health check failed', {
        component: 'JinaReaderProvider',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Probe Jina Reader and return structured readiness with latency.
   *
   * Status semantics:
   * - `connected`   — endpoint responded 200; reader lane is ready.
   * - `degraded`    — endpoint responded but slowly (>2000ms).
   * - `unavailable` — connection failed, timed out, or returned non-success status.
   * - `error`       — request was blocked by SSRF protection; treat as configuration
   *                   problem (error_code: ERR_SSRF_BLOCKED).
   *
   * The existing {@link isHealthy} method is kept for backward compatibility.
   *
   * @returns Structured health result with latency and optional error info
   */
  async checkHealth(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      const testUrl = `${this.config.endpoint}https://example.com`;
      const response = await this.httpClient.get(testUrl, {
        timeout: 5000,
        retry: false,
      });
      const latency_ms = Date.now() - startTime;

      if (response.status === 200) {
        // Check if response was slow (>2000ms)
        const status = latency_ms > 2000 ? 'degraded' : 'connected';
        this.logger.debug('Jina Reader checkHealth: connected', {
          component: 'JinaReaderProvider',
          latency_ms,
          status: response.status,
        });
        return { status, latency_ms };
      }

      // Non-OK status code — treat as unavailable
      this.logger.warn('Jina Reader checkHealth: unexpected status', {
        component: 'JinaReaderProvider',
        latency_ms,
        httpStatus: response.status,
      });
      return {
        status: 'unavailable',
        latency_ms,
        error: `Unexpected HTTP status: ${response.status}`,
      };
    } catch (error) {
      const latency_ms = Date.now() - startTime;

      // SSRF-blocked requests are a configuration problem, not a connectivity problem
      if (error instanceof SsrfError) {
        this.logger.warn('Jina Reader checkHealth: SSRF blocked', {
          component: 'JinaReaderProvider',
          latency_ms,
          error: error.message,
        });
        return {
          status: 'error',
          latency_ms,
          error: error.message,
          error_code: ErrorCode.ERR_SSRF_BLOCKED,
        };
      }

      // Any other error (network failure, timeout, etc.) = unavailable
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('Jina Reader checkHealth: unavailable', {
        component: 'JinaReaderProvider',
        latency_ms,
        error: message,
      });
      return {
        status: 'unavailable',
        latency_ms,
        error: message,
      };
    }
  }

  /**
   * Check if a URL can be read by this provider.
   * Only http/https URLs are supported.
   */
  canRead(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Read content from a URL via Jina Reader.
   *
   * Full-content model (locked v1):
   * - `content` is populated by default.
   * - `content_mode: 'excerpt'` returns truncated content with metadata.
   *
   * @param url - URL to fetch
   * @param options - Read options
   * @returns Normalized ReadResult
   * @throws ReaderTimeoutError | ReaderUnavailableError | ReaderInvalidResponseError
   */
  async read(url: string, options: JinaReaderOptions = {}): Promise<ReadResult> {
    const startTime = Date.now();
    const contentMode: ContentMode = options.content_mode ?? 'full';

    try {
      // Jina Reader URL format: <endpoint><target-url>
      const readerUrl = `${this.config.endpoint}${url}`;

      // Optional query params
      const params = new URLSearchParams();
      if (options.language) params.append('language', options.language);
      const fullUrl = params.toString() ? `${readerUrl}?${params.toString()}` : readerUrl;

      // Headers: request JSON response from Jina (public cloud returns Markdown by default)
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      this.logger.debug('Jina Reader request', {
        component: 'JinaReaderProvider',
        url,
        readerUrl: fullUrl,
        content_mode: contentMode,
      });

      const response = await this.httpClient.get(fullUrl, {
        timeout: this.config.timeout,
        headers,
      });

      // Normalise response — handles both wrapped (public cloud) and flat (self-hosted) shapes
      const raw = response.body as JinaReaderResponse;
      let payload: ReturnType<typeof extractJinaPayload>;
      try {
        payload = extractJinaPayload(raw);
      } catch {
        throw new ReaderInvalidResponseError(
          'Jina Reader response missing content field',
          { url, status: response.status }
        );
      }

      // Surface provider warning into logs (e.g. cached snapshot notice)
      if (payload.warning) {
        this.logger.warn('Jina Reader provider warning', {
          component: 'JinaReaderProvider',
          url,
          warning: payload.warning,
        });
      }

      const rawContent = payload.content;
      const duration = Date.now() - startTime;

      // Determine if truncation is needed
      let content: string;
      let contentTruncated = false;
      let truncation: ContentTruncation | undefined;

      if (contentMode === 'excerpt') {
        // Apply truncation for excerpt mode
        const truncatedContent = options.targetWords
          ? firstWords(rawContent, options.targetWords)
          : firstLines(rawContent, 30);
        
        content = truncatedContent;
        
        // Check if truncation actually occurred
        if (truncatedContent !== rawContent) {
          contentTruncated = true;
          truncation = {
            applied_limit: options.targetWords ?? 30,
            reason: 'explicit_excerpt',
          };
        }
      } else {
        // Full content mode - use raw content
        content = rawContent;
        // Note: Could add provider_limit detection here if Jina truncates
      }

      // Always compute excerpt for backwards compatibility
      const excerpt = options.targetWords
        ? firstWords(rawContent, options.targetWords)
        : firstLines(rawContent, 30);

      const result: ReadResult = {
        url,
        title: payload.title,
        excerpt,
        content,
        content_mode: contentMode,
        content_truncated: contentTruncated,
        truncation,
        wordCount: rawContent.split(/\s+/).filter(Boolean).length,
        duration,
      };

      this.logger.info('Jina Reader read completed', {
        component: 'JinaReaderProvider',
        url,
        wordCount: result.wordCount,
        duration,
        content_mode: contentMode,
        content_truncated: contentTruncated,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Re-throw typed domain errors without double-wrapping
      if (
        error instanceof ReaderTimeoutError ||
        error instanceof ReaderUnavailableError ||
        error instanceof ReaderInvalidResponseError
      ) {
        throw error;
      }

      // Map TimeoutError → ReaderTimeoutError
      if (error instanceof TimeoutError) {
        throw new ReaderTimeoutError(
          `Jina Reader read timed out: ${error.message}`,
          { url, duration }
        );
      }

      this.logger.error('Jina Reader read failed', {
        component: 'JinaReaderProvider',
        url,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new ReaderUnavailableError(
        `Jina Reader read failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { url, duration }
      );
    }
  }
}

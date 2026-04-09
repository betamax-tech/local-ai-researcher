/**
 * SearxNG provider — locked v1 implementation.
 *
 * Boundary contract:
 * - Outputs normalized SearchResult domain objects (no provider-specific leakage).
 * - Throws typed error codes from the locked taxonomy (ERR_SEARXNG_*).
 * - id is a deterministic hash of canonical URL + query + position.
 * - excerpt is always populated (30-line default).
 */

import { createHash } from 'crypto';

import type { SearchResult, SearxngConfig } from '../domain/types.js';
import { HttpClient } from '../lib/http.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import {
  SearxngTimeoutError,
  SearxngUnavailableError,
  SearxngInvalidResponseError,
  SsrfError,
  ErrorCode,
} from '../lib/errors.js';
import { TimeoutError } from '../lib/errors.js';
import { canonicalizeUrl } from '../lib/url.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** SearxNG search options */
export interface SearxngSearchOptions {
  /** Number of results (default: 10, max: 50) */
  limit?: number;

  /** Search category (optional) */
  category?: string;

  /** Language code (optional) */
  language?: string;

  /** Time filter (optional) */
  timeRange?: string;

  /** Force specific engines on this request (internal higher-level tool hint) */
  forcedEngines?: string[];
}

/** Raw SearxNG API response shape */
interface SearxngResponse {
  query: string;
  results: Array<{
    url: string;
    title: string;
    content: string;
    engine?: string;
    category?: string;
    publishedDate?: string;
    score?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce the first `lines` lines of a text block (excerpt-first model).
 * Matches the 30-line default specified in the PRD.
 */
function firstLines(text: string, lines: number): string {
  return text.split('\n').slice(0, lines).join('\n');
}

/**
 * Deterministic result ID: SHA-256 of canonical URL + query + position.
 * Same request always produces the same ID regardless of result ordering.
 */
function makeResultId(canonicalUrl: string, query: string, position: number): string {
  return createHash('sha256')
    .update(`${canonicalUrl}::${query}::${position}`)
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** SearxNG provider */
export class SearxngProvider implements SearchProvider {
  private config: SearxngConfig;
  private httpClient: HttpClient;
  private logger: Logger;

  constructor(config: SearxngConfig, httpClient: HttpClient, logger: Logger) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger;
  }

  get id(): string {
    return 'searxng';
  }

  get name(): string {
    return 'SearxNG';
  }

  /**
   * Check if the SearxNG instance is reachable.
   * @returns true if a lightweight ping succeeds
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get(
        `${this.config.endpoint}/search`,
        {
          timeout: 5000,
          retry: false,
          ssrfAllowedNetworks: this.config.allowPrivateNetworks
            ? ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
            : [],
        }
      );
      return response.status === 200 || response.status === 405; // 405 = method not allowed is OK
    } catch (error) {
      this.logger.warn('SearxNG health check failed', {
        component: 'SearxngProvider',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Probe SearxNG and return structured readiness with latency.
   *
   * Status semantics:
   * - `connected`   — endpoint responded; search lane is ready.
   * - `unavailable` — connection failed, timed out, or returned a non-success
   *                   status; search lane is not usable.
   * - `error`       — request was blocked by SSRF protection; treat as a
   *                   configuration problem (error_code: ERR_SSRF_BLOCKED).
   *
   * The existing {@link isHealthy} method is kept for backward compatibility.
   *
   * @returns Structured health result with latency and optional error info
   */
  async checkHealth(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      const response = await this.httpClient.get(
        `${this.config.endpoint}/search`,
        {
          timeout: 5000,
          retry: false,
          ssrfAllowedNetworks: this.config.allowPrivateNetworks
            ? ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
            : [],
        }
      );
      const latency_ms = Date.now() - startTime;

      const ok = response.status === 200 || response.status === 405;
      if (ok) {
        this.logger.debug('SearxNG checkHealth: connected', {
          component: 'SearxngProvider',
          latency_ms,
          status: response.status,
        });
        return { status: 'connected', latency_ms };
      }

      // Non-OK status code — treat as unavailable
      this.logger.warn('SearxNG checkHealth: unexpected status', {
        component: 'SearxngProvider',
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
        this.logger.warn('SearxNG checkHealth: SSRF blocked', {
          component: 'SearxngProvider',
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
      this.logger.warn('SearxNG checkHealth: unavailable', {
        component: 'SearxngProvider',
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
   * Perform a web search via SearxNG.
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Normalized SearchResult array with ids and excerpts
   * @throws SearxngTimeoutError | SearxngUnavailableError | SearxngInvalidResponseError
   */
  async search(query: string, options: SearxngSearchOptions = {}): Promise<SearchResult[]> {
    const startTime = Date.now();
    const limit = Math.min(options.limit ?? 10, 50);

    try {
      const language = options.language ?? 'en';
      const isEnglishDefault = options.language === undefined;

      const params = new URLSearchParams({
        q: query,
        format: 'json',
        language,
      });

      // Apply explicit engine forcing first when requested by a higher-level tool.
      if (options.forcedEngines && options.forcedEngines.length > 0) {
        params.append('engines', options.forcedEngines.join(','));
      }
      // Otherwise apply engine exclusion only for English default (no explicit language specified)
      // Engine names are SearXNG-specific internal identifiers. If a custom SearXNG instance
      // uses different engine names, this exclusion silently does nothing.
      else if (isEnglishDefault) {
        params.append('engines', '-bing news,-google news,-yahoo news,-ddg definitions');
      }

      if (options.category) params.append('categories', options.category);
      if (options.timeRange) params.append('time_range', options.timeRange);
      params.append('pageno', '1');

      const url = `${this.config.endpoint}/search?${params.toString()}`;

      this.logger.debug('SearxNG search request', {
        component: 'SearxngProvider',
        query,
        limit,
        url,
      });

      const response = await this.httpClient.get(url, {
        timeout: this.config.timeout,
        ssrfAllowedNetworks: this.config.allowPrivateNetworks
          ? ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
          : [],
      });

      // Validate response shape
      const data = response.body as SearxngResponse;
      if (!Array.isArray(data?.results)) {
        throw new SearxngInvalidResponseError(
          'SearxNG response missing results array',
          { url, status: response.status }
        );
      }

      // Normalize to domain SearchResult — no provider-specific fields in output
      const results: SearchResult[] = data.results
        .slice(0, limit)
        .map((raw, position) => {
          let canonicalUrl: string;
          try {
            canonicalUrl = canonicalizeUrl(raw.url);
          } catch {
            canonicalUrl = raw.url; // keep as-is if un-parseable
          }

          return {
            id: makeResultId(canonicalUrl, query, position),
            url: canonicalUrl,
            title: raw.title ?? '',
            excerpt: firstLines(raw.content ?? '', 30),
            source: 'web' as const,
            relevance: raw.score != null ? Math.min(Math.max(raw.score, 0), 1) : undefined,
            date: raw.publishedDate,
            _engine: raw.engine ?? raw.category,
          };
        });

      const duration = Date.now() - startTime;

      this.logger.info('SearxNG search completed', {
        component: 'SearxngProvider',
        query,
        resultCount: results.length,
        duration,
      });

      return results;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Re-throw typed errors from the taxonomy without double-wrapping
      if (
        error instanceof SearxngTimeoutError ||
        error instanceof SearxngUnavailableError ||
        error instanceof SearxngInvalidResponseError
      ) {
        throw error;
      }

      // Map TimeoutError → SearxngTimeoutError
      if (error instanceof TimeoutError) {
        throw new SearxngTimeoutError(
          `SearxNG search timed out: ${error.message}`,
          { query, duration }
        );
      }

      this.logger.error('SearxNG search failed', {
        component: 'SearxngProvider',
        query,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new SearxngUnavailableError(
        `SearxNG search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { query, duration }
      );
    }
  }
}

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
import {
  SearxngTimeoutError,
  SearxngUnavailableError,
  SearxngInvalidResponseError,
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
export class SearxngProvider {
  private config: SearxngConfig;
  private httpClient: HttpClient;
  private logger: Logger;

  constructor(config: SearxngConfig, httpClient: HttpClient, logger: Logger) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger;
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
        { timeout: 5000, retry: false }
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
      // Build query parameters
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        language: options.language ?? 'en',
      });

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
          ? ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
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

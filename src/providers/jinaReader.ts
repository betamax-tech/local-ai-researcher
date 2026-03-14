/**
 * Jina Reader provider — locked v1 implementation.
 *
 * Boundary contract:
 * - Outputs normalized ReadResult domain objects (no provider-specific leakage).
 * - Excerpt-first model: `excerpt` always populated (30-line default).
 * - Full text in `content` only when fullText opt-in is passed.
 * - Throws typed error codes from the locked taxonomy (ERR_READER_*).
 */

import type { ReadResult, JinaReaderConfig } from '../domain/types.js';
import { HttpClient } from '../lib/http.js';
import {
  ReaderTimeoutError,
  ReaderUnavailableError,
  ReaderInvalidResponseError,
} from '../lib/errors.js';
import { TimeoutError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Jina Reader request options */
export interface JinaReaderOptions {
  /**
   * Return full text or excerpt only.
   * Locked v1 default: excerpt (30 lines).
   */
  fullText?: boolean;

  /** Target word count for excerpt trimming (overrides 30-line default) */
  targetWords?: number;

  /** Language hint for Jina Reader (optional) */
  language?: string;
}

/** Jina Reader API response shape */
interface JinaReaderResponse {
  title?: string;
  content: string;
  url: string;
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
export class JinaReaderProvider {
  private config: JinaReaderConfig;
  private httpClient: HttpClient;
  private logger: Logger;

  constructor(config: JinaReaderConfig, httpClient: HttpClient, logger: Logger) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger;
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
   * Excerpt-first model (locked v1):
   * - `excerpt` always set to first 30 lines (or `targetWords` words if specified).
   * - `content` only set when `fullText: true`.
   *
   * @param url - URL to fetch
   * @param options - Read options
   * @returns Normalized ReadResult
   * @throws ReaderTimeoutError | ReaderUnavailableError | ReaderInvalidResponseError
   */
  async read(url: string, options: JinaReaderOptions = {}): Promise<ReadResult> {
    const startTime = Date.now();

    try {
      // Jina Reader URL format: <endpoint><target-url>
      const readerUrl = `${this.config.endpoint}${url}`;

      // Optional query params
      const params = new URLSearchParams();
      if (options.language) params.append('language', options.language);
      const fullUrl = params.toString() ? `${readerUrl}?${params.toString()}` : readerUrl;

      // API key header if configured
      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      this.logger.debug('Jina Reader request', {
        component: 'JinaReaderProvider',
        url,
        readerUrl: fullUrl,
        fullText: options.fullText ?? false,
      });

      const response = await this.httpClient.get(fullUrl, {
        timeout: this.config.timeout,
        headers,
      });

      // Validate response
      const data = response.body as JinaReaderResponse;
      if (typeof data?.content !== 'string') {
        throw new ReaderInvalidResponseError(
          'Jina Reader response missing content field',
          { url, status: response.status }
        );
      }

      const rawContent = data.content;
      const duration = Date.now() - startTime;

      // Excerpt-first: always compute excerpt
      const excerpt = options.targetWords
        ? firstWords(rawContent, options.targetWords)
        : firstLines(rawContent, 30);

      const result: ReadResult = {
        url,
        title: data.title,
        excerpt,
        // Full text only when explicitly requested
        content: options.fullText ? rawContent : undefined,
        wordCount: rawContent.split(/\s+/).filter(Boolean).length,
        duration,
      };

      this.logger.info('Jina Reader read completed', {
        component: 'JinaReaderProvider',
        url,
        wordCount: result.wordCount,
        duration,
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

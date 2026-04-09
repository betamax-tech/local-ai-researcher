/**
 * Tests for SearxNG provider — locked v1 contract (task 08.01).
 *
 * Tests verify:
 * 1. Normalized SearchResult output (id, url, title, excerpt, source)
 * 2. Deterministic result IDs (same inputs = same ID)
 * 3. URL canonicalization for stable dedup keys
 * 4. Limit control with documented default (10)
 * 5. Error mapping to v1 taxonomy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearxngProvider } from './searxng.js';
import type { SearxngConfig } from '../domain/types.js';
import { HttpClient } from '../lib/http.js';
import { Logger } from '../lib/logger.js';
import {
  SearxngTimeoutError,
  SearxngUnavailableError,
  SearxngInvalidResponseError,
  SsrfError,
  TimeoutError,
  ErrorCode,
} from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
  } as unknown as HttpClient;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createTestConfig(): SearxngConfig {
  return {
    endpoint: 'http://localhost:8888',
    timeout: 10000,
    allowPrivateNetworks: true,
  };
}

// Raw SearXNG API response shape
interface RawSearxngResult {
  url: string;
  title: string;
  content: string;
  engine?: string;
  category?: string;
  publishedDate?: string;
  score?: number;
}

function createRawSearxngResponse(
  query: string,
  results: RawSearxngResult[]
): { query: string; results: RawSearxngResult[] } {
  return { query, results };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearxngProvider', () => {
  let provider: SearxngProvider;
  let mockHttpClient: HttpClient;
  let mockLogger: Logger;
  let config: SearxngConfig;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    mockLogger = createMockLogger();
    config = createTestConfig();
    provider = new SearxngProvider(config, mockHttpClient, mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Provider metadata
  // -------------------------------------------------------------------------

  describe('provider metadata', () => {
    it('has name property identifying SearxNG', () => {
      expect(provider.name).toBe('SearxNG');
    });
  });

  // -------------------------------------------------------------------------
  // Normalized result fields (task 08.01)
  // -------------------------------------------------------------------------

  describe('normalized result fields', () => {
    it('returns SearchResult array with required id field', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article 1', content: 'Content 1' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBeDefined();
      expect(typeof results[0]!.id).toBe('string');
      expect(results[0]!.id.length).toBe(16); // SHA-256 truncated to 16 chars
    });

    it('returns SearchResult with canonical url', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://WWW.EXAMPLE.COM/path/', title: 'Article', content: 'Content' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      // URL should be canonicalized (lowercase, no www, no trailing slash)
      expect(results[0]!.url).toBe('https://example.com/path');
    });

    it('returns SearchResult with title', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Test Article', content: 'Content' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.title).toBe('Test Article');
    });

    it('returns SearchResult with excerpt (content preview)', async () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article', content },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.excerpt).toBeDefined();
      expect(results[0]!.excerpt).toBe(content); // Short content preserved as-is
    });

    it('returns SearchResult with source type "web"', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article', content: 'Content' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.source).toBe('web');
    });

    it('includes optional relevance score when available', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article', content: 'Content', score: 0.85 },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.relevance).toBe(0.85);
    });

    it('includes optional date when publishedDate available', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article', content: 'Content', publishedDate: '2024-01-15' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.date).toBe('2024-01-15');
    });

    it('handles empty title gracefully', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: undefined as unknown as string, content: 'Content' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.title).toBe('');
    });

    it('handles empty content gracefully', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article', content: undefined as unknown as string },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.excerpt).toBe('');
    });

    it('does not leak provider-specific fields (engines, categories)', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article', content: 'Content', engine: 'google', category: 'general' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      // Provider-specific fields should NOT be in the normalized output
      expect(results[0]).not.toHaveProperty('engines');
      expect(results[0]).not.toHaveProperty('categories');
      expect(results[0]).not.toHaveProperty('engine');
      expect(results[0]).not.toHaveProperty('category');
      
      // _engine is internal for debugging, not AI-facing
      expect(results[0]!._engine).toBe('google');
    });
  });

  // -------------------------------------------------------------------------
  // Deterministic result IDs (task 08.01)
  // -------------------------------------------------------------------------

  describe('deterministic result IDs', () => {
    it('produces same ID for same URL + query + position', async () => {
      const rawResponse = createRawSearxngResponse('test query', [
        { url: 'https://example.com/article', title: 'Article', content: 'Content' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results1 = await provider.search('test query');
      const results2 = await provider.search('test query');

      expect(results1[0]!.id).toBe(results2[0]!.id);
    });

    it('produces different IDs for different URLs', async () => {
      const rawResponse1 = createRawSearxngResponse('test', [
        { url: 'https://example.com/article1', title: 'Article 1', content: 'Content' },
      ]);
      const rawResponse2 = createRawSearxngResponse('test', [
        { url: 'https://example.com/article2', title: 'Article 2', content: 'Content' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ status: 200, body: rawResponse1, text: JSON.stringify(rawResponse1) })
        .mockResolvedValueOnce({ status: 200, body: rawResponse2, text: JSON.stringify(rawResponse2) });

      const results1 = await provider.search('test');
      const results2 = await provider.search('test');

      expect(results1[0]!.id).not.toBe(results2[0]!.id);
    });

    it('produces different IDs for different positions', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/article1', title: 'Article 1', content: 'Content 1' },
        { url: 'https://example.com/article2', title: 'Article 2', content: 'Content 2' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      expect(results[0]!.id).not.toBe(results[1]!.id);
    });

    it('produces different IDs for same URL but different queries', async () => {
      const rawResponse1 = createRawSearxngResponse('query one', [
        { url: 'https://example.com/article', title: 'Article', content: 'Content' },
      ]);
      const rawResponse2 = createRawSearxngResponse('query two', [
        { url: 'https://example.com/article', title: 'Article', content: 'Content' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ status: 200, body: rawResponse1, text: JSON.stringify(rawResponse1) })
        .mockResolvedValueOnce({ status: 200, body: rawResponse2, text: JSON.stringify(rawResponse2) });

      const results1 = await provider.search('query one');
      const results2 = await provider.search('query two');

      expect(results1[0]!.id).not.toBe(results2[0]!.id);
    });
  });

  // -------------------------------------------------------------------------
  // Limit control (task 08.01)
  // -------------------------------------------------------------------------

  describe('limit control', () => {
    it('applies default limit of 10 when not specified', async () => {
      // Create 20 results
      const rawResults: RawSearxngResult[] = Array.from({ length: 20 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Article ${i}`,
        content: `Content ${i}`,
      }));
      const rawResponse = createRawSearxngResponse('test', rawResults);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test');

      // Default limit is 10
      expect(results.length).toBe(10);
    });

    it('respects explicit limit parameter', async () => {
      const rawResults: RawSearxngResult[] = Array.from({ length: 20 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Article ${i}`,
        content: `Content ${i}`,
      }));
      const rawResponse = createRawSearxngResponse('test', rawResults);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test', { limit: 5 });

      expect(results.length).toBe(5);
    });

    it('caps limit at 50 (maximum)', async () => {
      const rawResults: RawSearxngResult[] = Array.from({ length: 100 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Article ${i}`,
        content: `Content ${i}`,
      }));
      const rawResponse = createRawSearxngResponse('test', rawResults);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      // Request 100 but should be capped at 50
      const results = await provider.search('test', { limit: 100 });

      expect(results.length).toBe(50);
    });

    it('handles limit of 1', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article 1', content: 'Content 1' },
        { url: 'https://example.com/2', title: 'Article 2', content: 'Content 2' },
      ]);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('test', { limit: 1 });

      expect(results.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Error mapping to v1 taxonomy (task 08.01)
  // -------------------------------------------------------------------------

  describe('error mapping', () => {
    it('throws SearxngTimeoutError with ERR_SEARXNG_TIMEOUT on timeout', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TimeoutError('Request timed out', 'GET', 10000)
      );

      const error = await provider.search('test').then(
        () => undefined,
        err => err as SearxngTimeoutError
      );

      expect(error).toBeInstanceOf(SearxngTimeoutError);
      expect((error as SearxngTimeoutError).code).toBe(ErrorCode.ERR_SEARXNG_TIMEOUT);
      expect((error as SearxngTimeoutError).retryable).toBe(true);
    });

    it('throws SearxngUnavailableError with ERR_SEARXNG_UNAVAILABLE on network error', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const error = await provider.search('test').then(
        () => undefined,
        err => err as SearxngUnavailableError
      );

      expect(error).toBeInstanceOf(SearxngUnavailableError);
      expect((error as SearxngUnavailableError).code).toBe(ErrorCode.ERR_SEARXNG_UNAVAILABLE);
      expect((error as SearxngUnavailableError).retryable).toBe(true);
    });

    it('throws SearxngInvalidResponseError with ERR_SEARXNG_INVALID_RESPONSE on malformed response', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: { query: 'test' }, // Missing 'results' array
        text: JSON.stringify({ query: 'test' }),
      });

      const error = await provider.search('test').then(
        () => undefined,
        err => err as SearxngInvalidResponseError
      );

      expect(error).toBeInstanceOf(SearxngInvalidResponseError);
      expect((error as SearxngInvalidResponseError).code).toBe(ErrorCode.ERR_SEARXNG_INVALID_RESPONSE);
      expect((error as SearxngInvalidResponseError).retryable).toBe(false);
    });

    it('re-throws SearxngTimeoutError without double-wrapping', async () => {
      const originalError = new SearxngTimeoutError('Already wrapped', { query: 'test' });
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);

      const error = await provider.search('test').catch(err => err);

      expect(error).toBe(originalError);
    });

    it('re-throws SearxngUnavailableError without double-wrapping', async () => {
      const originalError = new SearxngUnavailableError('Already wrapped', { query: 'test' });
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);

      const error = await provider.search('test').catch(err => err);

      expect(error).toBe(originalError);
    });

    it('re-throws SearxngInvalidResponseError without double-wrapping', async () => {
      const originalError = new SearxngInvalidResponseError('Already wrapped', { status: 500 });
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);

      const error = await provider.search('test').catch(err => err);

      expect(error).toBe(originalError);
    });
  });

  // -------------------------------------------------------------------------
  // Empty results handling
  // -------------------------------------------------------------------------

  describe('empty results', () => {
    it('returns empty array when no results (not an error)', async () => {
      const rawResponse = createRawSearxngResponse('test', []);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      const results = await provider.search('nonexistent query xyz');

      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Health check (legacy)
  // -------------------------------------------------------------------------

  describe('isHealthy', () => {
    it('returns true when instance responds with 200', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
      });

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(true);
    });

    it('returns true when instance responds with 405 (method not allowed)', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 405,
      });

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(true);
    });

    it('returns false on network error', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Language and engine configuration (task 14.01)
  // -------------------------------------------------------------------------

  describe('language and engine configuration', () => {
    // Helper: extract URLSearchParams from the URL passed to mockHttpClient.get
    function capturedParams(): URLSearchParams {
      const call = (mockHttpClient.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const calledUrl: string = call[0] as string;
      const queryString = calledUrl.includes('?') ? calledUrl.split('?')[1]! : '';
      return new URLSearchParams(queryString);
    }

    it('applies English default with engine exclusion when language not specified', async () => {
      // Arrange: valid response; no language in options (undefined)
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article 1', content: 'Content 1' },
      ]);
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      // Act: call search with no language option at all
      await provider.search('test');

      // Assert: URL must contain language=en AND engines exclusion param
      const params = capturedParams();
      expect(params.get('language')).toBe('en');
      expect(params.get('engines')).toBe('-bing news,-google news,-yahoo news,-ddg definitions');
    });

    it('respects explicit English language without engine exclusion', async () => {
      // Arrange: valid response; language explicitly set to 'en'
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article 1', content: 'Content 1' },
      ]);
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      // Act: explicit language 'en' — caller intent always wins
      await provider.search('test', { language: 'en' });

      // Assert: URL must have language=en but NO engines param
      const params = capturedParams();
      expect(params.get('language')).toBe('en');
      expect(params.get('engines')).toBeNull();
    });

    it('respects explicit non-English language without engine exclusion', async () => {
      // Arrange: valid response; language explicitly set to 'de'
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article 1', content: 'Content 1' },
      ]);
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      // Act: explicit non-English language
      await provider.search('test', { language: 'de' });

      // Assert: URL must have language=de and NO engines param
      const params = capturedParams();
      expect(params.get('language')).toBe('de');
      expect(params.get('engines')).toBeNull();
    });

    it('forces requested engines when provided', async () => {
      const rawResponse = createRawSearxngResponse('test', [
        { url: 'https://example.com/1', title: 'Article 1', content: 'Content 1' },
      ]);
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      await provider.search('test', { forcedEngines: ['google'] });

      const params = capturedParams();
      expect(params.get('engines')).toBe('google');
    });

    it('excluded engines list does not affect response normalization', async () => {
      // Arrange: raw response where results appear to come from normally-excluded engines
      // (exclusion is request-side; if SearXNG returns them they must still normalize correctly)
      const rawResponse = createRawSearxngResponse('test', [
        {
          url: 'https://news.example.com/article',
          title: 'Breaking News',
          content: 'Some news content',
          engine: 'bing news',
          score: 0.7,
        },
        {
          url: 'https://definitions.example.com/word',
          title: 'Word Definition',
          content: 'A definition of a word',
          engine: 'ddg definitions',
        },
      ]);
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: rawResponse,
        text: JSON.stringify(rawResponse),
      });

      // Act: call search with no language (triggers engine exclusion in request)
      const results = await provider.search('test');

      // Assert: provider still normalizes results correctly regardless of their engine source
      expect(results).toHaveLength(2);
      expect(results[0]!.url).toBe('https://news.example.com/article');
      expect(results[0]!.title).toBe('Breaking News');
      expect(results[0]!.excerpt).toBe('Some news content');
      expect(results[0]!.source).toBe('web');
      expect(results[0]!.relevance).toBe(0.7);
      expect(results[0]!._engine).toBe('bing news');
      expect(results[1]!.url).toBe('https://definitions.example.com/word');
      expect(results[1]!._engine).toBe('ddg definitions');
      // Provider-specific fields must not leak into normalized output
      expect(results[0]).not.toHaveProperty('engine');
      expect(results[0]).not.toHaveProperty('engines');
    });
  });

  // -------------------------------------------------------------------------
  // checkHealth (task 08.02)
  // -------------------------------------------------------------------------

  describe('checkHealth', () => {
    it('returns connected with latency_ms when reachable (200)', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
      });

      const result = await provider.checkHealth();

      expect(result.status).toBe('connected');
      expect(typeof result.latency_ms).toBe('number');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(result.error_code).toBeUndefined();
    });

    it('returns connected with latency_ms when reachable (405 method not allowed)', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 405,
      });

      const result = await provider.checkHealth();

      expect(result.status).toBe('connected');
      expect(typeof result.latency_ms).toBe('number');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('returns unavailable with error when connection fails', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      const result = await provider.checkHealth();

      expect(result.status).toBe('unavailable');
      expect(typeof result.latency_ms).toBe('number');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBe('Connection refused');
      expect(result.error_code).toBeUndefined();
    });

    it('returns unavailable with error when request times out', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TimeoutError('Request timed out', 'GET', 5000)
      );

      const result = await provider.checkHealth();

      expect(result.status).toBe('unavailable');
      expect(typeof result.latency_ms).toBe('number');
      expect(result.error).toBeDefined();
      expect(result.error_code).toBeUndefined();
    });

    it('returns error with ERR_SSRF_BLOCKED when SSRF protection blocks the request', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new SsrfError('SSRF blocked', 'http://localhost:8888/search', 'private network')
      );

      const result = await provider.checkHealth();

      expect(result.status).toBe('error');
      expect(typeof result.latency_ms).toBe('number');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error_code).toBe(ErrorCode.ERR_SSRF_BLOCKED);
      expect(result.error).toBeDefined();
    });

    it('latency_ms is measured in milliseconds (non-negative integer)', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
      });

      const before = Date.now();
      const result = await provider.checkHealth();
      const after = Date.now();

      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.latency_ms).toBeLessThanOrEqual(after - before + 10); // allow small jitter
    });

    it('returns unavailable for unexpected HTTP status codes', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 503,
      });

      const result = await provider.checkHealth();

      expect(result.status).toBe('unavailable');
      expect(result.error).toContain('503');
    });

    it('does not throw — always returns a structured result', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Unexpected internal error')
      );

      await expect(provider.checkHealth()).resolves.toBeDefined();
    });
  });
});

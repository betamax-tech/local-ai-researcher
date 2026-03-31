import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JinaReaderProvider } from './jinaReader.js';
import type { JinaReaderConfig } from '../domain/types.js';
import { HttpClient } from '../lib/http.js';
import { Logger } from '../lib/logger.js';
import {
  ReaderInvalidResponseError,
  ReaderTimeoutError,
  ReaderUnavailableError,
  TimeoutError,
  SsrfError,
  ErrorCode,
} from '../lib/errors.js';

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

function createConfig(): JinaReaderConfig {
  return {
    endpoint: 'https://r.jina.ai/',
    timeout: 15000,
  };
}

const TEST_URL = 'https://example.com/article';
const FULL_CONTENT = Array.from({ length: 35 }, (_, index) => `Line ${index + 1}`).join('\n');

describe('JinaReaderProvider', () => {
  let provider: JinaReaderProvider;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    provider = new JinaReaderProvider(createConfig(), mockHttpClient, createMockLogger());
  });

  describe('full-content default', () => {
    it('returns full content and content_mode full when no options are provided', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: TEST_URL,
          title: 'Test Article',
          content: FULL_CONTENT,
        },
      });

      const result = await provider.read(TEST_URL);

      expect(result.content_mode).toBe('full');
      expect(result.content_truncated).toBe(false);
      expect(result.truncation).toBeUndefined();
      expect(result.content).toBe(FULL_CONTENT);
      expect(result.content).toContain('Line 35');
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        `https://r.jina.ai/${TEST_URL}`,
        expect.objectContaining({ timeout: 15000 })
      );
    });

    it('does not implicitly trim content to the 30-line excerpt in full mode', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: TEST_URL,
          title: 'Test Article',
          content: FULL_CONTENT,
        },
      });

      const result = await provider.read(TEST_URL, { content_mode: 'full' });

      expect(result.content).toContain('Line 35');
      expect(result.content?.endsWith('\n...')).toBe(false);
      expect(result.content_truncated).toBe(false);
    });
  });

  describe('explicit excerpt mode', () => {
    it('returns truncated content with explicit excerpt metadata', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: TEST_URL,
          title: 'Test Article',
          content: FULL_CONTENT,
        },
      });

      const result = await provider.read(TEST_URL, { content_mode: 'excerpt' });

      expect(result.content_mode).toBe('excerpt');
      expect(result.content_truncated).toBe(true);
      expect(result.truncation).toEqual({
        applied_limit: 30,
        reason: 'explicit_excerpt',
      });
      expect(result.content).toContain('Line 30');
      expect(result.content).not.toContain('Line 35');
      expect(result.content?.endsWith('\n...')).toBe(true);
    });

    it('uses targetWords when excerpt mode requests a word-based limit', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: TEST_URL,
          title: 'Test Article',
          content: 'one two three four five six seven',
        },
      });

      const result = await provider.read(TEST_URL, {
        content_mode: 'excerpt',
        targetWords: 3,
      });

      expect(result.content).toBe('one two three...');
      expect(result.content_truncated).toBe(true);
      expect(result.truncation).toEqual({
        applied_limit: 3,
        reason: 'explicit_excerpt',
      });
    });
  });

  describe('request shaping', () => {
    it('passes language query param and auth header through to Jina', async () => {
      const providerWithAuth = new JinaReaderProvider(
        { ...createConfig(), apiKey: 'secret-key' },
        mockHttpClient,
        createMockLogger()
      );

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: TEST_URL,
          title: 'Test Article',
          content: FULL_CONTENT,
        },
      });

      await providerWithAuth.read(TEST_URL, { language: 'en' });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        `https://r.jina.ai/${TEST_URL}?language=en`,
        expect.objectContaining({
          timeout: 15000,
          headers: expect.objectContaining({
            'Accept': 'application/json',
            'Authorization': 'Bearer secret-key',
          }),
        })
      );
    });
  });

  describe('public cloud wrapped response shape (r.jina.ai)', () => {
    it('handles { code, data: { title, content, url } } envelope', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          code: 200,
          status: 20000,
          data: {
            title: 'Test Article',
            content: FULL_CONTENT,
            url: TEST_URL,
          },
        },
      });

      const result = await provider.read(TEST_URL);

      expect(result.content_mode).toBe('full');
      expect(result.content_truncated).toBe(false);
      expect(result.content).toBe(FULL_CONTENT);
      expect(result.title).toBe('Test Article');
    });

    it('logs a warning when the provider includes a warning field', async () => {
      const warnFn = vi.fn();
      const warnLogger = {
        debug: vi.fn(), info: vi.fn(), warn: warnFn, error: vi.fn(),
      } as unknown as Logger;
      const warnProvider = new JinaReaderProvider(createConfig(), mockHttpClient, warnLogger);

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          code: 200,
          status: 20000,
          data: {
            title: 'Cached Page',
            content: FULL_CONTENT,
            url: TEST_URL,
            warning: 'This is a cached snapshot.',
          },
        },
      });

      await warnProvider.read(TEST_URL);

      expect(warnFn).toHaveBeenCalledWith(
        'Jina Reader provider warning',
        expect.objectContaining({ warning: 'This is a cached snapshot.' })
      );
    });

    it('throws ReaderInvalidResponseError when wrapped data.content is missing', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: { code: 200, status: 20000, data: { url: TEST_URL, title: 'Broken' } },
      });

      await expect(provider.read(TEST_URL)).rejects.toBeInstanceOf(ReaderInvalidResponseError);
    });
  });

  describe('error mapping', () => {
    it('throws ReaderInvalidResponseError when content is missing (flat shape)', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: { url: TEST_URL, title: 'Broken' },
      });

      await expect(provider.read(TEST_URL)).rejects.toBeInstanceOf(ReaderInvalidResponseError);
    });

    it('maps TimeoutError to ReaderTimeoutError', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TimeoutError('timed out', 'reader.read', 15000)
      );

      await expect(provider.read(TEST_URL)).rejects.toBeInstanceOf(ReaderTimeoutError);
    });

    it('re-throws typed reader errors without double wrapping', async () => {
      const originalError = new ReaderUnavailableError('already wrapped', { url: TEST_URL });
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);

      await expect(provider.read(TEST_URL)).rejects.toBe(originalError);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 14.02: Degraded read detection
  // ---------------------------------------------------------------------------

  describe('degraded read detection (task 14.02)', () => {
    it('flags read as degraded when wordCount < 20', async () => {
      // Arrange: mock provider response with exactly 15 words
      const shortContent = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: TEST_URL,
          title: 'Short Article',
          content: shortContent,
        },
      });

      // Act
      const result = await provider.read(TEST_URL);

      // Assert: wordCount is 15 and degraded is true
      expect(result.wordCount).toBe(15);
      expect(result.degraded).toBe(true);
    });

    it('does not flag read as degraded when wordCount >= 20', async () => {
      // Arrange: mock provider response with 50 words (FULL_CONTENT has 70 words)
      const normalContent = Array.from({ length: 50 }, (_, i) => `word${i + 1}`).join(' ');
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: TEST_URL,
          title: 'Normal Article',
          content: normalContent,
        },
      });

      // Act
      const result = await provider.read(TEST_URL);

      // Assert: wordCount is 50 and degraded is false (or absent/falsy)
      expect(result.wordCount).toBe(50);
      expect(result.degraded).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 14.03: JS-heavy page tuning (jsOptions)
  // ---------------------------------------------------------------------------

  describe('JS-heavy page tuning (jsOptions)', () => {
    // Shared mock response builder — enough words to avoid degraded flag
    function mockRichResponse() {
      const richContent = Array.from({ length: 110 }, (_, i) => `word${i + 1}`).join(' ');
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: { url: TEST_URL, title: 'JS Article', content: richContent },
      });
    }

    it('sends X-Timeout header when jsOptions.timeout is set', async () => {
      // Arrange: mock a rich response so the call succeeds
      mockRichResponse();

      // Act: pass jsOptions with a timeout value
      await provider.read(TEST_URL, { jsOptions: { timeout: 30 } } as any);

      // Assert: HTTP client was called with X-Timeout: '30' in headers
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Timeout': '30' }),
        })
      );
    });

    it('sends X-Wait-For-Selector header when jsOptions.waitForSelector is set', async () => {
      // Arrange
      mockRichResponse();

      // Act
      await provider.read(TEST_URL, { jsOptions: { waitForSelector: '.main-content' } } as any);

      // Assert: X-Wait-For-Selector header contains the exact selector string
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Wait-For-Selector': '.main-content' }),
        })
      );
    });

    it('sends X-With-Links-Summary header when jsOptions.withLinksSummary is true', async () => {
      // Arrange
      mockRichResponse();

      // Act
      await provider.read(TEST_URL, { jsOptions: { withLinksSummary: true } } as any);

      // Assert: X-With-Links-Summary header is present and set to 'true'
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-With-Links-Summary': 'true' }),
        })
      );
    });

    it('sends X-Return-Format header when jsOptions.returnFormat is set', async () => {
      // Arrange
      mockRichResponse();

      // Act
      await provider.read(TEST_URL, { jsOptions: { returnFormat: 'text' } } as any);

      // Assert: X-Return-Format header is set to 'text'
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Return-Format': 'text' }),
        })
      );
    });

    it('does not send JS tuning headers when jsOptions is absent', async () => {
      // Arrange: a plain read with no options at all
      mockRichResponse();

      // Act: call read() without any options
      await provider.read(TEST_URL);

      // Assert: none of the JS-tuning headers are present in the HTTP call
      const [, callOptions] = (mockHttpClient.get as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers?: Record<string, string> }];
      const sentHeaders = callOptions?.headers ?? {};
      expect(sentHeaders).not.toHaveProperty('X-Timeout');
      expect(sentHeaders).not.toHaveProperty('X-Wait-For-Selector');
      expect(sentHeaders).not.toHaveProperty('X-With-Links-Summary');
      expect(sentHeaders).not.toHaveProperty('X-Return-Format');
    });

    it('still marks read as degraded when JS-heavy response has < 20 words despite jsOptions', async () => {
      // Arrange: jsOptions are present, but the response content is sparse (5 words)
      const sparseContent = 'one two three four five';
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: { url: TEST_URL, title: 'Sparse JS Article', content: sparseContent },
      });

      // Act: read with jsOptions — tuning applied but content still short
      const result = await provider.read(TEST_URL, { jsOptions: { timeout: 30 } } as any);

      // Assert: degraded flag is true because wordCount < 20, regardless of jsOptions
      expect(result.wordCount).toBe(5);
      expect(result.degraded).toBe(true);
    });

    it('propagates errors correctly when jsOptions is present', async () => {
      // Arrange: HTTP layer throws even with jsOptions set
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ReaderUnavailableError('upstream failure', { url: TEST_URL })
      );

      // Act + Assert: error propagates normally; jsOptions do not swallow it
      await expect(
        provider.read(TEST_URL, { jsOptions: { timeout: 30 } } as any)
      ).rejects.toBeInstanceOf(ReaderUnavailableError);
    });
  });

  describe('checkHealth', () => {
    it('returns connected on successful 200 response', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        body: {
          url: 'https://example.com',
          title: 'Example',
          content: 'Hello world',
        },
      });

      const result = await provider.checkHealth();

      expect(result.status).toBe('connected');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(result.error_code).toBeUndefined();
    });

    it('returns degraded on slow response (>2000ms)', async () => {
      vi.useFakeTimers();
      
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(2100);
        return {
          status: 200,
          body: {
            url: 'https://example.com',
            title: 'Example',
            content: 'Hello world',
          },
        };
      });

      const result = await provider.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.latency_ms).toBeGreaterThanOrEqual(2000);
      expect(result.error).toBeUndefined();
      expect(result.error_code).toBeUndefined();

      vi.useRealTimers();
    });

    it('returns unavailable on connection failure', async () => {
      const networkError = new Error('ECONNREFUSED');
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(networkError);

      const result = await provider.checkHealth();

      expect(result.status).toBe('unavailable');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toContain('ECONNREFUSED');
      expect(result.error_code).toBeUndefined();
    });

    it('returns unavailable on timeout', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TimeoutError('timed out', 'reader.health', 5000)
      );

      const result = await provider.checkHealth();

      expect(result.status).toBe('unavailable');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toContain('timed out');
      expect(result.error_code).toBeUndefined();
    });

    it('returns error with ERR_SSRF_BLOCKED on SSRF block', async () => {
      const ssrfError = new SsrfError(
        'SSRF protection blocked request',
        'https://r.jina.ai/https://example.com',
        'private_network'
      );
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(ssrfError);

      const result = await provider.checkHealth();

      expect(result.status).toBe('error');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toContain('SSRF protection blocked request');
      expect(result.error_code).toBe(ErrorCode.ERR_SSRF_BLOCKED);
    });

    it('returns unavailable on non-200 HTTP status', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 503,
        body: {},
      });

      const result = await provider.checkHealth();

      expect(result.status).toBe('unavailable');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toContain('Unexpected HTTP status: 503');
      expect(result.error_code).toBeUndefined();
    });
  });
});

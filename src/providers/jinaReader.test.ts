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
          headers: { Authorization: 'Bearer secret-key' },
        })
      );
    });
  });

  describe('error mapping', () => {
    it('throws ReaderInvalidResponseError when content is missing', async () => {
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
});

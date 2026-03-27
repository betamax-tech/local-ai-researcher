/**
 * Tests for search tool — locked v1 contract.
 *
 * Tests verify:
 * 1. Envelope shape (schema_version, ok, meta, result/error)
 * 2. ResponseMeta fields on success and failure
 * 3. Provider provenance in meta
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSearchTool, SearchInputSchema } from './search.js';
import type { SearchResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearxngProvider } from '../providers/searxng.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockSearchProvider(results: SearchResult[]): SearxngProvider {
  return {
    name: 'MockSearxNG',
    isHealthy: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue(results),
  } as unknown as SearxngProvider;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

function createTestSearchResults(): SearchResult[] {
  return [
    {
      id: 'test-id-1',
      url: 'https://example.com/article1',
      title: 'First Article',
      excerpt: 'Excerpt 1',
      source: 'web',
    },
    {
      id: 'test-id-2',
      url: 'https://example.com/article2',
      title: 'Second Article',
      excerpt: 'Excerpt 2',
      source: 'web',
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchInputSchema', () => {
  it('validates required query field', () => {
    const result = SearchInputSchema.safeParse({ query: 'test query' });
    expect(result.success).toBe(true);
  });

  it('applies default values', () => {
    const result = SearchInputSchema.parse({ query: 'test' });
    expect(result.limit).toBe(5);
    expect(result.fullText).toBe(false);
  });

  it('rejects empty query', () => {
    const result = SearchInputSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('rejects query longer than 500 chars', () => {
    const result = SearchInputSchema.safeParse({ query: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('validates limit bounds', () => {
    expect(SearchInputSchema.safeParse({ query: 'test', limit: 0 })?.success).toBe(false);
    expect(SearchInputSchema.safeParse({ query: 'test', limit: 51 })?.success).toBe(false);
    expect(SearchInputSchema.safeParse({ query: 'test', limit: 10 })?.success).toBe(true);
  });
});

describe('createSearchTool', () => {
  let mockSearchProvider: SearxngProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSearchProvider = createMockSearchProvider(createTestSearchResults());
    mockLogger = createMockLogger();
  });

  describe('envelope shape', () => {
    it('returns valid envelope with ok: true on success', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test query' });

      expect(response.isError).toBeUndefined();
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.schema_version).toBe(SCHEMA_VERSION);
      expect(envelope.ok).toBe(true);
      expect(envelope.result).toBeDefined();
    });

    it('includes results array and total count', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.results).toBeDefined();
      expect(Array.isArray(envelope.result.results)).toBe(true);
      expect(envelope.result.total).toBe(2);
    });

    it('returns error envelope when search fails', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Search failed')
      );
      
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      expect(response.isError).toBe(true);
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.ok).toBe(false);
      expect(envelope.error).toBeDefined();
    });
  });

  describe('ResponseMeta contract (task 07.02)', () => {
    it('includes meta object on success', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('includes meta object on failure', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Search failed')
      );
      
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('meta has required request_id (UUID v4)', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.request_id).toBeDefined();
      expect(typeof envelope.meta.request_id).toBe('string');
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(envelope.meta.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('meta has ISO-8601 timestamp', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const beforeTime = new Date();
      const response = await tool.handler({ query: 'test' });
      const afterTime = new Date();

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.timestamp).toBeDefined();
      
      const timestamp = new Date(envelope.meta.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
    });

    it('meta has provider_id for SearxNG', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_id).toBe('searxng');
    });

    it('meta has provider_name for SearxNG', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_name).toBe('SearXNG');
    });

    it('meta has applied_limits object', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test', limit: 10 });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits).toBeDefined();
      expect(typeof envelope.meta.applied_limits).toBe('object');
    });

    it('meta.applied_limits includes max_results when specified', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test', limit: 10 });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits.max_results).toBe(10);
    });

    it('meta.applied_limits includes timeout_ms when configured', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      // Provider default timeout is 10000ms
      expect(envelope.meta.applied_limits.timeout_ms).toBeDefined();
      expect(typeof envelope.meta.applied_limits.timeout_ms).toBe('number');
    });

    it('generates unique request_id for each call', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response1 = await tool.handler({ query: 'test1' });
      const response2 = await tool.handler({ query: 'test2' });

      const envelope1 = JSON.parse(response1.content[0]?.text ?? '{}');
      const envelope2 = JSON.parse(response2.content[0]?.text ?? '{}');

      expect(envelope1.meta.request_id).not.toBe(envelope2.meta.request_id);
    });

    it('failure response preserves meta fields for debugging', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Search failed')
      );
      
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.ok).toBe(false);
      expect(envelope.meta.request_id).toBeDefined();
      expect(envelope.meta.timestamp).toBeDefined();
      expect(envelope.meta.provider_id).toBeDefined();
      expect(envelope.meta.provider_name).toBeDefined();
    });
  });
});

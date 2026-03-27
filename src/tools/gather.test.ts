/**
 * Tests for gather tool — locked v1 contract.
 *
 * Tests verify:
 * 1. Envelope shape (schema_version, ok, result/error)
 * 2. Request-scoped dedup behavior
 * 3. Summary statistics accuracy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGatherTool, GatherInputSchema } from './gather.js';
import type { SearchResult, ReadResult, GatherResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearxngProvider } from '../providers/searxng.js';
import type { JinaReaderProvider } from '../providers/jinaReader.js';
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

function createMockReadProvider(results: Map<string, ReadResult>): JinaReaderProvider {
  return {
    name: 'MockJinaReader',
    isHealthy: vi.fn().mockResolvedValue(true),
    canRead: vi.fn().mockReturnValue(true),
    read: vi.fn().mockImplementation(async (url: string) => {
      const result = results.get(url);
      if (!result) {
        throw new Error(`No mock result for ${url}`);
      }
      return result;
    }),
  } as unknown as JinaReaderProvider;
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
    {
      id: 'test-id-3',
      url: 'https://example.com/article3',
      title: 'Third Article',
      excerpt: 'Excerpt 3',
      source: 'web',
    },
  ];
}

function createTestReadResults(): Map<string, ReadResult> {
  return new Map([
    ['https://example.com/article1', {
      url: 'https://example.com/article1',
      title: 'First Article',
      excerpt: 'Content excerpt 1',
      content: 'Full content 1',
    }],
    ['https://example.com/article2', {
      url: 'https://example.com/article2',
      title: 'Second Article',
      excerpt: 'Content excerpt 2',
      content: 'Full content 2',
    }],
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GatherInputSchema', () => {
  it('validates required query field', () => {
    const result = GatherInputSchema.safeParse({ query: 'test query' });
    expect(result.success).toBe(true);
  });

  it('applies default values', () => {
    const result = GatherInputSchema.parse({ query: 'test' });
    expect(result.maxResults).toBe(5);
    expect(result.dedup).toBe(true);
    expect(result.fullText).toBe(false);
    expect(result.timeout).toBe(10000);
  });

  it('rejects empty query', () => {
    const result = GatherInputSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('rejects query longer than 500 chars', () => {
    const result = GatherInputSchema.safeParse({ query: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('validates maxResults bounds', () => {
    expect(GatherInputSchema.safeParse({ query: 'test', maxResults: 0 })?.success).toBe(false);
    expect(GatherInputSchema.safeParse({ query: 'test', maxResults: 21 })?.success).toBe(false);
    expect(GatherInputSchema.safeParse({ query: 'test', maxResults: 10 })?.success).toBe(true);
  });
});

describe('createGatherTool', () => {
  let mockSearchProvider: SearxngProvider;
  let mockReadProvider: JinaReaderProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSearchProvider = createMockSearchProvider(createTestSearchResults());
    mockReadProvider = createMockReadProvider(createTestReadResults());
    mockLogger = createMockLogger();
  });

  describe('envelope shape', () => {
    it('returns valid envelope with ok: true on success', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test query' });

      expect(response.isError).toBeUndefined();
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.schema_version).toBe(SCHEMA_VERSION);
      expect(envelope.ok).toBe(true);
      expect(envelope.result).toBeDefined();
    });

    it('includes GatherResult with required fields', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
      expect(result.prompt).toBe('test');
      expect(result.context).toBeDefined();
      expect(result.context.sources).toBeDefined();
      expect(result.context.results).toBeDefined();
      expect(result.context.reads).toBeDefined();
      expect(result.context.dedupStats).toBeDefined();
      expect(result.synthesis).toBeDefined();
      expect(typeof result.synthesis).toBe('string');
      expect(result.summary).toBeDefined();
    });

    it('summary has accurate statistics', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      expect(result.summary.totalResults).toBe(3);
      expect(result.summary.attemptedReads).toBe(3);
      expect(result.summary.successfulReads).toBeGreaterThanOrEqual(0);
      expect(result.summary.failedReads).toBeGreaterThanOrEqual(0);
      expect(result.summary.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('returns error envelope when search returns no results', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      expect(response.isError).toBe(true);
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.ok).toBe(false);
      expect(envelope.error).toBeDefined();
      expect(envelope.error?.code).toBe('ERR_GATHER_NO_SOURCES');
      expect(envelope.error?.retryable).toBe(false);
    });
  });

  describe('request-scoped dedup', () => {
    it('deduplicates equivalent URLs by default', async () => {
      // URLs that canonicalize to the same form (case-sensitive paths!)
      const resultsWithDupes: SearchResult[] = [
        {
          id: 'test-id-1',
          url: 'https://example.com/article',
          title: 'Article',
          excerpt: 'Content',
          source: 'web',
        },
        {
          id: 'test-id-2',
          url: 'https://www.example.com/article/', // Same canonical (www stripped, trailing slash removed)
          title: 'Same Article',
          excerpt: 'Duplicate content',
          source: 'web',
        },
        {
          id: 'test-id-3',
          url: 'https://example.com/article#section', // Same canonical (fragment stripped)
          title: 'Same Again',
          excerpt: 'Another duplicate',
          source: 'web',
        },
      ];

      mockSearchProvider = createMockSearchProvider(resultsWithDupes);
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test', dedup: true });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      // Should have deduped to 1 unique URL
      expect(result.context.dedupStats.total).toBe(3);
      expect(result.context.dedupStats.deduped).toBe(2);
      expect(result.summary.attemptedReads).toBe(1);
    });

    it('disables dedup when dedup: false', async () => {
      const resultsWithDupes: SearchResult[] = [
        {
          id: 'test-id-1',
          url: 'https://example.com/article',
          title: 'Article 1',
          excerpt: 'Content',
          source: 'web',
        },
        {
          id: 'test-id-2',
          url: 'https://example.com/article/', // Would be deduped if enabled
          title: 'Article 2',
          excerpt: 'Content',
          source: 'web',
        },
      ];

      mockSearchProvider = createMockSearchProvider(resultsWithDupes);
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test', dedup: false });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      // No deduplication applied
      expect(result.context.dedupStats.deduped).toBe(0);
      expect(result.summary.attemptedReads).toBe(2);
    });
  });

  describe('synthesis block', () => {
    it('includes query and result count', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'my research topic' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      expect(result.synthesis).toContain('my research topic');
      expect(result.synthesis).toContain('3 result(s)');
    });

    it('includes titles and URLs for each result', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      expect(result.synthesis).toContain('First Article');
      expect(result.synthesis).toContain('https://example.com/article1');
    });
  });

  describe('fullText option', () => {
    it('requests full text when fullText: true', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      await tool.handler({ query: 'test', fullText: true });

      // Verify read was called with fullText: true
      expect(mockReadProvider.read).toHaveBeenCalledWith(
        'https://example.com/article1',
        expect.objectContaining({ fullText: true })
      );
    });

    it('requests excerpts by default (fullText: false)', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      await tool.handler({ query: 'test', fullText: false });

      expect(mockReadProvider.read).toHaveBeenCalledWith(
        expect.stringMatching(/example\.com/),
        expect.objectContaining({ fullText: false })
      );
    });
  });

  describe('partial failures', () => {
    it('continues with partial results when some reads fail', async () => {
      // Some reads will fail
      const readResults = new Map([
        ['https://example.com/article1', {
          url: 'https://example.com/article1',
          title: 'Article 1',
          excerpt: 'Content 1',
        }],
        // article2 will fail (not in map)
        ['https://example.com/article3', {
          url: 'https://example.com/article3',
          title: 'Article 3',
          excerpt: 'Content 3',
        }],
      ]);

      mockReadProvider = createMockReadProvider(readResults);
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      // Should still succeed with partial results
      expect(envelope.ok).toBe(true);
      expect(result.summary.successfulReads).toBe(2);
      expect(result.summary.failedReads).toBe(1);
    });
  });
});

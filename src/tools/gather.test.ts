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
      content_mode: 'full',
      content_truncated: false,
    }],
    ['https://example.com/article2', {
      url: 'https://example.com/article2',
      title: 'Second Article',
      excerpt: 'Content excerpt 2',
      content: 'Full content 2',
      content_mode: 'full',
      content_truncated: false,
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
    expect(result.content_mode).toBe('full');
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

  describe('content_mode option', () => {
    it('requests full content by default (content_mode: "full")', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      await tool.handler({ query: 'test' });

      // Verify read was called with content_mode: 'full'
      expect(mockReadProvider.read).toHaveBeenCalledWith(
        'https://example.com/article1',
        expect.objectContaining({ content_mode: 'full' })
      );
    });

    it('requests full content when content_mode: "full"', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      await tool.handler({ query: 'test', content_mode: 'full' });

      expect(mockReadProvider.read).toHaveBeenCalledWith(
        expect.stringMatching(/example\.com/),
        expect.objectContaining({ content_mode: 'full' })
      );
    });

    it('requests excerpts when content_mode: "excerpt"', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      await tool.handler({ query: 'test', content_mode: 'excerpt' });

      expect(mockReadProvider.read).toHaveBeenCalledWith(
        expect.stringMatching(/example\.com/),
        expect.objectContaining({ content_mode: 'excerpt' })
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
          content: 'Content 1',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        // article2 will fail (not in map)
        ['https://example.com/article3', {
          url: 'https://example.com/article3',
          title: 'Article 3',
          excerpt: 'Content 3',
          content: 'Content 3',
          content_mode: 'full' as const,
          content_truncated: false,
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

  describe('ResponseMeta contract (task 07.02)', () => {
    it('includes meta object on success', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('includes meta object on failure', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('meta has required request_id (UUID v4)', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
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
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const beforeTime = new Date();
      const response = await tool.handler({ query: 'test' });
      const afterTime = new Date();

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.timestamp).toBeDefined();
      
      const timestamp = new Date(envelope.meta.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
    });

    it('meta has provider_id for orchestrator', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_id).toBe('orchestrator');
    });

    it('meta has provider_name for orchestrator', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_name).toBe('Orchestrator');
    });

    it('meta has applied_limits object', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test', maxResults: 10, timeout: 15000 });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits).toBeDefined();
      expect(typeof envelope.meta.applied_limits).toBe('object');
    });

    it('meta.applied_limits includes max_results when specified', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test', maxResults: 10 });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits.max_results).toBe(10);
    });

    it('meta.applied_limits includes timeout_ms', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response = await tool.handler({ query: 'test', timeout: 15000 });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits.timeout_ms).toBe(15000);
    });

    it('generates unique request_id for each call', async () => {
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
      const response1 = await tool.handler({ query: 'test1' });
      const response2 = await tool.handler({ query: 'test2' });

      const envelope1 = JSON.parse(response1.content[0]?.text ?? '{}');
      const envelope2 = JSON.parse(response2.content[0]?.text ?? '{}');

      expect(envelope1.meta.request_id).not.toBe(envelope2.meta.request_id);
    });

    it('failure response preserves meta fields for debugging', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
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

/**
 * Tests for gather tool — locked v1 contract.
 *
 * Tests verify:
 * 1. Envelope shape (schema_version, ok, result/error)
 * 2. Request-scoped dedup behavior
 * 3. Summary statistics accuracy
 * 4. Contract coverage (task 10.02): dedup stats fields, structured+AI-ingestible payloads,
 *    full-content-default, truncation aggregation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGatherTool, GatherInputSchema } from './gather.js';
import type { SearchResult, ReadResult, GatherResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearxngProvider } from '../providers/searxng.js';
import type { JinaReaderProvider } from '../providers/jinaReader.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Fixture helpers (task 10.02 — contract against frozen v1 schema)
// ---------------------------------------------------------------------------

const __fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures');

function loadGatherFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__fixturesDir, `${name}.json`), 'utf-8')) as T;
}

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

// ---------------------------------------------------------------------------
// Task 10.02: Contract coverage against frozen v1 schema
// ---------------------------------------------------------------------------

describe('gather v1 contract coverage (task 10.02)', () => {
  // ---------------------------------------------------------------------------
  // Frozen fixture: dedup stats field names and semantics
  // ---------------------------------------------------------------------------

  describe('dedup stats — frozen v1 field names', () => {
    it('frozen gather-success fixture has context.dedupStats.total as a number', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      expect(typeof fixture.result.context.dedupStats.total).toBe('number');
    });

    it('frozen gather-success fixture has context.dedupStats.deduped as a number', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      expect(typeof fixture.result.context.dedupStats.deduped).toBe('number');
    });

    it('frozen fixture dedupStats.deduped is ≥ 0 and ≤ dedupStats.total', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      const { total, deduped } = fixture.result.context.dedupStats;
      expect(deduped).toBeGreaterThanOrEqual(0);
      expect(deduped).toBeLessThanOrEqual(total);
    });

    it('frozen fixture does NOT expose urls_deduped or urls_total (legacy field names excluded)', () => {
      // The v1 freeze uses dedupStats.total / dedupStats.deduped.
      // Old pre-freeze names (urls_deduped, urls_total) must not appear.
      const fixture = loadGatherFixture<Record<string, unknown>>('gather-success');
      const ctx = (fixture.result as GatherResult).context as Record<string, unknown>;
      expect(ctx).not.toHaveProperty('urls_deduped');
      expect(ctx).not.toHaveProperty('urls_total');
      const stats = ctx.dedupStats as Record<string, unknown>;
      expect(stats).not.toHaveProperty('urls_deduped');
      expect(stats).not.toHaveProperty('urls_total');
    });

    it('runtime tool produces dedupStats.total matching search result count', async () => {
      const searchResults = createTestSearchResults(); // 3 results
      const mockSearch = createMockSearchProvider(searchResults);
      const mockRead = createMockReadProvider(createTestReadResults());
      const tool = createGatherTool(mockSearch, mockRead, createMockLogger());

      const response = await tool.handler({ query: 'test', dedup: false });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      expect(result.context.dedupStats.total).toBe(searchResults.length);
    });

    it('runtime tool produces dedupStats.deduped === 0 when dedup: false', async () => {
      const mockSearch = createMockSearchProvider(createTestSearchResults());
      const mockRead = createMockReadProvider(createTestReadResults());
      const tool = createGatherTool(mockSearch, mockRead, createMockLogger());

      const response = await tool.handler({ query: 'test', dedup: false });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      expect(result.context.dedupStats.deduped).toBe(0);
    });

    it('runtime tool produces dedupStats.deduped > 0 when duplicates exist and dedup: true', async () => {
      const dupeResults: SearchResult[] = [
        { id: 'a', url: 'https://example.com/page', title: 'Page', excerpt: 'ex', source: 'web' },
        { id: 'b', url: 'https://example.com/page/', title: 'Page dupe', excerpt: 'ex', source: 'web' },
        { id: 'c', url: 'https://example.com/page#anchor', title: 'Page anchor', excerpt: 'ex', source: 'web' },
      ];
      const mockSearch = createMockSearchProvider(dupeResults);
      const mockRead = createMockReadProvider(new Map([
        ['https://example.com/page', {
          url: 'https://example.com/page',
          title: 'Page', excerpt: 'ex', content: 'content',
          content_mode: 'full' as const, content_truncated: false,
        }],
      ]));
      const tool = createGatherTool(mockSearch, mockRead, createMockLogger());

      const response = await tool.handler({ query: 'test', dedup: true });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      expect(result.context.dedupStats.total).toBe(3);
      expect(result.context.dedupStats.deduped).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Frozen fixture: structured output + AI-ingestible payload
  // ---------------------------------------------------------------------------

  describe('structured output and AI-ingestible payload — frozen v1 contract', () => {
    it('frozen gather-success fixture has context (structured output) as an object', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      expect(typeof fixture.result.context).toBe('object');
      expect(fixture.result.context).not.toBeNull();
    });

    it('frozen gather-success fixture has context.results array (structured search results)', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      expect(Array.isArray(fixture.result.context.results)).toBe(true);
      expect(fixture.result.context.results.length).toBeGreaterThan(0);
    });

    it('frozen gather-success fixture has context.reads array (structured read results)', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      expect(Array.isArray(fixture.result.context.reads)).toBe(true);
    });

    it('frozen gather-success fixture has synthesis string (AI-ingestible text payload)', () => {
      // The v1 AI-ingestible payload is `synthesis` — a pre-formatted string for LLM insertion.
      // This distinguishes it from `context` (structured/machine-readable).
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      expect(typeof fixture.result.synthesis).toBe('string');
      expect(fixture.result.synthesis.length).toBeGreaterThan(0);
    });

    it('frozen gather-success synthesis contains the prompt (AI-ingestible must be query-contextualized)', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      expect(fixture.result.synthesis).toContain(fixture.result.prompt);
    });

    it('runtime tool returns both context (structured) and synthesis (AI-ingestible) on success', async () => {
      const tool = createGatherTool(
        createMockSearchProvider(createTestSearchResults()),
        createMockReadProvider(createTestReadResults()),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'test query' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      // Structured output — machine-readable context
      expect(result.context).toBeDefined();
      expect(typeof result.context).toBe('object');
      expect(Array.isArray(result.context.results)).toBe(true);
      expect(Array.isArray(result.context.reads)).toBe(true);
      expect(Array.isArray(result.context.sources)).toBe(true);
      expect(result.context.dedupStats).toBeDefined();

      // AI-ingestible payload — pre-formatted text for LLM insertion
      expect(typeof result.synthesis).toBe('string');
      expect(result.synthesis.length).toBeGreaterThan(0);
      expect(result.synthesis).toContain('test query');
    });

    it('synthesis is absent on failure envelope (AI-ingestible only present on ok:true)', async () => {
      // When gather fails, only error is present — no synthesis
      const tool = createGatherTool(
        createMockSearchProvider([]),
        createMockReadProvider(new Map()),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'test' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.ok).toBe(false);
      expect(envelope.result).toBeUndefined();
      // No synthesis on failure
      expect(envelope.synthesis).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Full-content-default behavior — frozen v1 contract
  // ---------------------------------------------------------------------------

  describe('full-content-default behavior — frozen v1 contract', () => {
    it('frozen gather-success fixture reads all have content_mode: "full"', () => {
      // The v1 contract mandates full content by default — no excerpt-first behavior.
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      for (const read of fixture.result.context.reads) {
        expect(read.content_mode).toBe('full');
      }
    });

    it('frozen gather-success fixture reads have content field populated', () => {
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      for (const read of fixture.result.context.reads) {
        expect(typeof read.content).toBe('string');
        expect((read.content ?? '').length).toBeGreaterThan(0);
      }
    });

    it('GatherInputSchema default content_mode is "full" (not excerpt)', () => {
      // Frozen v1 default must be full content — never excerpt-first.
      const parsed = GatherInputSchema.parse({ query: 'test' });
      expect(parsed.content_mode).toBe('full');
    });

    it('runtime tool passes content_mode: "full" to reader by default', async () => {
      const mockRead = createMockReadProvider(createTestReadResults());
      const tool = createGatherTool(
        createMockSearchProvider(createTestSearchResults()),
        mockRead,
        createMockLogger()
      );

      await tool.handler({ query: 'test' }); // no content_mode specified — should default to full

      expect(mockRead.read).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ content_mode: 'full' })
      );
    });

    it('runtime tool with explicit content_mode: "full" does not use excerpt behavior', async () => {
      const mockRead = createMockReadProvider(createTestReadResults());
      const tool = createGatherTool(
        createMockSearchProvider(createTestSearchResults()),
        mockRead,
        createMockLogger()
      );

      await tool.handler({ query: 'test', content_mode: 'full' });

      // Every read must be called with full, not excerpt
      const calls = (mockRead.read as ReturnType<typeof vi.fn>).mock.calls;
      for (const [, opts] of calls) {
        expect((opts as { content_mode: string }).content_mode).toBe('full');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Truncation aggregation — frozen v1 contract
  // ---------------------------------------------------------------------------

  describe('truncation aggregation — frozen v1 contract', () => {
    it('frozen gather-success fixture reads have content_truncated: false (no hidden truncation)', () => {
      // Invariant: the fixture was authored with explicit truncation state — never hidden.
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      for (const read of fixture.result.context.reads) {
        // content_truncated must be a boolean (explicit, not undefined)
        expect(typeof read.content_truncated).toBe('boolean');
      }
    });

    it('frozen gather-success fixture summary.failedReads + successfulReads === attemptedReads', () => {
      // The summary arithmetic must be consistent in the frozen fixture.
      const fixture = loadGatherFixture<{ result: GatherResult }>('gather-success');
      const s = fixture.result.summary;
      expect(s.successfulReads + s.failedReads).toBe(s.attemptedReads);
    });

    it('runtime tool counts truncated reads separately from failed reads', async () => {
      // A read with content_truncated: true is still a SUCCESSFUL read (not failed).
      // This verifies gather aggregates truncation without inflating failedReads.
      const truncatedRead: ReadResult = {
        url: 'https://example.com/article1',
        title: 'Article 1',
        excerpt: 'Excerpt',
        content: 'Truncated content...',
        content_mode: 'full',
        content_truncated: true,
        truncation: { applied_limit: 50000, reason: 'provider_limit' },
      };
      const readMap = new Map<string, ReadResult>([
        ['https://example.com/article1', truncatedRead],
        ['https://example.com/article2', {
          url: 'https://example.com/article2',
          title: 'Article 2',
          excerpt: 'Excerpt',
          content: 'Full content',
          content_mode: 'full',
          content_truncated: false,
        }],
        ['https://example.com/article3', {
          url: 'https://example.com/article3',
          title: 'Article 3',
          excerpt: 'Excerpt',
          content: 'Full content',
          content_mode: 'full',
          content_truncated: false,
        }],
      ]);

      const tool = createGatherTool(
        createMockSearchProvider(createTestSearchResults()),
        createMockReadProvider(readMap),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'test' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      // Truncated read is successful — not failed
      expect(result.summary.successfulReads).toBe(3);
      expect(result.summary.failedReads).toBe(0);
      expect(result.summary.attemptedReads).toBe(3);
    });

    it('runtime tool summary fields are all non-negative numbers', async () => {
      const tool = createGatherTool(
        createMockSearchProvider(createTestSearchResults()),
        createMockReadProvider(createTestReadResults()),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'test' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const s = (envelope.result as GatherResult).summary;

      expect(s.totalResults).toBeGreaterThanOrEqual(0);
      expect(s.attemptedReads).toBeGreaterThanOrEqual(0);
      expect(s.successfulReads).toBeGreaterThanOrEqual(0);
      expect(s.failedReads).toBeGreaterThanOrEqual(0);
      expect(s.totalDuration).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 14.02: Degraded reads — AC3 and AC4
  // ---------------------------------------------------------------------------

  describe('degraded reads in summary (task 14.02)', () => {
    it('reports degraded reads separately in summary', async () => {
      // Arrange: 3 reads — 1 degraded (~15 words), 2 normal (~50 words each)
      // degradedReads field doesn't exist on GatherResult.summary yet — RED until 14.02
      const mixedReadResults = new Map<string, ReadResult>([
        ['https://example.com/article1', {
          url: 'https://example.com/article1',
          title: 'Short Article',
          excerpt: 'short',
          content: Array.from({ length: 15 }, (_, i) => `word${i + 1}`).join(' '),
          content_mode: 'full' as const,
          content_truncated: false,
          wordCount: 15,
          degraded: true, // AC1: <20 words → degraded
        } as ReadResult],
        ['https://example.com/article2', {
          url: 'https://example.com/article2',
          title: 'Normal Article 2',
          excerpt: 'normal content',
          content: Array.from({ length: 50 }, (_, i) => `word${i + 1}`).join(' '),
          content_mode: 'full' as const,
          content_truncated: false,
          wordCount: 50,
          degraded: false,
        } as ReadResult],
        ['https://example.com/article3', {
          url: 'https://example.com/article3',
          title: 'Normal Article 3',
          excerpt: 'normal content',
          content: Array.from({ length: 50 }, (_, i) => `content${i + 1}`).join(' '),
          content_mode: 'full' as const,
          content_truncated: false,
          wordCount: 50,
          degraded: false,
        } as ReadResult],
      ]);

      const tool = createGatherTool(
        createMockSearchProvider(createTestSearchResults()), // 3 search results
        createMockReadProvider(mixedReadResults),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'test' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      // AC3: degradedReads = 1, successfulReads = 2 (excludes degraded), context.reads still has all 3
      expect(result.summary.degradedReads).toBe(1);
      expect(result.summary.successfulReads).toBe(2);
      expect(result.context.reads).toHaveLength(3);
    });

    it('counts normal reads as successful when wordCount >= 20', async () => {
      // Arrange: 2 reads, both ~50 words — no degraded reads
      const normalReadResults = new Map<string, ReadResult>([
        ['https://example.com/article1', {
          url: 'https://example.com/article1',
          title: 'Normal Article 1',
          excerpt: 'normal content',
          content: Array.from({ length: 50 }, (_, i) => `word${i + 1}`).join(' '),
          content_mode: 'full' as const,
          content_truncated: false,
          wordCount: 50,
          degraded: false,
        } as ReadResult],
        ['https://example.com/article2', {
          url: 'https://example.com/article2',
          title: 'Normal Article 2',
          excerpt: 'normal content',
          content: Array.from({ length: 50 }, (_, i) => `content${i + 1}`).join(' '),
          content_mode: 'full' as const,
          content_truncated: false,
          wordCount: 50,
          degraded: false,
        } as ReadResult],
      ]);

      const twoResults: SearchResult[] = [
        { id: 'id-1', url: 'https://example.com/article1', title: 'Article 1', excerpt: 'ex', source: 'web' },
        { id: 'id-2', url: 'https://example.com/article2', title: 'Article 2', excerpt: 'ex', source: 'web' },
      ];

      const tool = createGatherTool(
        createMockSearchProvider(twoResults),
        createMockReadProvider(normalReadResults),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'test' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: GatherResult = envelope.result;

      // AC4: no degraded reads, all 2 count as successful
      expect(result.summary.degradedReads).toBe(0);
      expect(result.summary.successfulReads).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Failure paths — frozen v1 contract
  // ---------------------------------------------------------------------------

  describe('failure paths — frozen v1 contract', () => {
    it('frozen gather-failure-partial fixture has error.code ERR_GATHER_NO_SOURCES', () => {
      const fixture = loadGatherFixture<{ ok: boolean; error?: { code: string; retryable: boolean } }>('gather-failure-partial');
      expect(fixture.ok).toBe(false);
      expect(fixture.error?.code).toBe('ERR_GATHER_NO_SOURCES');
    });

    it('frozen gather-failure-partial fixture error.retryable is false', () => {
      const fixture = loadGatherFixture<{ error?: { retryable: boolean } }>('gather-failure-partial');
      expect(fixture.error?.retryable).toBe(false);
    });

    it('frozen gather-failure-partial fixture has meta (traceability on failure)', () => {
      const fixture = loadGatherFixture<{
        meta?: { request_id: string; provider_id: string };
      }>('gather-failure-partial');
      expect(fixture.meta).toBeDefined();
      expect(typeof fixture.meta?.request_id).toBe('string');
      expect(fixture.meta?.provider_id).toBe('orchestrator');
    });

    it('runtime tool returns ERR_GATHER_NO_SOURCES when search returns empty results', async () => {
      const tool = createGatherTool(
        createMockSearchProvider([]),
        createMockReadProvider(new Map()),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'empty query' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe('ERR_GATHER_NO_SOURCES');
      expect(envelope.error.retryable).toBe(false);
      expect(envelope.meta).toBeDefined();
      expect(envelope.meta.provider_id).toBe('orchestrator');
    });

    it('runtime tool failure envelope has schema_version "1"', async () => {
      const tool = createGatherTool(
        createMockSearchProvider([]),
        createMockReadProvider(new Map()),
        createMockLogger()
      );

      const response = await tool.handler({ query: 'test' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.schema_version).toBe(SCHEMA_VERSION);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 14.04: Synthesis quality — degraded-read handling, relevance ordering,
// content deduplication
// ---------------------------------------------------------------------------

describe('synthesis quality (task 14.04)', () => {
  // Helper: run gather and extract envelope + result + synthesis
  async function runGather(
    searchResults: SearchResult[],
    readResults: Map<string, ReadResult>,
    query: string = 'test query',
  ): Promise<{ envelope: Record<string, unknown>; result: GatherResult; synthesis: string }> {
    const tool = createGatherTool(
      createMockSearchProvider(searchResults),
      createMockReadProvider(readResults),
      createMockLogger(),
    );
    const response = await tool.handler({ query });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');
    return {
      envelope: envelope as Record<string, unknown>,
      result: (envelope as { result: GatherResult }).result,
      synthesis: (envelope as { result: GatherResult }).result.synthesis,
    };
  }

  // -------------------------------------------------------------------------
  // Degraded-read handling
  // -------------------------------------------------------------------------

  describe('degraded-read handling', () => {
    // AC4: degraded reads excluded from primary synthesis body
    it('excludes degraded reads from primary synthesis body', async () => {
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://deg-test.com/a', title: 'Degraded Article', excerpt: 'deg excerpt', source: 'web' },
        { id: 's2', url: 'https://deg-test.com/b', title: 'Normal Article', excerpt: 'normal excerpt', source: 'web' },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://deg-test.com/a', {
          url: 'https://deg-test.com/a',
          title: 'Degraded Article',
          excerpt: 'SHORT_DEGRADED_MARKER',
          content: 'SHORT_DEGRADED_MARKER',
          content_mode: 'full' as const,
          content_truncated: false,
          degraded: true,
        } as ReadResult],
        ['https://deg-test.com/b', {
          url: 'https://deg-test.com/b',
          title: 'Normal Article',
          excerpt: 'normal excerpt',
          content: 'NORMAL_CONTENT_MARKER_XYZ',
          content_mode: 'full' as const,
          content_truncated: false,
          degraded: false,
        } as ReadResult],
      ]);

      const { synthesis } = await runGather(searchResults, readResults);

      // Degraded content must NOT appear in synthesis body
      expect(synthesis).not.toContain('SHORT_DEGRADED_MARKER');
      // Normal content must appear
      expect(synthesis).toContain('NORMAL_CONTENT_MARKER_XYZ');
    });

    // AC4: degraded visibility section present when degraded reads exist
    it('includes degraded visibility section when degraded reads exist', async () => {
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://deg-vis.com/a', title: 'Degraded', excerpt: 'deg', source: 'web' },
        { id: 's2', url: 'https://deg-vis.com/b', title: 'Normal', excerpt: 'norm', source: 'web' },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://deg-vis.com/a', {
          url: 'https://deg-vis.com/a',
          title: 'Degraded',
          excerpt: 'degraded content',
          content: 'degraded content',
          content_mode: 'full' as const,
          content_truncated: false,
          degraded: true,
        } as ReadResult],
        ['https://deg-vis.com/b', {
          url: 'https://deg-vis.com/b',
          title: 'Normal',
          excerpt: 'normal',
          content: 'normal content marker',
          content_mode: 'full' as const,
          content_truncated: false,
          degraded: false,
        } as ReadResult],
      ]);

      const { synthesis } = await runGather(searchResults, readResults);

      // A "Degraded Sources" section must be present in the output
      expect(synthesis).toContain('Degraded Sources');
    });

    // AC5: all-degraded case — empty body, explicit degraded section, ok:true
    it('handles all-degraded case with empty body and explicit degraded section', async () => {
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://all-deg.com/a', title: 'All Degraded 1', excerpt: 'd1', source: 'web' },
        { id: 's2', url: 'https://all-deg.com/b', title: 'All Degraded 2', excerpt: 'd2', source: 'web' },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://all-deg.com/a', {
          url: 'https://all-deg.com/a',
          title: 'All Degraded 1',
          excerpt: 'ALL_DEGRADED_MARKER_1',
          content: 'ALL_DEGRADED_MARKER_1',
          content_mode: 'full' as const,
          content_truncated: false,
          degraded: true,
        } as ReadResult],
        ['https://all-deg.com/b', {
          url: 'https://all-deg.com/b',
          title: 'All Degraded 2',
          excerpt: 'ALL_DEGRADED_MARKER_2',
          content: 'ALL_DEGRADED_MARKER_2',
          content_mode: 'full' as const,
          content_truncated: false,
          degraded: true,
        } as ReadResult],
      ]);

      const { envelope, synthesis } = await runGather(searchResults, readResults);

      // Response must succeed
      expect(envelope.ok).toBe(true);
      // Degraded section must be present
      expect(synthesis).toContain('Degraded Sources');
      // Degraded content must NOT appear as synthesis body
      expect(synthesis).not.toContain('ALL_DEGRADED_MARKER_1');
      expect(synthesis).not.toContain('ALL_DEGRADED_MARKER_2');
    });

    // AC4/AC5: single degraded read — content not presented as synthesis output
    it('does not present degraded content as normal synthesis output', async () => {
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://deg-pres.com/a', title: 'Degraded', excerpt: 'd', source: 'web' },
      ];

      const degradedContent = 'This is degraded content that should not appear as synthesis';
      const readResults = new Map<string, ReadResult>([
        ['https://deg-pres.com/a', {
          url: 'https://deg-pres.com/a',
          title: 'Degraded',
          excerpt: degradedContent,
          content: degradedContent,
          content_mode: 'full' as const,
          content_truncated: false,
          degraded: true,
        } as ReadResult],
      ]);

      const { synthesis } = await runGather(searchResults, readResults);

      // Degraded content must not leak into the synthesis body
      expect(synthesis).not.toContain(degradedContent);
    });
  });

  // -------------------------------------------------------------------------
  // Relevance ordering
  // -------------------------------------------------------------------------

  describe('relevance ordering', () => {
    // AC3: higher relevance appears first
    it('orders non-degraded reads by relevance score descending', async () => {
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://rel-ord.com/low', title: 'Low Relevance', excerpt: 'low', source: 'web', relevance: 0.3 },
        { id: 's2', url: 'https://rel-ord.com/high', title: 'High Relevance', excerpt: 'high', source: 'web', relevance: 0.9 },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://rel-ord.com/low', {
          url: 'https://rel-ord.com/low',
          title: 'Low Relevance',
          excerpt: 'low excerpt',
          content: 'LOW_RELEVANCE_CONTENT_MARKER',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        ['https://rel-ord.com/high', {
          url: 'https://rel-ord.com/high',
          title: 'High Relevance',
          excerpt: 'high excerpt',
          content: 'HIGH_RELEVANCE_CONTENT_MARKER',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
      ]);

      const { synthesis } = await runGather(searchResults, readResults, 'test query');

      // Higher-relevance content must appear before lower-relevance content
      const highIdx = synthesis.indexOf('HIGH_RELEVANCE_CONTENT_MARKER');
      const lowIdx = synthesis.indexOf('LOW_RELEVANCE_CONTENT_MARKER');
      expect(highIdx).toBeGreaterThan(-1);
      expect(lowIdx).toBeGreaterThan(-1);
      expect(highIdx).toBeLessThan(lowIdx);
    });

    // AC3: fallback to query term overlap when provider relevance missing
    it('uses query term overlap when provider relevance unavailable', async () => {
      // SearchResult without relevance field — implementation must compute term overlap
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://qto.com/irrelevant', title: 'Irrelevant', excerpt: 'irrelevant content about weather', source: 'web' },
        { id: 's2', url: 'https://qto.com/relevant', title: 'Relevant', excerpt: 'react hooks tutorial', source: 'web' },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://qto.com/irrelevant', {
          url: 'https://qto.com/irrelevant',
          title: 'Irrelevant',
          excerpt: 'weather content',
          content: 'WEATHER_CONTENT_MARKER_DISCUSSING_RAIN_AND_SUN',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        ['https://qto.com/relevant', {
          url: 'https://qto.com/relevant',
          title: 'Relevant',
          excerpt: 'react hooks',
          content: 'REACT_HOOKS_TUTORIAL_CONTENT_MARKER_WITH_USESTATE',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
      ]);

      const { synthesis } = await runGather(searchResults, readResults, 'react hooks tutorial');

      // Content with more query term overlap must appear first
      const reactIdx = synthesis.indexOf('REACT_HOOKS_TUTORIAL_CONTENT_MARKER_WITH_USESTATE');
      const weatherIdx = synthesis.indexOf('WEATHER_CONTENT_MARKER_DISCUSSING_RAIN_AND_SUN');
      expect(reactIdx).toBeGreaterThan(-1);
      expect(weatherIdx).toBeGreaterThan(-1);
      expect(reactIdx).toBeLessThan(weatherIdx);
    });
  });

  // -------------------------------------------------------------------------
  // Content deduplication
  // -------------------------------------------------------------------------

  describe('content deduplication', () => {
    // AC2: near-identical passages deduplicated, keep higher-relevance version
    it('deduplicates near-identical passages keeping higher-relevance version', async () => {
      const sharedContent = 'React hooks are functions that let you use state and other React features in function components. They were introduced in React 16.8 and have since become the standard way to manage state and side effects in modern React applications.';
      const variant1 = sharedContent + ' Additional unique detail from source one.';
      const variant2 = sharedContent + ' Extra note from source two.';

      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://dedup.com/low', title: 'Dedup Low', excerpt: 'low', source: 'web', relevance: 0.4 },
        { id: 's2', url: 'https://dedup.com/high', title: 'Dedup High', excerpt: 'high', source: 'web', relevance: 0.8 },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://dedup.com/low', {
          url: 'https://dedup.com/low',
          title: 'Dedup Low',
          excerpt: variant1,
          content: 'DEDUP_LOW_RELEVANCE_MARKER ' + variant1,
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        ['https://dedup.com/high', {
          url: 'https://dedup.com/high',
          title: 'Dedup High',
          excerpt: variant2,
          content: 'DEDUP_HIGH_RELEVANCE_MARKER ' + variant2,
          content_mode: 'full' as const,
          content_truncated: false,
        }],
      ]);

      const { synthesis } = await runGather(searchResults, readResults, 'react hooks');

      // Only the higher-relevance version should appear
      expect(synthesis).toContain('DEDUP_HIGH_RELEVANCE_MARKER');
      expect(synthesis).not.toContain('DEDUP_LOW_RELEVANCE_MARKER');
    });

    // AC2: deduplication note included when duplicates removed
    it('includes deduplication note when duplicates removed', async () => {
      const sharedContent = 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing algorithms that can access data and use it to learn for themselves.';
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://dedup-note.com/a', title: 'Source A', excerpt: sharedContent, source: 'web' },
        { id: 's2', url: 'https://dedup-note.com/b', title: 'Source B', excerpt: sharedContent, source: 'web' },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://dedup-note.com/a', {
          url: 'https://dedup-note.com/a',
          title: 'Source A',
          excerpt: sharedContent,
          content: 'SOURCE_A_UNIQUE_MARKER ' + sharedContent,
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        ['https://dedup-note.com/b', {
          url: 'https://dedup-note.com/b',
          title: 'Source B',
          excerpt: sharedContent,
          content: 'SOURCE_B_UNIQUE_MARKER ' + sharedContent,
          content_mode: 'full' as const,
          content_truncated: false,
        }],
      ]);

      const { synthesis } = await runGather(searchResults, readResults, 'machine learning');

      // Synthesis must indicate that deduplication occurred
      expect(synthesis).toContain('Deduplicated');
    });

    // AC2: distinct passages from different sources are preserved and ordered by relevance
    it('keeps distinct passages from different sources', async () => {
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://distinct.com/typescript', title: 'TypeScript Guide', excerpt: 'ts', source: 'web', relevance: 0.7 },
        { id: 's2', url: 'https://distinct.com/python', title: 'Python Guide', excerpt: 'py', source: 'web', relevance: 0.9 },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://distinct.com/typescript', {
          url: 'https://distinct.com/typescript',
          title: 'TypeScript Guide',
          excerpt: 'TypeScript is a typed superset of JavaScript.',
          content: 'TYPESCRIPT_UNIQUE_CONTENT_MARKER about typed programming',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        ['https://distinct.com/python', {
          url: 'https://distinct.com/python',
          title: 'Python Guide',
          excerpt: 'Python is a versatile programming language.',
          content: 'PYTHON_UNIQUE_CONTENT_MARKER about versatile programming',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
      ]);

      const { synthesis } = await runGather(searchResults, readResults, 'programming guide');

      // Both distinct passages must be preserved (not deduplicated)
      expect(synthesis).toContain('TYPESCRIPT_UNIQUE_CONTENT_MARKER');
      expect(synthesis).toContain('PYTHON_UNIQUE_CONTENT_MARKER');
      // Ordered by relevance: Python (0.9) before TypeScript (0.7)
      const pythonIdx = synthesis.indexOf('PYTHON_UNIQUE_CONTENT_MARKER');
      const tsIdx = synthesis.indexOf('TYPESCRIPT_UNIQUE_CONTENT_MARKER');
      expect(pythonIdx).toBeLessThan(tsIdx);
    });
  });

  // -------------------------------------------------------------------------
  // AC1: Material difference from source-order concatenation
  // -------------------------------------------------------------------------

  describe('material difference from source-order concatenation', () => {
    // AC1: synthesis is NOT just [1][2][3] source-order concatenation
    it('produces synthesis ordered by relevance, not source order', async () => {
      const searchResults: SearchResult[] = [
        { id: 's1', url: 'https://matdiff.com/c', title: 'Third Source', excerpt: 'third', source: 'web', relevance: 0.3 },
        { id: 's2', url: 'https://matdiff.com/a', title: 'First Source', excerpt: 'first', source: 'web', relevance: 0.9 },
        { id: 's3', url: 'https://matdiff.com/b', title: 'Second Source', excerpt: 'second', source: 'web', relevance: 0.6 },
      ];

      const readResults = new Map<string, ReadResult>([
        ['https://matdiff.com/c', {
          url: 'https://matdiff.com/c',
          title: 'Third Source',
          excerpt: 'third',
          content: 'MATDIFF_THIRD_SOURCE_MARKER',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        ['https://matdiff.com/a', {
          url: 'https://matdiff.com/a',
          title: 'First Source',
          excerpt: 'first',
          content: 'MATDIFF_FIRST_SOURCE_MARKER',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
        ['https://matdiff.com/b', {
          url: 'https://matdiff.com/b',
          title: 'Second Source',
          excerpt: 'second',
          content: 'MATDIFF_SECOND_SOURCE_MARKER',
          content_mode: 'full' as const,
          content_truncated: false,
        }],
      ]);

      const { synthesis } = await runGather(searchResults, readResults, 'test');

      // Source order would be: Third(0.3), First(0.9), Second(0.6)
      // Relevance order should be: First(0.9), Second(0.6), Third(0.3)
      const firstIdx = synthesis.indexOf('MATDIFF_FIRST_SOURCE_MARKER');
      const secondIdx = synthesis.indexOf('MATDIFF_SECOND_SOURCE_MARKER');
      const thirdIdx = synthesis.indexOf('MATDIFF_THIRD_SOURCE_MARKER');

      expect(firstIdx).toBeGreaterThan(-1);
      expect(secondIdx).toBeGreaterThan(-1);
      expect(thirdIdx).toBeGreaterThan(-1);
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });
  });
});

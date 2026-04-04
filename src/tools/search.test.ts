/**
 * Tests for search tool — locked v1 contract.
 *
 * Tests verify:
 * 1. Envelope shape (schema_version, ok, meta, result/error)
 * 2. ResponseMeta fields on success and failure
 * 3. Provider provenance in meta
 * 4. Normalized result fields (task 08.01)
 * 5. Stable per-response IDs (task 08.01)
 * 6. Error code mapping to v1 taxonomy (task 08.01)
 * 7. Limit control with documented default (task 08.01)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSearchTool, SearchInputSchema } from './search.js';
import type { SearchResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearxngProvider } from '../providers/searxng.js';
import { Logger } from '../lib/logger.js';
import {
  SearxngTimeoutError,
  SearxngUnavailableError,
  SearxngInvalidResponseError,
  ErrorCode,
} from '../lib/errors.js';
import { ProviderRegistry } from '../lib/provider-registry.js';

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockSearchProvider(results: SearchResult[]): SearxngProvider {
  return {
    id: 'searxng',
    name: 'SearXNG',
    isHealthy: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue(results),
    checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
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
    expect(result.content_mode).toBe('full');
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

  // -------------------------------------------------------------------------
  // Task 08.01: Normalized result fields
  // -------------------------------------------------------------------------

  describe('normalized result fields (task 08.01)', () => {
    it('each result has required id field', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const results = envelope.result.results as SearchResult[];
      
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.id).toBeDefined();
        expect(typeof result.id).toBe('string');
        expect(result.id.length).toBeGreaterThan(0);
      }
    });

    it('each result has canonical url field', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const results = envelope.result.results as SearchResult[];
      
      for (const result of results) {
        expect(result.url).toBeDefined();
        expect(typeof result.url).toBe('string');
        expect(result.url).toMatch(/^https?:\/\//);
      }
    });

    it('each result has title field', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const results = envelope.result.results as SearchResult[];
      
      for (const result of results) {
        expect(result.title).toBeDefined();
        expect(typeof result.title).toBe('string');
      }
    });

    it('each result has excerpt field (snippet)', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const results = envelope.result.results as SearchResult[];
      
      for (const result of results) {
        expect(result.excerpt).toBeDefined();
        expect(typeof result.excerpt).toBe('string');
      }
    });

    it('each result has source field (type)', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const results = envelope.result.results as SearchResult[];
      
      for (const result of results) {
        expect(result.source).toBeDefined();
        expect(['web', 'local', 'custom']).toContain(result.source);
      }
    });

    it('results do not leak provider-specific fields to output', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const results = envelope.result.results as SearchResult[];
      
      // Verify no SearXNG-specific fields leak through (engines, categories, etc.)
      for (const result of results) {
        expect(result).not.toHaveProperty('engines');
        expect(result).not.toHaveProperty('categories');
        expect(result).not.toHaveProperty('engine');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Task 08.01: Stable per-response IDs
  // -------------------------------------------------------------------------

  describe('stable per-response IDs (task 08.01)', () => {
    it('generates unique request_id for each call (per-request identifier)', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      
      const response1 = await tool.handler({ query: 'test1' });
      const response2 = await tool.handler({ query: 'test2' });

      const envelope1 = JSON.parse(response1.content[0]?.text ?? '{}');
      const envelope2 = JSON.parse(response2.content[0]?.text ?? '{}');

      // Each request gets a unique request_id in meta
      expect(envelope1.meta.request_id).toBeDefined();
      expect(envelope2.meta.request_id).toBeDefined();
      expect(envelope1.meta.request_id).not.toBe(envelope2.meta.request_id);
    });

    it('request_id follows UUID v4 format for stability', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      
      // UUID v4 format is stable and parseable
      expect(envelope.meta.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // Task 08.01: Error code mapping to v1 taxonomy
  // -------------------------------------------------------------------------

  describe('error code mapping (task 08.01)', () => {
    it('maps SearxngTimeoutError to ERR_SEARXNG_TIMEOUT with retryable: true', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new SearxngTimeoutError('SearxNG timed out', { query: 'test' })
      );

      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe(ErrorCode.ERR_SEARXNG_TIMEOUT);
      expect(envelope.error.retryable).toBe(true);
    });

    it('maps SearxngUnavailableError to ERR_SEARXNG_UNAVAILABLE with retryable: true', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new SearxngUnavailableError('SearxNG unavailable', { query: 'test' })
      );

      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe(ErrorCode.ERR_SEARXNG_UNAVAILABLE);
      expect(envelope.error.retryable).toBe(true);
    });

    it('maps SearxngInvalidResponseError to ERR_SEARXNG_INVALID_RESPONSE with retryable: false', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new SearxngInvalidResponseError('Invalid response', { status: 500 })
      );

      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe(ErrorCode.ERR_SEARXNG_INVALID_RESPONSE);
      expect(envelope.error.retryable).toBe(false);
    });

    it('maps unknown errors to ERR_SEARXNG_UNAVAILABLE with retryable: false', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Unknown error')
      );

      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe(ErrorCode.ERR_SEARXNG_UNAVAILABLE);
      expect(envelope.error.retryable).toBe(false);
    });

    it('error includes message field', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new SearxngTimeoutError('SearxNG timed out', { query: 'test' })
      );

      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      
      expect(envelope.error.message).toBeDefined();
      expect(typeof envelope.error.message).toBe('string');
      expect(envelope.error.message.length).toBeGreaterThan(0);
    });

    it('error includes details when available', async () => {
      mockSearchProvider = createMockSearchProvider([]);
      (mockSearchProvider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new SearxngTimeoutError('SearxNG timed out', { query: 'test', duration: 5000 })
      );

      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      
      expect(envelope.error.details).toBeDefined();
      expect(envelope.error.details.query).toBe('test');
      expect(envelope.error.details.duration).toBe(5000);
    });
  });

  // -------------------------------------------------------------------------
  // Task 08.01: Limit control with documented default
  // -------------------------------------------------------------------------

  describe('limit control (task 08.01)', () => {
    it('applies default limit of 5 when not specified', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      await tool.handler({ query: 'test' });

      // The tool passes limit to provider, so check the mock was called with limit: 5
      expect(mockSearchProvider.search).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ limit: 5 })
      );
    });

    it('passes explicit limit to provider', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      await tool.handler({ query: 'test', limit: 20 });

      expect(mockSearchProvider.search).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ limit: 20 })
      );
    });

    it('meta reflects applied max_results limit', async () => {
      const tool = createSearchTool(mockSearchProvider, mockLogger);
      const response = await tool.handler({ query: 'test', limit: 15 });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits.max_results).toBe(15);
    });

    it('rejects limit below minimum (1)', async () => {
      const result = SearchInputSchema.safeParse({ query: 'test', limit: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects limit above maximum (50)', async () => {
      const result = SearchInputSchema.safeParse({ query: 'test', limit: 51 });
      expect(result.success).toBe(false);
    });

    it('accepts limit at boundaries (1 and 50)', async () => {
      expect(SearchInputSchema.safeParse({ query: 'test', limit: 1 })?.success).toBe(true);
      expect(SearchInputSchema.safeParse({ query: 'test', limit: 50 })?.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Task: Explicit provider selection
  // ---------------------------------------------------------------------------

  describe('explicit provider selection', () => {
    it('accepts provider parameter with default auto', () => {
      const result = SearchInputSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe('auto');
      }
    });

    it('accepts provider parameter with explicit auto', () => {
      const result = SearchInputSchema.safeParse({ query: 'test', provider: 'auto' });
      expect(result.success).toBe(true);
    });

    it('accepts provider parameter with local', () => {
      const result = SearchInputSchema.safeParse({ query: 'test', provider: 'local' });
      expect(result.success).toBe(true);
    });

    it('accepts provider parameter with fallback1', () => {
      const result = SearchInputSchema.safeParse({ query: 'test', provider: 'fallback1' });
      expect(result.success).toBe(true);
    });

    it('accepts provider parameter with fallback2', () => {
      const result = SearchInputSchema.safeParse({ query: 'test', provider: 'fallback2' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid provider values', () => {
      const result = SearchInputSchema.safeParse({ query: 'test', provider: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('works with ProviderRegistry', async () => {
      // Create a registry with all providers
      const autoProvider = createMockSearchProvider(createTestSearchResults());
      const localProvider = {
        id: 'local-searxng',
        name: 'Local SearXNG',
        search: vi.fn().mockResolvedValue([{ id: 'local-1', url: 'https://local.com', title: 'Local', excerpt: 'local', source: 'web' as const }]),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 5 }),
      } as unknown as SearxngProvider;

      const registry = new ProviderRegistry({
        auto: autoProvider,
        local: localProvider,
      });

      const tool = createSearchTool(registry, mockLogger);

      // Test with explicit local provider
      const response = await tool.handler({ query: 'test', provider: 'local' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.ok).toBe(true);
      expect(envelope.meta.provider_id).toBe('local-searxng');
      expect(localProvider.search).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 5 }));
    });

    it('returns clear error for unavailable explicit provider', async () => {
      // Create a registry with only auto (no local/fallbacks)
      const autoProvider = createMockSearchProvider(createTestSearchResults());
      const registry = new ProviderRegistry({ auto: autoProvider });

      const tool = createSearchTool(registry, mockLogger);

      // Try to use local when it's not configured
      const response = await tool.handler({ query: 'test', provider: 'local' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe('ERR_PROVIDER_UNAVAILABLE');
      expect(envelope.error.message).toContain("Provider 'local' is not configured");
      expect(envelope.error.retryable).toBe(false);
    });

    it('uses auto provider by default', async () => {
      const autoProvider = createMockSearchProvider(createTestSearchResults());
      const localProvider = {
        id: 'local-searxng',
        name: 'Local SearXNG',
        search: vi.fn().mockResolvedValue([]),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 5 }),
      } as unknown as SearxngProvider;

      const registry = new ProviderRegistry({
        auto: autoProvider,
        local: localProvider,
      });

      const tool = createSearchTool(registry, mockLogger);

      // Without provider param, should use auto
      await tool.handler({ query: 'test' });

      expect(autoProvider.search).toHaveBeenCalled();
      expect(localProvider.search).not.toHaveBeenCalled();
    });

    it('uses fallback1 provider when explicitly requested', async () => {
      const autoProvider = createMockSearchProvider(createTestSearchResults());
      const fallback1Provider = {
        id: 'searx-party',
        name: 'searx.party',
        search: vi.fn().mockResolvedValue([{ id: 'fb1-1', url: 'https://fb1.com', title: 'FB1', excerpt: 'fb1', source: 'web' as const }]),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
      } as unknown as SearxngProvider;

      const registry = new ProviderRegistry({
        auto: autoProvider,
        fallback1: fallback1Provider,
      });

      const tool = createSearchTool(registry, mockLogger);

      const response = await tool.handler({ query: 'test', provider: 'fallback1' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.ok).toBe(true);
      expect(envelope.meta.provider_id).toBe('searx-party');
      expect(fallback1Provider.search).toHaveBeenCalled();
      expect(autoProvider.search).not.toHaveBeenCalled();
    });
  });
});

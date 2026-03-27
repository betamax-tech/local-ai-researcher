/**
 * Tests for read tool content policy — task 07.01 contract.
 *
 * Tests verify:
 * 1. Default read returns full content (content_mode: "full" is default)
 * 2. Explicit excerpt mode returns truncated content with metadata
 * 3. Truncation metadata is exposed when content is truncated
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReadTool, ReadInputSchema } from './read.js';
import type { ReadResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { JinaReaderProvider } from '../providers/jinaReader.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

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

const FULL_CONTENT = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15\nLine 16\nLine 17\nLine 18\nLine 19\nLine 20\nLine 21\nLine 22\nLine 23\nLine 24\nLine 25\nLine 26\nLine 27\nLine 28\nLine 29\nLine 30\nLine 31\nLine 32\nLine 33\nLine 34\nLine 35';

const TEST_URL = 'https://example.com/article';

function createFullContentResult(): ReadResult {
  return {
    url: TEST_URL,
    title: 'Test Article',
    content: FULL_CONTENT,
    excerpt: FULL_CONTENT.split('\n').slice(0, 30).join('\n') + '\n...',
    content_mode: 'full',
    content_truncated: false,
    wordCount: 50,
    duration: 100,
  };
}

function createExcerptResult(): ReadResult {
  return {
    url: TEST_URL,
    title: 'Test Article',
    content: FULL_CONTENT.split('\n').slice(0, 30).join('\n') + '\n...',
    excerpt: FULL_CONTENT.split('\n').slice(0, 30).join('\n') + '\n...',
    content_mode: 'excerpt',
    content_truncated: true,
    truncation: {
      applied_limit: 30,
      reason: 'explicit_excerpt',
    },
    wordCount: 35,
    duration: 100,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReadInputSchema', () => {
  it('validates required url field', () => {
    const result = ReadInputSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  describe('content_mode default and validation', () => {
    it('defaults content_mode to "full" when not specified', () => {
      const result = ReadInputSchema.parse({ url: 'https://example.com' });
      expect(result.content_mode).toBe('full');
    });

    it('accepts content_mode: "full"', () => {
      const result = ReadInputSchema.safeParse({ 
        url: 'https://example.com', 
        content_mode: 'full' 
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content_mode).toBe('full');
      }
    });

    it('accepts content_mode: "excerpt"', () => {
      const result = ReadInputSchema.safeParse({ 
        url: 'https://example.com', 
        content_mode: 'excerpt' 
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content_mode).toBe('excerpt');
      }
    });

    it('rejects invalid content_mode values', () => {
      const result = ReadInputSchema.safeParse({ 
        url: 'https://example.com', 
        content_mode: 'invalid' 
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('createReadTool', () => {
  let mockReadProvider: JinaReaderProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('full-content-by-default', () => {
    it('requests full content by default (content_mode: "full")', async () => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      // Verify provider was called with content_mode: 'full'
      expect(mockReadProvider.read).toHaveBeenCalledWith(
        TEST_URL,
        expect.objectContaining({ content_mode: 'full' })
      );
      
      // Verify response is not an error
      expect(response.isError).toBeUndefined();
    });

    it('returns full content in response when no content_mode specified', async () => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      expect(response.isError).toBeUndefined();
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.ok).toBe(true);
      expect(envelope.result.content_mode).toBe('full');
      expect(envelope.result.content_truncated).toBe(false);
      // Content should contain all 35 lines
      expect(envelope.result.content).toContain('Line 35');
    });

    it('passes content_mode: "full" to provider when explicitly set', async () => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      await tool.handler({ url: TEST_URL, content_mode: 'full' });

      expect(mockReadProvider.read).toHaveBeenCalledWith(
        TEST_URL,
        expect.objectContaining({ content_mode: 'full' })
      );
    });
  });

  describe('explicit excerpt mode', () => {
    it('requests excerpt when content_mode: "excerpt" is set', async () => {
      const results = new Map([[TEST_URL, createExcerptResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      await tool.handler({ url: TEST_URL, content_mode: 'excerpt' });

      expect(mockReadProvider.read).toHaveBeenCalledWith(
        TEST_URL,
        expect.objectContaining({ content_mode: 'excerpt' })
      );
    });

    it('returns truncated content with metadata when content_mode: "excerpt"', async () => {
      const results = new Map([[TEST_URL, createExcerptResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL, content_mode: 'excerpt' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.content_mode).toBe('excerpt');
      expect(envelope.result.content_truncated).toBe(true);
      expect(envelope.result.truncation).toBeDefined();
      expect(envelope.result.truncation.reason).toBe('explicit_excerpt');
      expect(envelope.result.truncation.applied_limit).toBe(30);
    });
  });

  describe('truncation metadata', () => {
    it('includes content_mode field in all responses', async () => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result).toHaveProperty('content_mode');
    });

    it('includes content_truncated field in all responses', async () => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result).toHaveProperty('content_truncated');
    });

    it('includes truncation details when content_truncated: true', async () => {
      const results = new Map([[TEST_URL, createExcerptResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL, content_mode: 'excerpt' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.content_truncated).toBe(true);
      expect(envelope.result.truncation).toBeDefined();
      expect(envelope.result.truncation).toHaveProperty('applied_limit');
      expect(envelope.result.truncation).toHaveProperty('reason');
    });

    it('truncation is undefined when content_truncated: false', async () => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.content_truncated).toBe(false);
      expect(envelope.result.truncation).toBeUndefined();
    });
  });

  describe('tool description', () => {
    it('does not describe excerpt-first as the default', () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      // The description should NOT mention "excerpt-first" as default behavior
      expect(tool.description.toLowerCase()).not.toContain('excerpt-first');
      expect(tool.description.toLowerCase()).not.toContain('30-line excerpt');
    });

    it('describes full content as the default', () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      // The description should mention that full content is returned by default
      expect(tool.description.toLowerCase()).toContain('full');
    });
  });

  describe('envelope shape', () => {
    it('returns valid envelope with schema_version', async () => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.schema_version).toBe(SCHEMA_VERSION);
      expect(envelope.ok).toBe(true);
    });
  });

  describe('ResponseMeta contract (task 07.02)', () => {
    beforeEach(() => {
      const results = new Map([[TEST_URL, createFullContentResult()]]);
      mockReadProvider = createMockReadProvider(results);
    });

    it('includes meta object on success', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('includes meta object on failure', async () => {
      mockReadProvider = createMockReadProvider(new Map());
      (mockReadProvider.read as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Read failed')
      );
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('meta has required request_id (UUID v4)', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.request_id).toBeDefined();
      expect(typeof envelope.meta.request_id).toBe('string');
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(envelope.meta.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('meta has ISO-8601 timestamp', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const beforeTime = new Date();
      const response = await tool.handler({ url: TEST_URL });
      const afterTime = new Date();

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.timestamp).toBeDefined();
      
      const timestamp = new Date(envelope.meta.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
    });

    it('meta has provider_id for Jina Reader', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_id).toBe('jina-reader');
    });

    it('meta has provider_name for Jina Reader', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_name).toBe('Jina Reader');
    });

    it('meta has applied_limits object', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits).toBeDefined();
      expect(typeof envelope.meta.applied_limits).toBe('object');
    });

    it('meta.applied_limits includes timeout_ms', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits.timeout_ms).toBeDefined();
      expect(typeof envelope.meta.applied_limits.timeout_ms).toBe('number');
    });

    it('generates unique request_id for each call', async () => {
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response1 = await tool.handler({ url: TEST_URL });
      const response2 = await tool.handler({ url: TEST_URL });

      const envelope1 = JSON.parse(response1.content[0]?.text ?? '{}');
      const envelope2 = JSON.parse(response2.content[0]?.text ?? '{}');

      expect(envelope1.meta.request_id).not.toBe(envelope2.meta.request_id);
    });

    it('failure response preserves meta fields for debugging', async () => {
      mockReadProvider = createMockReadProvider(new Map());
      (mockReadProvider.read as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Read failed')
      );
      
      const tool = createReadTool(mockReadProvider, mockLogger);
      const response = await tool.handler({ url: TEST_URL });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.ok).toBe(false);
      expect(envelope.meta.request_id).toBeDefined();
      expect(envelope.meta.timestamp).toBeDefined();
      expect(envelope.meta.provider_id).toBeDefined();
      expect(envelope.meta.provider_name).toBeDefined();
    });
  });
});

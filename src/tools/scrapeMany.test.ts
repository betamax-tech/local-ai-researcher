import { describe, it, expect, vi } from 'vitest';

import { createScrapeManyTool, ScrapeManyInputSchema } from './scrapeMany.js';
import type { ScrapeProvider } from '../providers/interfaces.js';
import { Logger } from '../lib/logger.js';

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createProvider(): ScrapeProvider {
  return {
    id: 'scrapling',
    name: 'Scrapling',
    canExtract: vi.fn().mockReturnValue(true),
    extract: vi.fn(),
    scrapeListing: vi.fn(),
    scrapePage: vi.fn().mockImplementation(async (url: string) => ({
      url,
      entity_type: 'product',
      fields_requested: ['title', 'price'],
      mode_used: 'static',
      excerpt: `Excerpt for ${url}`,
      content: `Content for ${url}`,
      content_mode: 'full',
      content_truncated: false,
      sections: [{ label: 'main_content', text: `Content for ${url}` }],
      records: [],
      field_candidates: { title: `Item ${url}`, price: '$19.99' },
      wordCount: 4,
      degraded: false,
    })),
    checkHealth: vi.fn(),
  };
}

describe('ScrapeManyInputSchema', () => {
  it('defaults concurrency to 5', () => {
    const parsed = ScrapeManyInputSchema.parse({ urls: ['https://example.com/a'] });
    expect(parsed.maxConcurrency).toBe(5);
  });
});

describe('createScrapeManyTool', () => {
  it('returns aggregated page results', async () => {
    const tool = createScrapeManyTool(createProvider(), createLogger());
    const response = await tool.handler({
      urls: ['https://example.com/a', 'https://example.com/b'],
      entity_type: 'product',
      fields: ['title', 'price'],
    });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(envelope.ok).toBe(true);
    expect(envelope.result.summary.attempted).toBe(2);
    expect(envelope.result.summary.succeeded).toBe(2);
    expect(envelope.result.results).toHaveLength(2);
  });

  it('records failures without failing the whole batch', async () => {
    const provider = createProvider();
    provider.scrapePage = vi.fn()
      .mockResolvedValueOnce({
        url: 'https://example.com/a',
        entity_type: 'product',
        fields_requested: [],
        mode_used: 'static',
        excerpt: 'ok',
        content: 'ok',
        content_mode: 'full',
        content_truncated: false,
        sections: [],
        records: [],
      })
      .mockRejectedValueOnce(new Error('boom'));

    const tool = createScrapeManyTool(provider, createLogger());
    const response = await tool.handler({ urls: ['https://example.com/a', 'https://example.com/b'] });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(envelope.ok).toBe(true);
    expect(envelope.result.summary.failed).toBe(1);
    expect(envelope.result.failures[0].url).toBe('https://example.com/b');
  });
});

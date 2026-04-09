import { describe, it, expect, vi } from 'vitest';

import { createScrapePageTool, ScrapePageInputSchema } from './scrapePage.js';
import type { ScrapeProvider } from '../providers/interfaces.js';
import { Logger } from '../lib/logger.js';
import { ExtractUnavailableError } from '../lib/errors.js';

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
    scrapePage: vi.fn().mockResolvedValue({
      url: 'https://example.com/product',
      title: 'Widget',
      entity_type: 'product',
      goal: 'collect product data',
      fields_requested: ['title', 'price'],
      mode_used: 'static',
      excerpt: 'Widget for $19.99',
      content: 'Widget for $19.99',
      content_mode: 'full',
      content_truncated: false,
      sections: [{ label: 'main_content', text: 'Widget for $19.99' }],
      records: [],
      field_candidates: { title: 'Widget', price: '$19.99' },
      wordCount: 3,
      degraded: false,
    }),
    scrapeListing: vi.fn(),
    checkHealth: vi.fn(),
  };
}

describe('ScrapePageInputSchema', () => {
  it('defaults to generic entity type and full content', () => {
    const parsed = ScrapePageInputSchema.parse({ url: 'https://example.com' });
    expect(parsed.entity_type).toBe('generic');
    expect(parsed.content_mode).toBe('full');
    expect(parsed.maxRecords).toBe(25);
  });
});

describe('createScrapePageTool', () => {
  it('returns a valid success envelope', async () => {
    const tool = createScrapePageTool(createProvider(), createLogger());
    const response = await tool.handler({
      url: 'https://example.com/product',
      entity_type: 'product',
      fields: ['title', 'price'],
    });

    const envelope = JSON.parse(response.content[0]?.text ?? '{}');
    expect(envelope.ok).toBe(true);
    expect(envelope.result.entity_type).toBe('product');
    expect(envelope.result.field_candidates.price).toBe('$19.99');
  });

  it('passes task-shaped hints to the provider', async () => {
    const provider = createProvider();
    const tool = createScrapePageTool(provider, createLogger());
    await tool.handler({
      url: 'https://example.com/job',
      entity_type: 'job',
      fields: ['title', 'company'],
      goal: 'capture job data',
    });

    expect(provider.scrapePage).toHaveBeenCalledWith(
      'https://example.com/job',
      expect.objectContaining({ entity_type: 'job', fields: ['title', 'company'], goal: 'capture job data' })
    );
  });

  it('returns an error envelope on provider failure', async () => {
    const provider = createProvider();
    provider.scrapePage = vi.fn().mockRejectedValue(new ExtractUnavailableError('sidecar unavailable'));
    const tool = createScrapePageTool(provider, createLogger());
    const response = await tool.handler({ url: 'https://example.com' });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(response.isError).toBe(true);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('ERR_EXTRACT_UNAVAILABLE');
  });
});

import { describe, it, expect, vi } from 'vitest';

import { createScrapeListingTool, ScrapeListingInputSchema } from './scrapeListing.js';
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
    scrapePage: vi.fn(),
    scrapeListing: vi.fn().mockResolvedValue({
      url: 'https://example.com/jobs',
      entity_type: 'job',
      goal: 'collect jobs',
      fields_requested: ['title', 'company', 'location', 'url'],
      item_selector: '.job-card',
      records: [
        {
          index: 0,
          title: 'Platform Engineer',
          url: 'https://example.com/jobs/1',
          text: 'Platform Engineer at ExampleCo in Remote',
          field_candidates: { title: 'Platform Engineer', company: 'ExampleCo', location: 'Remote' },
        },
      ],
      item_count: 1,
      mode_used: 'static',
      duration: 100,
    }),
    checkHealth: vi.fn(),
  };
}

describe('ScrapeListingInputSchema', () => {
  it('defaults to generic entity type and maxItems 25', () => {
    const parsed = ScrapeListingInputSchema.parse({ url: 'https://example.com/listing' });
    expect(parsed.entity_type).toBe('generic');
    expect(parsed.maxItems).toBe(25);
  });
});

describe('createScrapeListingTool', () => {
  it('returns a valid success envelope', async () => {
    const tool = createScrapeListingTool(createProvider(), createLogger());
    const response = await tool.handler({ url: 'https://example.com/jobs', entity_type: 'job' });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(envelope.ok).toBe(true);
    expect(envelope.result.item_count).toBe(1);
    expect(envelope.result.records[0].field_candidates.company).toBe('ExampleCo');
  });

  it('passes listing hints to the provider', async () => {
    const provider = createProvider();
    const tool = createScrapeListingTool(provider, createLogger());
    await tool.handler({
      url: 'https://example.com/products',
      entity_type: 'product',
      fields: ['title', 'price', 'url'],
      item_selector: '.product-card',
      maxItems: 10,
    });

    expect(provider.scrapeListing).toHaveBeenCalledWith(
      'https://example.com/products',
      expect.objectContaining({ entity_type: 'product', item_selector: '.product-card', maxItems: 10 })
    );
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ScraplingProvider } from '../providers/scrapling.js';
import { Logger } from '../lib/logger.js';
import { createExtractTool } from './extract.js';
import { createScrapePageTool } from './scrapePage.js';
import { createScrapeListingTool } from './scrapeListing.js';
import { createScrapeManyTool } from './scrapeMany.js';

const url = 'http://93.184.216.34/product';
const json_ld = [
  { '@type': 'Product', name: 'Widget' },
  [{ '@type': 'Offer', price: 12 }],
  { '@graph': [{ '@id': 'widget' }] },
];

function setup(metadata: unknown[] = json_ld, includeMetadata = true) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  const http = { post: vi.fn().mockResolvedValue({ body: {
    url, mode_used: 'static', excerpt: 'one two three', content: 'one two three',
    sections: [], records: [], ...(includeMetadata ? { json_ld: metadata } : {}),
  } }) };
  const provider = new ScraplingProvider({
    enabled: 'auto', endpoint: 'http://100.100.10.20:8090', timeout: 20000,
    bootstrapWithDocker: false, allowPrivateNetworks: false, defaultMode: 'auto',
  }, http as any, logger);
  return { provider, logger };
}

describe('JSON-LD sidecar → provider → MCP results', () => {
  it.each(['full', 'excerpt'] as const)('passes all block shapes through page and extract in %s mode', async (content_mode) => {
    const { provider, logger } = setup();
    for (const tool of [createExtractTool(provider, logger), createScrapePageTool(provider, logger)]) {
      const response = await tool.handler({ url, content_mode, targetWords: 1 });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.ok).toBe(true);
      expect(envelope.result.json_ld).toEqual(json_ld);
      expect(envelope.result.content).toBe(content_mode === 'excerpt' ? 'one...' : 'one two three');
    }
  });

  it('passes page-level blocks through listing and every batch item', async () => {
    const { provider, logger } = setup();
    const listing = await createScrapeListingTool(provider, logger).handler({ url });
    expect(JSON.parse(listing.content[0]?.text ?? '{}').result.json_ld).toEqual(json_ld);
    const batch = await createScrapeManyTool(provider, logger).handler({ urls: [url, `${url}/2`] });
    const result = JSON.parse(batch.content[0]?.text ?? '{}').result;
    expect(result.summary.succeeded).toBe(2);
    expect(result.results.map((page: { json_ld: unknown[] }) => page.json_ld)).toEqual([json_ld, json_ld]);
  });

  it('preserves empty metadata and supports older sidecars without the field', async () => {
    const { provider } = setup([]);
    expect((await provider.scrapePage(url)).json_ld).toEqual([]);
    const { provider: older } = setup(undefined, false);
    // Model an old sidecar payload rather than inventing metadata for it.
    expect((await older.extract(url)).json_ld).toBeUndefined();
    expect((await older.scrapeListing(url)).json_ld).toBeUndefined();
  });
});

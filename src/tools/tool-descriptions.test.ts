/**
 * Tool-selection guards: each description must carry the tie-breaker that names its closest
 * competitor (A/B evidence: docs/TOOL_DESCRIPTION_AB_2026-11-04.md). Wording may change; the
 * named redirects and trigger values may not disappear without a new A/B run.
 */
import { describe, it, expect } from 'vitest';
import type { Logger } from '../lib/logger.js';
import { createSearchTool } from './search.js';
import { createSearchDorkTool } from './searchDork.js';
import { createGatherTool } from './gather.js';
import { createReadTool } from './read.js';
import { createScrapePageTool } from './scrapePage.js';
import { createScrapeListingTool } from './scrapeListing.js';
import { createScrapeManyTool } from './scrapeMany.js';
import { createBrowserUnlockTool } from './browserUnlock.js';
import { createHealthTool } from './health.js';
import { createCrawlTools } from './crawl.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;
const any = {} as never;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const tools = [
  createSearchTool(any, logger), createSearchDorkTool(any, logger), createGatherTool(any, any, logger),
  createReadTool(any, logger), createScrapePageTool(any, logger), createScrapeListingTool(any, logger),
  createScrapeManyTool(any, logger), createBrowserUnlockTool(any), createHealthTool(any, any, any, logger, null),
  ...createCrawlTools(any, logger),
];
const d = Object.fromEntries(tools.map((t) => [t.name, t.description]));

describe('tool descriptions — selection guards', () => {
  it('discovery routes name each other with a tie-break', () => {
    expect(d.search).toContain('gather');
    expect(d.search).toContain('search_dork');
    expect(d.search_dork).toMatch(/inurl:.*intitle:.*filetype:/);
    expect(d.search_dork).toContain('→ search');
    expect(d.gather).toContain('search');
    expect(d.gather).toMatch(/10 s/);
  });

  it('read vs scrape split is explicit and does not route JS pages away from read', () => {
    expect(d.read).toContain('scrape_page');
    expect(d.read).toMatch(/JavaScript/);
    expect(d.scrape_page).toContain('read');
    expect(d.scrape_page).toContain('scrape_many');
  });

  it('ops tools trigger on the values other tools return', () => {
    expect(d.health).toContain('ERR_SEARXNG_UNAVAILABLE');
    expect(d.health).toContain('ERR_READER_UNAVAILABLE');
    expect(d.browser_unlock).toContain("'bot_challenge'");
    expect(d.browser_unlock).toContain("'rate_limited'");
    expect(d.crawl_control).toContain('crawl_status');
    expect(d.crawl_results).toContain('crawl_status');
  });

  it('stays within the 220-word budget for competing tools', () => {
    for (const [name, text] of Object.entries(d)) expect(words(text), name).toBeLessThanOrEqual(220);
  });
});

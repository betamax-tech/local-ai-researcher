import { describe, it, expect, vi } from 'vitest';

import { ScraplingProvider } from './scrapling.js';
import type { ScraplingConfig } from '../domain/types.js';
import { Logger } from '../lib/logger.js';
import {
  ExtractInvalidResponseError,
  ExtractTimeoutError,
  ExtractUnavailableError,
} from '../lib/errors.js';
import { TimeoutError } from '../lib/errors.js';
import { validateSsrf, validateSsrfSync } from '../lib/ssrf.js';

function createConfig(overrides: Partial<ScraplingConfig> = {}): ScraplingConfig {
  return {
    enabled: 'auto',
    endpoint: 'http://127.0.0.1:8090',
    bootstrapWithDocker: true,
    timeout: 20000,
    allowPrivateNetworks: false,
    defaultMode: 'auto',
    ...overrides,
  };
}

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
  };
}

describe('ScraplingProvider', () => {
  it('allows tailnet transport for health, page, listing and crawl, not scrape targets', async () => {
    const httpClient = createHttpClient();
    const endpoint = 'http://100.100.10.20:8091';
    httpClient.get.mockResolvedValue({ body: { status: 'connected' } });
    httpClient.post.mockResolvedValue({ body: {
      url: 'http://93.184.216.34', mode_used: 'static', excerpt: '', sections: [], records: [],
    } });
    const provider = new ScraplingProvider(createConfig({ endpoint }), httpClient as any, createLogger());
    await provider.checkHealth();
    await provider.scrapePage('http://93.184.216.34');
    await provider.scrapeListing('http://93.184.216.34');
    await provider.crawl('GET', '/jobs');
    const calls = [...httpClient.get.mock.calls, ...httpClient.post.mock.calls];
    for (const call of calls) {
      const options = call[call.length - 1];
      expect(options.ssrfAllowedNetworks).toContain('100.64.0.0/10');
      await expect(validateSsrf(endpoint, options.ssrfAllowedNetworks)).resolves.toBeUndefined();
    }
    for (const allowPrivateNetworks of [false, true]) {
      const targetProvider = new ScraplingProvider(createConfig({ endpoint, allowPrivateNetworks }), httpClient as any, createLogger());
      for (const target of ['http://100.64.0.0', 'http://100.127.255.255']) {
        await expect(targetProvider.scrapePage(target)).rejects.toMatchObject({ code: 'ERR_SSRF_BLOCKED' });
        await expect(targetProvider.scrapeListing(target)).rejects.toMatchObject({ code: 'ERR_SSRF_BLOCKED' });
        expect(() => validateSsrfSync(target)).toThrow();
      }
    }
    expect(httpClient.post).toHaveBeenCalledTimes(2);
    for (const target of ['http://100.63.255.255', 'http://100.128.0.0']) {
      expect(() => validateSsrfSync(target)).not.toThrow();
    }
  });

  it('reports unavailable when disabled', async () => {
    const provider = new ScraplingProvider(
      createConfig({ enabled: 'disabled' }),
      createHttpClient() as any,
      createLogger()
    );
    const health = await provider.checkHealth();

    expect(health.status).toBe('unavailable');
    expect(health.error_code).toBe('ERR_EXTRACT_UNAVAILABLE');
  });

  it('maps sidecar health response into ProviderHealth', async () => {
    const httpClient = createHttpClient();
    httpClient.get.mockResolvedValue({
      body: {
        status: 'connected',
        detected_version: '0.4.5',
        runtime: 'docker+python 3.12.0',
      },
    });

    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());
    const health = await provider.checkHealth();

    expect(httpClient.get).toHaveBeenCalledWith('http://127.0.0.1:8090/health', expect.any(Object));
    expect(health.status).toBe('connected');
    expect(health.detected_version).toBe('0.4.5');
    expect(health.runtime).toBe('docker+python 3.12.0');
  });

  it('returns error health when required sidecar is missing', async () => {
    const httpClient = createHttpClient();
    httpClient.get.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const provider = new ScraplingProvider(
      createConfig({ enabled: 'required' }),
      httpClient as any,
      createLogger()
    );
    const health = await provider.checkHealth();

    expect(health.status).toBe('error');
  });

  it('returns normalized full extract results', async () => {
    const httpClient = createHttpClient();
    httpClient.post.mockResolvedValue({
      body: {
        url: 'https://example.com',
        title: 'Example',
        mode_used: 'dynamic',
        selector: '.product',
        goal: 'extract product cards',
        excerpt: 'Card one Card two',
        content: 'Card one\n\nCard two',
        sections: [{ label: '.product', text: 'Card one Card two' }],
        records: [
          { index: 0, text: 'Card one', attributes: { href: '/one' } },
          { index: 1, text: 'Card two' },
        ],
        wordCount: 4,
        degraded: false,
        duration: 321,
      },
    });

    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());
    const result = await provider.extract('https://example.com', {
      selector: '.product',
      goal: 'extract product cards',
      mode: 'auto',
      content_mode: 'full',
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/scrape-page',
      expect.objectContaining({ selector: '.product', goal: 'extract product cards' }),
      expect.any(Object)
    );
    expect(result.mode_used).toBe('dynamic');
    expect(result.selector).toBe('.product');
    expect(result.records).toHaveLength(2);
    expect(result.content_mode).toBe('full');
    expect(result.content_truncated).toBe(false);
  });

  it('returns page-scrape results with entity hints', async () => {
    const httpClient = createHttpClient();
    httpClient.post.mockResolvedValue({
      body: {
        url: 'https://example.com/job',
        title: 'Senior Engineer',
        mode_used: 'dynamic',
        excerpt: 'Senior Engineer at ExampleCo in Berlin',
        content: 'Senior Engineer at ExampleCo in Berlin. Salary €120,000',
        sections: [{ label: 'main_content', text: 'Senior Engineer at ExampleCo in Berlin' }],
        records: [],
        field_candidates: {
          title: 'Senior Engineer',
          company: 'ExampleCo',
          location: 'Berlin',
        },
        wordCount: 9,
        degraded: false,
        duration: 222,
      },
    });

    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());
    const result = await provider.scrapePage('https://example.com/job', {
      entity_type: 'job',
      fields: ['title', 'company', 'location'],
      goal: 'capture the core job details',
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/scrape-page',
      expect.objectContaining({ entity_type: 'job', fields: ['title', 'company', 'location'] }),
      expect.any(Object)
    );
    expect(result.entity_type).toBe('job');
    expect(result.fields_requested).toEqual(['title', 'company', 'location']);
    expect(result.field_candidates?.company).toBe('ExampleCo');
  });

  it('returns listing-scrape results with repeated records', async () => {
    const httpClient = createHttpClient();
    httpClient.post.mockResolvedValue({
      body: {
        url: 'https://example.com/jobs',
        mode_used: 'static',
        item_selector: '.job-card',
        records: [
          {
            index: 0,
            title: 'Platform Engineer',
            url: 'https://example.com/jobs/1',
            text: 'Platform Engineer at ExampleCo in Remote',
            field_candidates: { title: 'Platform Engineer', company: 'ExampleCo', location: 'Remote' },
          },
          {
            index: 1,
            title: 'Data Engineer',
            url: 'https://example.com/jobs/2',
            text: 'Data Engineer at ExampleCo in Berlin',
            field_candidates: { title: 'Data Engineer', company: 'ExampleCo', location: 'Berlin' },
          },
        ],
        duration: 410,
      },
    });

    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());
    const result = await provider.scrapeListing('https://example.com/jobs', {
      entity_type: 'job',
      fields: ['title', 'company', 'location', 'url'],
      maxItems: 10,
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/scrape-listing',
      expect.objectContaining({ entity_type: 'job', maxItems: 10 }),
      expect.any(Object)
    );
    expect(result.item_count).toBe(2);
    expect(result.records[0]?.field_candidates?.company).toBe('ExampleCo');
  });

  it('applies explicit excerpt truncation locally', async () => {
    const httpClient = createHttpClient();
    httpClient.post.mockResolvedValue({
      body: {
        url: 'https://example.com',
        mode_used: 'static',
        excerpt: 'one two three four five',
        content: 'one two three four five',
        sections: [{ label: 'main_content', text: 'one two three four five' }],
        records: [],
      },
    });

    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());
    const result = await provider.extract('https://example.com', {
      content_mode: 'excerpt',
      targetWords: 3,
    });

    expect(result.content_mode).toBe('excerpt');
    expect(result.content).toBe('one two three...');
    expect(result.content_truncated).toBe(true);
    expect(result.truncation).toEqual({
      applied_limit: 3,
      reason: 'explicit_excerpt',
    });
  });

  it('throws ExtractInvalidResponseError on malformed sidecar payload', async () => {
    const httpClient = createHttpClient();
    httpClient.post.mockResolvedValue({ body: { broken: true } });
    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());

    await expect(provider.extract('https://example.com')).rejects.toBeInstanceOf(ExtractInvalidResponseError);
  });

  it('throws ExtractUnavailableError when the sidecar fails', async () => {
    const httpClient = createHttpClient();
    httpClient.post.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());

    await expect(provider.extract('https://example.com')).rejects.toBeInstanceOf(ExtractUnavailableError);
  });

  it('throws ExtractTimeoutError when the sidecar times out', async () => {
    const httpClient = createHttpClient();
    httpClient.post.mockRejectedValue(new TimeoutError('timed out', 'POST', 20000));
    const provider = new ScraplingProvider(createConfig(), httpClient as any, createLogger());

    await expect(provider.extract('https://example.com')).rejects.toBeInstanceOf(ExtractTimeoutError);
  });

  it('passes the sidecar access block through and sends max_tier + time budget', async () => {
    const httpClient = createHttpClient();
    const access = {
      outcome: 'rate_limited',
      upstream_status: null,
      tier: null,
      tried: [],
      retry_after_s: 3600,
      from_memory: true,
      next: 'Rate limited. Do not request example.com again for 3600s.',
    };
    httpClient.post.mockResolvedValue({
      body: { url: 'https://example.com', mode_used: 'static', excerpt: '', content: '', sections: [], records: [], access },
    });
    const provider = new ScraplingProvider(createConfig({ timeout: 120000 }), httpClient as any, createLogger());

    const page = await provider.scrapePage('https://example.com', { max_tier: 'dynamic' });
    expect(page.access).toEqual(access);
    const body = httpClient.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.max_tier).toBe('dynamic');
    expect(body.budget_ms).toBe(115000);

    httpClient.post.mockResolvedValue({ body: { url: 'https://example.com/l', mode_used: 'static', records: [], access } });
    const listing = await provider.scrapeListing('https://example.com/l');
    expect(listing.access?.outcome).toBe('rate_limited');
    expect((httpClient.post.mock.calls[1]![1] as Record<string, unknown>).max_tier).toBeUndefined();
  });
});

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
      'http://127.0.0.1:8090/extract',
      expect.objectContaining({ selector: '.product', goal: 'extract product cards' }),
      expect.any(Object)
    );
    expect(result.mode_used).toBe('dynamic');
    expect(result.selector).toBe('.product');
    expect(result.records).toHaveLength(2);
    expect(result.content_mode).toBe('full');
    expect(result.content_truncated).toBe(false);
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
});

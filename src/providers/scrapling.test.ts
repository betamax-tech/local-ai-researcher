import { describe, it, expect, vi } from 'vitest';

import { ScraplingProvider } from './scrapling.js';
import type { ScraplingConfig } from '../domain/types.js';
import { Logger } from '../lib/logger.js';
import {
  ExtractInvalidResponseError,
  ExtractTimeoutError,
  ExtractUnavailableError,
} from '../lib/errors.js';

function createConfig(overrides: Partial<ScraplingConfig> = {}): ScraplingConfig {
  return {
    enabled: true,
    command: 'python3',
    scriptPath: './scripts/scrapling_bridge.py',
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

describe('ScraplingProvider', () => {
  it('reports unavailable when disabled', async () => {
    const provider = new ScraplingProvider(createConfig({ enabled: false }), createLogger(), vi.fn());
    const health = await provider.checkHealth();

    expect(health.status).toBe('unavailable');
    expect(health.error_code).toBe('ERR_EXTRACT_UNAVAILABLE');
  });

  it('maps bridge health response into ProviderHealth', async () => {
    const executor = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        status: 'connected',
        detected_version: '0.4.5',
        runtime: 'python 3.12.0',
      }),
      stderr: '',
    });

    const provider = new ScraplingProvider(createConfig(), createLogger(), executor);
    const health = await provider.checkHealth();

    expect(health.status).toBe('connected');
    expect(health.detected_version).toBe('0.4.5');
    expect(health.runtime).toBe('python 3.12.0');
  });

  it('returns normalized full extract results', async () => {
    const executor = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
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
      }),
      stderr: '',
    });

    const provider = new ScraplingProvider(createConfig(), createLogger(), executor);
    const result = await provider.extract('https://example.com', {
      selector: '.product',
      goal: 'extract product cards',
      mode: 'auto',
      content_mode: 'full',
    });

    expect(result.mode_used).toBe('dynamic');
    expect(result.selector).toBe('.product');
    expect(result.records).toHaveLength(2);
    expect(result.content_mode).toBe('full');
    expect(result.content_truncated).toBe(false);
  });

  it('applies explicit excerpt truncation locally', async () => {
    const executor = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        url: 'https://example.com',
        mode_used: 'static',
        excerpt: 'one two three four five',
        content: 'one two three four five',
        sections: [{ label: 'main_content', text: 'one two three four five' }],
        records: [],
      }),
      stderr: '',
    });

    const provider = new ScraplingProvider(createConfig(), createLogger(), executor);
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

  it('throws ExtractInvalidResponseError on malformed bridge payload', async () => {
    const executor = vi.fn().mockResolvedValue({ stdout: '{"broken":true}', stderr: '' });
    const provider = new ScraplingProvider(createConfig(), createLogger(), executor);

    await expect(provider.extract('https://example.com')).rejects.toBeInstanceOf(ExtractInvalidResponseError);
  });

  it('throws ExtractUnavailableError when the bridge fails', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('python3: not found'));
    const provider = new ScraplingProvider(createConfig(), createLogger(), executor);

    await expect(provider.extract('https://example.com')).rejects.toBeInstanceOf(ExtractUnavailableError);
  });

  it('throws ExtractTimeoutError when the bridge times out', async () => {
    const timeoutError = Object.assign(new Error('timed out'), { killed: true });
    const executor = vi.fn().mockRejectedValue(timeoutError);
    const provider = new ScraplingProvider(createConfig(), createLogger(), executor);

    await expect(provider.extract('https://example.com')).rejects.toBeInstanceOf(ExtractTimeoutError);
  });
});

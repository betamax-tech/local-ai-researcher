import { describe, it, expect, vi } from 'vitest';

import { createExtractTool, ExtractInputSchema } from './extract.js';
import type { ExtractProvider } from '../providers/interfaces.js';
import type { ExtractResult } from '../domain/types.js';
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

function createProvider(result?: Partial<ExtractResult>): ExtractProvider {
  return {
    id: 'scrapling',
    name: 'Scrapling',
    canExtract: vi.fn().mockReturnValue(true),
    extract: vi.fn().mockResolvedValue({
      url: 'https://example.com',
      mode_requested: 'auto',
      mode_used: 'static',
      excerpt: 'Example excerpt',
      content: 'Example full content',
      content_mode: 'full',
      content_truncated: false,
      sections: [{ label: 'main_content', text: 'Example excerpt' }],
      records: [],
      wordCount: 3,
      degraded: true,
      ...result,
    }),
    checkHealth: vi.fn(),
  };
}

describe('ExtractInputSchema', () => {
  it('defaults mode to auto and content_mode to full', () => {
    const parsed = ExtractInputSchema.parse({ url: 'https://example.com' });
    expect(parsed.mode).toBe('auto');
    expect(parsed.content_mode).toBe('full');
    expect(parsed.maxRecords).toBe(25);
  });
});

describe('createExtractTool', () => {
  it('returns a valid success envelope', async () => {
    const tool = createExtractTool(createProvider(), createLogger());
    const response = await tool.handler({ url: 'https://example.com' });

    expect(response.isError).toBeUndefined();
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');
    expect(envelope.schema_version).toBe('1');
    expect(envelope.ok).toBe(true);
    expect(envelope.meta.provider_id).toBe('scrapling');
    expect(envelope.result.mode_used).toBe('static');
  });

  it('passes selector, goal, mode, and maxRecords to the provider', async () => {
    const provider = createProvider();
    const tool = createExtractTool(provider, createLogger());
    await tool.handler({
      url: 'https://example.com',
      selector: '.item',
      goal: 'extract products',
      mode: 'dynamic',
      maxRecords: 10,
    });

    expect(provider.extract).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
      selector: '.item',
      goal: 'extract products',
      mode: 'dynamic',
      maxRecords: 10,
    }));
  });

  it('returns an error envelope on provider failure', async () => {
    const provider: ExtractProvider = {
      id: 'scrapling',
      name: 'Scrapling',
      canExtract: vi.fn().mockReturnValue(true),
      extract: vi.fn().mockRejectedValue(new ExtractUnavailableError('bridge unavailable')),
      checkHealth: vi.fn(),
    };

    const tool = createExtractTool(provider, createLogger());
    const response = await tool.handler({ url: 'https://example.com' });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(response.isError).toBe(true);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('ERR_EXTRACT_UNAVAILABLE');
    expect(envelope.meta.provider_id).toBe('scrapling');
  });

  it('throws validation error before provider call on unsupported URL', async () => {
    const provider: ExtractProvider = {
      id: 'scrapling',
      name: 'Scrapling',
      canExtract: vi.fn().mockReturnValue(false),
      extract: vi.fn(),
      checkHealth: vi.fn(),
    };

    const tool = createExtractTool(provider, createLogger());
    await expect(tool.handler({ url: 'ftp://example.com' })).rejects.toThrow();
    expect(provider.extract).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createSearchDorkTool, SearchDorkInputSchema } from './searchDork.js';
import { ProviderRegistry } from '../lib/provider-registry.js';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createSearchProvider() {
  return {
    id: 'searxng',
    name: 'SearxNG',
    search: vi.fn().mockResolvedValue([
      { id: '1', url: 'https://example.com', title: 'Example', excerpt: 'Example excerpt', source: 'web' as const },
    ]),
    checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
  };
}

describe('SearchDorkInputSchema', () => {
  it('defaults limit to 10', () => {
    const parsed = SearchDorkInputSchema.parse({ query: 'site:example.com test' });
    expect(parsed.limit).toBe(10);
  });
});

describe('createSearchDorkTool', () => {
  it('forces google engine on the local provider', async () => {
    const localProvider = createSearchProvider();
    const registry = new ProviderRegistry({ auto: localProvider as any, local: localProvider as any });
    const tool = createSearchDorkTool(registry, mockLogger as any);

    const response = await tool.handler({ query: 'site:example.com "privacy policy"' });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(envelope.ok).toBe(true);
    expect(localProvider.search).toHaveBeenCalledWith(
      'site:example.com "privacy policy"',
      expect.objectContaining({ forcedEngines: ['google'], limit: 10 })
    );
  });

  it('returns clear error when local provider is unavailable', async () => {
    const autoProvider = createSearchProvider();
    const registry = new ProviderRegistry({ auto: autoProvider as any });
    const tool = createSearchDorkTool(registry, mockLogger as any);

    const response = await tool.handler({ query: 'site:example.com admin' });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(response.isError).toBe(true);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.message).toContain('requires a configured local SearXNG provider');
  });

  it('works with a single provider directly', async () => {
    const provider = createSearchProvider();
    const tool = createSearchDorkTool(provider as any, mockLogger as any);
    await tool.handler({ query: 'site:example.com inurl:login', limit: 5, language: 'en' });

    expect(provider.search).toHaveBeenCalledWith(
      'site:example.com inurl:login',
      expect.objectContaining({ forcedEngines: ['google'], limit: 5, language: 'en' })
    );
  });
});

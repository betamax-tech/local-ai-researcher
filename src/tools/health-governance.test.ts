import { describe, expect, it, vi } from 'vitest';

import { createHealthTool } from './health.js';
import type { SearchProvider, ReaderProvider, ExtractProvider } from '../providers/interfaces.js';
import type { ProviderManifest } from '../lib/provider-governance.js';
import { Logger } from '../lib/logger.js';

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createSearchProvider(): SearchProvider {
  return {
    id: 'searxng',
    name: 'SearXNG',
    search: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 12, detected_version: '2026.3.29-c8208fa8b' }),
  };
}

function createReaderProvider(): ReaderProvider {
  return {
    id: 'jina-reader',
    name: 'Jina Reader',
    canRead: vi.fn().mockReturnValue(true),
    read: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 18, detected_version: 'operator-managed-runtime' }),
  };
}

function createExtractProvider(status: 'connected' | 'unavailable' = 'unavailable'): ExtractProvider {
  return {
    id: 'scrapling',
    name: 'Scrapling',
    canExtract: vi.fn().mockReturnValue(true),
    extract: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue(
      status === 'connected'
        ? { status, latency_ms: 40, detected_version: '0.4.5', runtime: 'python 3.12.0' }
        : { status, latency_ms: 0, error: 'disabled', error_code: 'ERR_EXTRACT_UNAVAILABLE' }
    ),
  };
}

const manifest: ProviderManifest = {
  schema_version: 1,
  manifest_path: '/tmp/provider-manifest.json',
  providers: {
    searxng: { lane: 'discovery', expected_version: 'searxng/searxng:2026.3.29-c8208fa8b', runtime: 'docker' },
    'jina-reader': { lane: 'read', expected_version: 'operator-managed-jina-reader-runtime', runtime: 'http-endpoint' },
    scrapling: { lane: 'extract', expected_version: 'docker-sidecar:scrapling[fetchers]==0.4.5', runtime: 'docker-local-sidecar', optional: true },
  },
};

describe('health tool provider governance', () => {
  it('surfaces provider manifest metadata and version fields', async () => {
    const tool = createHealthTool(
      createSearchProvider(),
      createReaderProvider(),
      createExtractProvider('connected'),
      createLogger(),
      manifest
    );

    const response = await tool.handler({ provider: 'all' });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(envelope.result.provider_governance).toEqual({
      manifest_loaded: true,
      manifest_path: '/tmp/provider-manifest.json',
      tracked_providers: 3,
    });

    const scrapling = envelope.result.mcp.servers.find((entry: { provider_id: string }) => entry.provider_id === 'scrapling');
    expect(scrapling.expected_version).toBe('docker-sidecar:scrapling[fetchers]==0.4.5');
    expect(scrapling.detected_version).toBe('0.4.5');
    expect(scrapling.optional).toBe(true);
  });

  it('treats optional scrapling outages as degraded rather than unhealthy when required lanes are connected', async () => {
    const tool = createHealthTool(
      createSearchProvider(),
      createReaderProvider(),
      createExtractProvider('unavailable'),
      createLogger(),
      manifest
    );

    const response = await tool.handler({ provider: 'all' });
    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    expect(envelope.result.status).toBe('degraded');
  });
});

/**
 * Tests for ChainedSearchProvider.
 *
 * Contract:
 * - Tries providers in order (primary, fallback_1, fallback_2, ...)
 * - Uses first provider with health 'connected' or 'degraded'
 * - Skips providers with health 'unavailable' or 'error', logs warn
 * - If all providers fail, delegates to last provider (which throws its error)
 * - id/name reflect the currently active provider
 * - checkHealth() returns first healthy provider's health, or last if all down
 * - No shared state mutation — each call is independent (except activeProvider tracking)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChainedSearchProvider } from './chainedFallback.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import type { SearchOptions, SearchResult } from '../domain/types.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeHealth(status: ProviderHealth['status'], error?: string): ProviderHealth {
  return { status, latency_ms: 10, error: error ?? (status !== 'connected' ? `${status} error` : undefined) };
}

function makeResult(url: string): SearchResult {
  return {
    id: 'abc123',
    url,
    title: 'Test',
    excerpt: 'excerpt',
    source: 'web',
  };
}

function makeProvider(id: string, health: ProviderHealth, results: SearchResult[]): SearchProvider {
  return {
    id,
    name: id,
    checkHealth: vi.fn().mockResolvedValue(health),
    search: vi.fn().mockResolvedValue(results),
  };
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

const DEFAULT_OPTIONS: SearchOptions = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChainedSearchProvider', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  // Constructor validation
  describe('constructor', () => {
    it('throws when providers array is empty', () => {
      expect(() => new ChainedSearchProvider([], logger)).toThrow(
        'ChainedSearchProvider requires at least one provider'
      );
    });

    it('accepts single provider', () => {
      const provider = makeProvider('single', makeHealth('connected'), []);
      expect(() => new ChainedSearchProvider([provider], logger)).not.toThrow();
    });
  });

  // id / name delegation
  describe('identity', () => {
    it('exposes first provider id/name before any call', () => {
      const primary = makeProvider('searxng-local', makeHealth('connected'), []);
      const fallback1 = makeProvider('searxng-remote-1', makeHealth('connected'), []);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      expect(provider.id).toBe('searxng-local');
      expect(provider.name).toBe('searxng-local');
    });

    it('updates id/name to active provider after search', async () => {
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('remote-1', makeHealth('connected'), [makeResult('https://remote.com')]);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      await provider.search('test', DEFAULT_OPTIONS);

      expect(provider.id).toBe('remote-1');
      expect(provider.name).toBe('remote-1');
    });
  });

  // Happy path — first provider connected
  describe('search() — first provider connected', () => {
    it('uses first provider when health is connected', async () => {
      const primaryResults = [makeResult('https://primary.com')];
      const primary = makeProvider('primary', makeHealth('connected'), primaryResults);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), [makeResult('https://fallback1.com')]);
      const fallback2 = makeProvider('fallback-2', makeHealth('connected'), [makeResult('https://fallback2.com')]);
      const provider = new ChainedSearchProvider([primary, fallback1, fallback2], logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(primaryResults);
      expect(primary.search).toHaveBeenCalledWith('test query', DEFAULT_OPTIONS);
      expect(fallback1.search).not.toHaveBeenCalled();
      expect(fallback2.search).not.toHaveBeenCalled();
    });

    it('uses first provider when health is degraded', async () => {
      const primaryResults = [makeResult('https://primary.com')];
      const primary = makeProvider('primary', makeHealth('degraded'), primaryResults);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), []);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(primaryResults);
      expect(primary.search).toHaveBeenCalled();
      expect(fallback1.search).not.toHaveBeenCalled();
    });

    it('does not log a warn when first provider is used', async () => {
      const primary = makeProvider('primary', makeHealth('connected'), []);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), []);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      await provider.search('q', DEFAULT_OPTIONS);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // Fallback activation — first provider unavailable
  describe('search() — fallback chain', () => {
    it('skips unavailable provider and uses next healthy one', async () => {
      const fallback1Results = [makeResult('https://fallback1.com')];
      const primary = makeProvider('primary', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), fallback1Results);
      const fallback2 = makeProvider('fallback-2', makeHealth('connected'), []);
      const provider = new ChainedSearchProvider([primary, fallback1, fallback2], logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(fallback1Results);
      expect(primary.search).not.toHaveBeenCalled();
      expect(fallback1.search).toHaveBeenCalledWith('test query', DEFAULT_OPTIONS);
      expect(fallback2.search).not.toHaveBeenCalled();
    });

    it('skips multiple unavailable providers', async () => {
      const fallback2Results = [makeResult('https://fallback2.com')];
      const primary = makeProvider('primary', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('fallback-1', makeHealth('error'), []);
      const fallback2 = makeProvider('fallback-2', makeHealth('connected'), fallback2Results);
      const provider = new ChainedSearchProvider([primary, fallback1, fallback2], logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(fallback2Results);
      expect(primary.search).not.toHaveBeenCalled();
      expect(fallback1.search).not.toHaveBeenCalled();
      expect(fallback2.search).toHaveBeenCalledWith('test query', DEFAULT_OPTIONS);
    });

    it('logs a warn for each skipped provider', async () => {
      const primary = makeProvider('primary', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('fallback-1', makeHealth('error'), []);
      const fallback2 = makeProvider('fallback-2', makeHealth('connected'), [makeResult('https://ok.com')]);
      const provider = new ChainedSearchProvider([primary, fallback1, fallback2], logger);

      await provider.search('q', DEFAULT_OPTIONS);

      expect(logger.warn).toHaveBeenCalledTimes(2);
      
      const firstWarnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(firstWarnCall?.[1]).toMatchObject({
        component: 'ChainedSearchProvider',
        providerId: 'primary',
        healthStatus: 'unavailable',
      });

      const secondWarnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondWarnCall?.[1]).toMatchObject({
        component: 'ChainedSearchProvider',
        providerId: 'fallback-1',
        healthStatus: 'error',
      });
    });

    it('delegates to last provider when all are down', async () => {
      const primary = makeProvider('primary', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('fallback-1', makeHealth('error'), []);
      const fallback2 = makeProvider('fallback-2', makeHealth('unavailable'), []);
      fallback2.search = vi.fn().mockRejectedValue(new Error('Last provider failed'));
      
      const provider = new ChainedSearchProvider([primary, fallback1, fallback2], logger);

      await expect(provider.search('test', DEFAULT_OPTIONS)).rejects.toThrow('Last provider failed');
      
      expect(fallback2.search).toHaveBeenCalledWith('test', DEFAULT_OPTIONS);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // Per-call independence
  describe('per-call independence', () => {
    it('re-probes providers on every call — recovers when primary comes back', async () => {
      const primaryResults = [makeResult('https://primary.com')];
      const fallback1Results = [makeResult('https://fallback1.com')];

      // First call: primary down
      const primary = makeProvider('primary', makeHealth('unavailable'), primaryResults);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), fallback1Results);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      const first = await provider.search('q', DEFAULT_OPTIONS);
      expect(first).toEqual(fallback1Results);

      // Simulate primary recovery
      (primary.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue(makeHealth('connected'));

      const second = await provider.search('q', DEFAULT_OPTIONS);
      expect(second).toEqual(primaryResults);
    });

    it('probes each provider independently', async () => {
      const primary = makeProvider('primary', makeHealth('connected'), [makeResult('https://p.com')]);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), [makeResult('https://f.com')]);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      await provider.search('q1', DEFAULT_OPTIONS);
      await provider.search('q2', DEFAULT_OPTIONS);

      // Both calls went to primary (first healthy provider)
      expect(primary.search).toHaveBeenCalledTimes(2);
      expect(fallback1.search).not.toHaveBeenCalled();
      // Health check called 2 times (once per search call)
      expect(primary.checkHealth).toHaveBeenCalledTimes(2);
    });
  });

  // checkHealth()
  describe('checkHealth()', () => {
    it('returns first healthy provider health', async () => {
      const primaryHealth = makeHealth('connected');
      const primary = makeProvider('primary', primaryHealth, []);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), []);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      const health = await provider.checkHealth();
      expect(health).toEqual(primaryHealth);
      expect(fallback1.checkHealth).not.toHaveBeenCalled();
    });

    it('returns first degraded provider health', async () => {
      const fallback1Health = makeHealth('degraded');
      const primary = makeProvider('primary', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('fallback-1', fallback1Health, []);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      const health = await provider.checkHealth();
      expect(health).toEqual(fallback1Health);
    });

    it('returns last provider health when all are down', async () => {
      const fallback2Health = makeHealth('unavailable', 'Connection refused');
      const primary = makeProvider('primary', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('fallback-1', makeHealth('error'), []);
      const fallback2 = makeProvider('fallback-2', fallback2Health, []);
      const provider = new ChainedSearchProvider([primary, fallback1, fallback2], logger);

      const health = await provider.checkHealth();
      expect(health).toEqual(fallback2Health);
      expect(primary.checkHealth).toHaveBeenCalled();
      expect(fallback1.checkHealth).toHaveBeenCalled();
      expect(fallback2.checkHealth).toHaveBeenCalled();
    });

    it('updates activeProvider to first healthy', async () => {
      const primary = makeProvider('primary', makeHealth('unavailable'), []);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), []);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      await provider.checkHealth();

      expect(provider.id).toBe('fallback-1');
      expect(provider.name).toBe('fallback-1');
    });
  });
});

/**
 * Tests for ChainedSearchProvider.
 *
 * Contract:
 * - Tries providers' search() in order; fails over when a search throws (no health pre-probe)
 * - A provider that failed is skipped for a cool-down, unless all are cooling down
 * - If all providers fail, throws SearxngUnavailableError naming every attempt
 * - id/name reflect the currently active provider
 * - checkHealth() returns first healthy provider's health, or last if all down
 * - No shared state mutation — each call is independent (except activeProvider tracking)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChainedSearchProvider } from './chainedFallback.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import type { SearchOptions, SearchResult } from '../domain/types.js';
import { Logger } from '../lib/logger.js';
import { SearxngUnavailableError } from '../lib/errors.js';

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
      const primary = makeProvider('local', makeHealth('connected'), []);
      primary.search = vi.fn().mockRejectedValue(new Error('down'));
      const fallback1 = makeProvider('remote-1', makeHealth('connected'), [makeResult('https://remote.com')]);
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      await provider.search('test', DEFAULT_OPTIONS);

      expect(provider.id).toBe('remote-1');
      expect(provider.name).toBe('remote-1');
    });
  });

  // Happy path — primary answers
  describe('search() — primary succeeds', () => {
    it('uses the first provider and never touches the fallbacks', async () => {
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
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not probe health before searching (one request per search)', async () => {
      const primary = makeProvider('primary', makeHealth('unavailable'), [makeResult('https://p.com')]);
      const provider = new ChainedSearchProvider([primary], logger);

      // Regression (2026-10-10): a failing probe used to skip a working primary.
      const results = await provider.search('q', DEFAULT_OPTIONS);

      expect(results).toEqual([makeResult('https://p.com')]);
      expect(primary.checkHealth).not.toHaveBeenCalled();
    });
  });

  // Failover on real errors
  describe('search() — fallback chain', () => {
    it('fails over to the next provider when the primary search throws', async () => {
      const fallback1Results = [makeResult('https://fallback1.com')];
      const primary = makeProvider('primary', makeHealth('connected'), []);
      primary.search = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), fallback1Results);
      const fallback2 = makeProvider('fallback-2', makeHealth('connected'), []);
      const provider = new ChainedSearchProvider([primary, fallback1, fallback2], logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(fallback1Results);
      expect(fallback1.search).toHaveBeenCalledWith('test query', DEFAULT_OPTIONS);
      expect(fallback2.search).not.toHaveBeenCalled();
      expect(provider.id).toBe('fallback-1');
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
        component: 'ChainedSearchProvider',
        providerId: 'primary',
        error: 'connect ECONNREFUSED',
      });
    });

    it('when all fail, the error names every attempt (not just the last)', async () => {
      const primary = makeProvider('primary', makeHealth('connected'), []);
      primary.search = vi.fn().mockRejectedValue(new Error('timeout'));
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), []);
      fallback1.search = vi.fn().mockRejectedValue(new Error('HTTP request failed: 429 Too Many Requests'));
      const provider = new ChainedSearchProvider([primary, fallback1], logger);

      const err = await provider.search('q', DEFAULT_OPTIONS).catch(e => e);

      expect(err).toBeInstanceOf(SearxngUnavailableError);
      expect(err.message).toContain('#0 primary: timeout');
      expect(err.message).toContain('#1 fallback-1: HTTP request failed: 429');
      expect(logger.error).toHaveBeenCalled();
    });

    it('a single provider keeps its own typed error', async () => {
      const only = makeProvider('only', makeHealth('connected'), []);
      const own = new Error('Last provider failed');
      only.search = vi.fn().mockRejectedValue(own);
      const provider = new ChainedSearchProvider([only], logger);

      await expect(provider.search('q', DEFAULT_OPTIONS)).rejects.toBe(own);
    });
  });

  // Cool-down after a failure
  describe('cool-down', () => {
    it('skips a failed provider until its cool-down passes, then retries it', async () => {
      let t = 1_000;
      const primary = makeProvider('primary', makeHealth('connected'), [makeResult('https://p.com')]);
      primary.search = vi.fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue([makeResult('https://p.com')]);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), [makeResult('https://f.com')]);
      const provider = new ChainedSearchProvider([primary, fallback1], logger, { cooldownMs: 30_000, now: () => t });

      expect(await provider.search('q1', DEFAULT_OPTIONS)).toEqual([makeResult('https://f.com')]);
      t += 10_000;
      expect(await provider.search('q2', DEFAULT_OPTIONS)).toEqual([makeResult('https://f.com')]);
      expect(primary.search).toHaveBeenCalledTimes(1); // skipped while cooling down
      t += 30_000;
      expect(await provider.search('q3', DEFAULT_OPTIONS)).toEqual([makeResult('https://p.com')]);
      expect(primary.search).toHaveBeenCalledTimes(2);
    });

    it('tries everything when every provider is cooling down', async () => {
      const t = 1_000;
      const primary = makeProvider('primary', makeHealth('connected'), []);
      primary.search = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue([makeResult('https://p.com')]);
      const fallback1 = makeProvider('fallback-1', makeHealth('connected'), []);
      fallback1.search = vi.fn().mockRejectedValue(new Error('down too'));
      const provider = new ChainedSearchProvider([primary, fallback1], logger, { now: () => t });

      await expect(provider.search('q1', DEFAULT_OPTIONS)).rejects.toThrow('All search providers failed');
      expect(await provider.search('q2', DEFAULT_OPTIONS)).toEqual([makeResult('https://p.com')]);
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

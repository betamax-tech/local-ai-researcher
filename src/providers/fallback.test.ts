/**
 * Tests for FallbackSearchProvider.
 *
 * Contract:
 * - Uses primary when primary health is 'connected' or 'degraded'
 * - Falls back to secondary when primary health is 'unavailable' or 'error'
 * - id/name always reflect the primary's id/name (static delegation)
 * - checkHealth() returns primary health when healthy, fallback health when down
 * - Logs a warn with component + reason on fallback activation
 * - No shared state mutation — each call is independent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FallbackSearchProvider } from './fallback.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import type { SearchOptions, SearchResult } from '../domain/types.js';
import { Logger } from '../lib/logger.js';
import { ErrorCode, SearxngUnavailableError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeHealth(status: ProviderHealth['status']): ProviderHealth {
  return { status, latency_ms: 10, error: status !== 'connected' ? `${status} error` : undefined };
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

describe('FallbackSearchProvider', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  // id / name delegation
  describe('identity', () => {
    it('exposes primary id and name', () => {
      const primary = makeProvider('searxng-local', makeHealth('connected'), []);
      const fallback = makeProvider('searxng-remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      expect(provider.id).toBe('searxng-local');
      expect(provider.name).toBe('searxng-local');
    });
  });

  // Happy path — primary connected
  describe('search() — primary connected', () => {
    it('uses primary when health is connected', async () => {
      const primaryResults = [makeResult('https://example.com/primary')];
      const primary = makeProvider('local', makeHealth('connected'), primaryResults);
      const fallback = makeProvider('remote', makeHealth('connected'), [makeResult('https://example.com/fallback')]);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(primaryResults);
      expect(primary.search).toHaveBeenCalledWith('test query', DEFAULT_OPTIONS);
      expect(fallback.search).not.toHaveBeenCalled();
    });

    it('uses primary when health is degraded', async () => {
      const primaryResults = [makeResult('https://example.com/primary')];
      const primary = makeProvider('local', makeHealth('degraded'), primaryResults);
      const fallback = makeProvider('remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(primaryResults);
      expect(primary.search).toHaveBeenCalled();
      expect(fallback.search).not.toHaveBeenCalled();
    });

    it('does not log a warn when primary is used', async () => {
      const primary = makeProvider('local', makeHealth('connected'), []);
      const fallback = makeProvider('remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      await provider.search('q', DEFAULT_OPTIONS);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // Fallback activation — primary unavailable
  describe('search() — primary unavailable', () => {
    it('uses fallback when primary health is unavailable', async () => {
      const fallbackResults = [makeResult('https://example.com/fallback')];
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', makeHealth('connected'), fallbackResults);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(fallbackResults);
      expect(primary.search).not.toHaveBeenCalled();
      expect(fallback.search).toHaveBeenCalledWith('test query', DEFAULT_OPTIONS);
    });

    it('uses fallback when primary health is error', async () => {
      const fallbackResults = [makeResult('https://example.com/fallback')];
      const primary = makeProvider('local', makeHealth('error'), []);
      const fallback = makeProvider('remote', makeHealth('connected'), fallbackResults);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const results = await provider.search('test query', DEFAULT_OPTIONS);

      expect(results).toEqual(fallbackResults);
      expect(fallback.search).toHaveBeenCalled();
    });

    it('logs a warn with component and reason on fallback activation', async () => {
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      await provider.search('q', DEFAULT_OPTIONS);

      expect(logger.warn).toHaveBeenCalledOnce();
      const [, meta] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
      expect(meta).toMatchObject({ component: 'FallbackSearchProvider' });
    });

    it('passes query and options through to fallback unchanged', async () => {
      const opts: SearchOptions = { limit: 3, language: 'fr' };
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      await provider.search('specific query', opts);

      expect(fallback.search).toHaveBeenCalledWith('specific query', opts);
    });
  });

  // Per-call independence
  describe('per-call independence', () => {
    it('re-probes primary health on every call — recovers when primary comes back', async () => {
      const primaryResults = [makeResult('https://primary.com')];
      const fallbackResults = [makeResult('https://fallback.com')];

      // First call: primary down
      const primary = makeProvider('local', makeHealth('unavailable'), primaryResults);
      const fallback = makeProvider('remote', makeHealth('connected'), fallbackResults);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const first = await provider.search('q', DEFAULT_OPTIONS);
      expect(first).toEqual(fallbackResults);

      // Simulate primary recovery
      (primary.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue(makeHealth('connected'));

      const second = await provider.search('q', DEFAULT_OPTIONS);
      expect(second).toEqual(primaryResults);
    });

    it('does not share state between calls', async () => {
      const primary = makeProvider('local', makeHealth('connected'), [makeResult('https://p.com')]);
      const fallback = makeProvider('remote', makeHealth('connected'), [makeResult('https://f.com')]);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      await provider.search('q1', DEFAULT_OPTIONS);
      await provider.search('q2', DEFAULT_OPTIONS);

      // Both calls went to primary
      expect(primary.search).toHaveBeenCalledTimes(2);
      expect(fallback.search).not.toHaveBeenCalled();
    });
  });

  // JSON-fallback rule (2026-10-12 SearXNG junk-results investigation, P7):
  // don't silently hand a JSON-mode caller to a fallback that can't serve
  // JSON (e.g. a public instance with format=json disabled). checkHealth()
  // surfaces this as error_code ERR_SEARXNG_JSON_UNSUPPORTED.
  describe('search() — fallback cannot serve JSON (format_json_unsupported)', () => {
    it('fails loudly instead of calling a JSON-unsupported fallback', async () => {
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', {
        status: 'degraded',
        latency_ms: 50,
        error: 'Quality canary failed — instance did not return a valid JSON results array',
        error_code: ErrorCode.ERR_SEARXNG_JSON_UNSUPPORTED,
      }, []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const error = await provider.search('q', DEFAULT_OPTIONS).then(
        () => undefined,
        err => err as SearxngUnavailableError
      );

      expect(error).toBeInstanceOf(SearxngUnavailableError);
      expect((error as SearxngUnavailableError).code).toBe(ErrorCode.ERR_SEARXNG_UNAVAILABLE);
      expect((error as SearxngUnavailableError).message).toContain('format=json');
      expect(fallback.search).not.toHaveBeenCalled();
    });

    it('logs a warn naming format_json_unsupported before failing loudly', async () => {
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', {
        status: 'degraded',
        latency_ms: 50,
        error: 'bad',
        error_code: ErrorCode.ERR_SEARXNG_JSON_UNSUPPORTED,
      }, []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      await provider.search('q', DEFAULT_OPTIONS).catch(() => undefined);

      expect(logger.warn).toHaveBeenCalledOnce();
      const [, meta] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
      expect(meta).toMatchObject({ component: 'FallbackSearchProvider', reason: 'format_json_unsupported' });
    });

    it('still uses a fallback that is connected/degraded for a reason other than JSON support', async () => {
      const fallbackResults = [makeResult('https://example.com/fallback')];
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', {
        status: 'degraded',
        latency_ms: 50,
        error: 'Quality canary query "x" returned zero results',
        error_code: ErrorCode.ERR_SEARXNG_LOW_QUALITY,
      }, fallbackResults);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const results = await provider.search('q', DEFAULT_OPTIONS);

      expect(results).toEqual(fallbackResults);
      expect(fallback.search).toHaveBeenCalled();
    });

    it('checks fallback health before delegating when primary is down', async () => {
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      await provider.search('q', DEFAULT_OPTIONS);

      expect(fallback.checkHealth).toHaveBeenCalled();
      expect(fallback.search).toHaveBeenCalled();
    });
  });

  // checkHealth()
  describe('checkHealth()', () => {
    it('returns primary health when primary is connected', async () => {
      const primaryHealth = makeHealth('connected');
      const primary = makeProvider('local', primaryHealth, []);
      const fallback = makeProvider('remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const health = await provider.checkHealth();
      expect(health).toEqual(primaryHealth);
      expect(fallback.checkHealth).not.toHaveBeenCalled();
    });

    it('returns primary health when primary is degraded', async () => {
      const primaryHealth = makeHealth('degraded');
      const primary = makeProvider('local', primaryHealth, []);
      const fallback = makeProvider('remote', makeHealth('connected'), []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const health = await provider.checkHealth();
      expect(health).toEqual(primaryHealth);
    });

    it('returns fallback health when primary is unavailable', async () => {
      const fallbackHealth = makeHealth('connected');
      const primary = makeProvider('local', makeHealth('unavailable'), []);
      const fallback = makeProvider('remote', fallbackHealth, []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const health = await provider.checkHealth();
      expect(health).toEqual(fallbackHealth);
      expect(fallback.checkHealth).toHaveBeenCalled();
    });

    it('returns fallback health when primary is error', async () => {
      const fallbackHealth = makeHealth('degraded');
      const primary = makeProvider('local', makeHealth('error'), []);
      const fallback = makeProvider('remote', fallbackHealth, []);
      const provider = new FallbackSearchProvider(primary, fallback, logger);

      const health = await provider.checkHealth();
      expect(health).toEqual(fallbackHealth);
    });
  });
});

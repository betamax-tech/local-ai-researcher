/**
 * ChainedSearchProvider — multi-tier fallback chain that fails over on real errors.
 *
 * On every search() call:
 *   1. Iterate providers in order (primary, fallback_1, fallback_2, ...),
 *      skipping any provider that failed within the last `cooldownMs`
 *      (unless every provider is cooling down — then all are tried).
 *   2. Call search() on the provider. Success → return its results.
 *   3. Failure → mark it cooling down, log a warn, try the next one.
 *   4. All failed → throw SearxngUnavailableError naming every attempt.
 *
 * Why not probe health first (the previous design, until 2026-10-10)?
 *   - A probe is an extra request per search to every engine-backed instance.
 *   - The probe and the search can disagree: the probe used `GET /search`
 *     without a query, which the searxng-resilient-router answers with 400, so
 *     the local instance was skipped on every call and all queries went to
 *     public fallbacks — whose 429 was then the only error the caller saw.
 *   Failing over on the search's own outcome fixes both.
 *
 * id / name expose whichever provider handled the last call so
 * meta.provider_id in tool responses stays accurate.
 *
 * checkHealth() returns the first healthy provider's health, or the last
 * provider's health if all are down (used by the health tool only).
 */

import type { SearchOptions, SearchResult } from '../domain/types.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import { Logger } from '../lib/logger.js';
import { SearxngUnavailableError } from '../lib/errors.js';

export interface ChainedSearchOptions {
  /** How long a provider that just failed is skipped (ms). Default 30 s. */
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class ChainedSearchProvider implements SearchProvider {
  private readonly providers: SearchProvider[];
  private readonly logger: Logger;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly downUntil = new Map<number, number>();
  private activeProvider: SearchProvider;

  constructor(providers: SearchProvider[], logger: Logger, options: ChainedSearchOptions = {}) {
    if (providers.length === 0) {
      throw new Error('ChainedSearchProvider requires at least one provider');
    }
    this.providers = providers;
    this.logger = logger;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
    // Default to first provider for synchronous id/name access
    this.activeProvider = providers[0]!;
  }

  /**
   * The active provider id reflects whichever handled the last call.
   * Falls back to first provider before any calls are made.
   */
  get id(): string {
    return this.activeProvider.id;
  }

  get name(): string {
    return this.activeProvider.name;
  }

  /** Provider indexes to try, in order: not cooling down; or all if every one is. */
  private candidates(): number[] {
    const t = this.now();
    const all = this.providers.map((_, i) => i);
    const ready = all.filter(i => (this.downUntil.get(i) ?? 0) <= t);
    return ready.length > 0 ? ready : all;
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const attempts: string[] = [];
    let lastError: unknown;

    for (const i of this.candidates()) {
      const provider = this.providers[i]!;
      try {
        const results = await provider.search(query, options);
        this.downUntil.delete(i);
        this.activeProvider = provider;
        if (attempts.length > 0) {
          this.logger.info('ChainedSearchProvider: served by fallback', {
            component: 'ChainedSearchProvider',
            providerIndex: i,
            providerId: provider.id,
            failedBefore: attempts,
          });
        }
        return results;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(`#${i} ${provider.name}: ${message}`);
        this.downUntil.set(i, this.now() + this.cooldownMs);
        this.activeProvider = provider;
        this.logger.warn('ChainedSearchProvider: provider failed, trying next in chain', {
          component: 'ChainedSearchProvider',
          providerIndex: i,
          providerId: provider.id,
          providerName: provider.name,
          error: message,
          cooldownMs: this.cooldownMs,
        });
      }
    }

    this.logger.error('ChainedSearchProvider: all providers failed', {
      component: 'ChainedSearchProvider',
      attempts,
    });

    if (attempts.length === 1) {
      throw lastError; // single provider: keep its own typed error
    }
    throw new SearxngUnavailableError(
      `All search providers failed — ${attempts.join(' | ')}`,
      { query, attempts }
    );
  }

  /**
   * Returns the first healthy provider's health, or the last provider's
   * health if all are down. Useful for the health tool to report actual state.
   */
  async checkHealth(): Promise<ProviderHealth> {
    let lastHealth: ProviderHealth | null = null;

    for (const provider of this.providers) {
      const health = await provider.checkHealth();
      lastHealth = health;

      if (health.status === 'connected' || health.status === 'degraded') {
        this.activeProvider = provider;
        return health;
      }
    }

    // All providers down — return last health
    const lastProvider = this.providers[this.providers.length - 1]!;
    this.activeProvider = lastProvider;
    return lastHealth!;
  }
}

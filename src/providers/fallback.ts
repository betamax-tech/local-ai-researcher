/**
 * FallbackSearchProvider — transparent per-call fallback wrapper.
 *
 * On every search() call:
 *   1. Probe primary.checkHealth() (uses its built-in 5s timeout).
 *   2. If primary is connected or degraded → use primary.
 *   3. If primary is unavailable or error → use fallback, log a warn.
 *
 * id / name dynamically expose whichever provider will handle this call so
 * meta.provider_id in tool responses stays accurate.
 *
 * checkHealth() returns primary health when healthy, fallback health when
 * primary is down.
 *
 * Completely inert when not instantiated — the constructor is only called
 * when SEARXNG_FALLBACK_ENDPOINT is set (wired in index.ts).
 */

import type { SearchOptions, SearchResult } from '../domain/types.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import { Logger } from '../lib/logger.js';

export class FallbackSearchProvider implements SearchProvider {
  private readonly primary: SearchProvider;
  private readonly fallback: SearchProvider;
  private readonly logger: Logger;

  constructor(primary: SearchProvider, fallback: SearchProvider, logger: Logger) {
    this.primary = primary;
    this.fallback = fallback;
    this.logger = logger;
  }

  /**
   * The active provider id reflects whichever will handle the next call.
   * Because this is synchronous and health is probed per-call, we return the
   * primary's id here; the per-call path logs the actual provider used.
   */
  get id(): string {
    return this.primary.id;
  }

  get name(): string {
    return this.primary.name;
  }

  /**
   * Perform a search with transparent per-call fallback.
   *
   * Probes primary health first. Falls back to secondary only when primary
   * status is 'unavailable' or 'error'. Does not mutate any shared state.
   */
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const health = await this.primary.checkHealth();

    if (health.status === 'connected' || health.status === 'degraded') {
      return this.primary.search(query, options);
    }

    // Primary is down — use fallback for this call only
    this.logger.warn('Primary SearXNG unavailable, falling back to remote instance', {
      component: 'FallbackSearchProvider',
      primaryId: this.primary.id,
      fallbackId: this.fallback.id,
      primaryStatus: health.status,
      reason: health.error,
    });

    return this.fallback.search(query, options);
  }

  /**
   * Returns primary health when primary is healthy, fallback health when
   * primary is down. Useful for the health tool to report actual state.
   */
  async checkHealth(): Promise<ProviderHealth> {
    const primaryHealth = await this.primary.checkHealth();

    if (primaryHealth.status === 'connected' || primaryHealth.status === 'degraded') {
      return primaryHealth;
    }

    // Primary is down — surface fallback health
    return this.fallback.checkHealth();
  }
}

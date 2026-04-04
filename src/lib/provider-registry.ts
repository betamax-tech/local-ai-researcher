/**
 * Provider Registry — maps aliases to concrete SearchProvider instances.
 *
 * Supports explicit provider selection via the `provider` parameter in tools.
 * - `auto` = current chained fallback behavior (default)
 * - `local` = force local SearXNG only
 * - `fallback1` = force first fallback (https://searx.party/)
 * - `fallback2` = force second fallback (https://search.sapti.me/)
 *
 * When an explicit provider is requested but unavailable, returns a clear
 * error instead of silently falling back.
 */

import type { SearchProvider } from '../providers/interfaces.js';
import { ProviderUnavailableError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Valid provider aliases for explicit provider selection.
 * - `auto` — use chained fallback behavior (default)
 * - `local` — force local SearXNG instance
 * - `fallback1` — force first fallback instance
 * - `fallback2` — force second fallback instance
 */
export type ProviderAlias = 'auto' | 'local' | 'fallback1' | 'fallback2';

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

/**
 * Registry that maps provider aliases to concrete SearchProvider instances.
 *
 * Construction:
 * - `auto` provider is required (typically ChainedSearchProvider)
 * - `local` is optional (local SearXNG may not be configured)
 * - `fallback1`, `fallback2` are optional (may not be configured)
 *
 * Resolution:
 * - `auto` always resolves to the chained provider
 * - Explicit aliases resolve to single providers if configured
 * - Unconfigured aliases throw ProviderUnavailableError
 */
export class ProviderRegistry {
  private readonly providers: Map<ProviderAlias, SearchProvider>;
  private readonly availableAliases: ProviderAlias[];

  constructor(options: {
    /** Auto (chained) provider — required */
    auto: SearchProvider;
    /** Local SearXNG provider — optional */
    local?: SearchProvider;
    /** First fallback provider — optional */
    fallback1?: SearchProvider;
    /** Second fallback provider — optional */
    fallback2?: SearchProvider;
  }) {
    this.providers = new Map();

    // Auto is always available
    this.providers.set('auto', options.auto);

    // Register optional providers
    if (options.local) {
      this.providers.set('local', options.local);
    }
    if (options.fallback1) {
      this.providers.set('fallback1', options.fallback1);
    }
    if (options.fallback2) {
      this.providers.set('fallback2', options.fallback2);
    }

    // Track available aliases
    this.availableAliases = Array.from(this.providers.keys());
  }

  /**
   * Get the list of available provider aliases.
   */
  getAvailableAliases(): ProviderAlias[] {
    return [...this.availableAliases];
  }

  /**
   * Check if a provider alias is available.
   */
  isAvailable(alias: ProviderAlias): boolean {
    return this.providers.has(alias);
  }

  /**
   * Resolve a provider alias to a concrete SearchProvider.
   *
   * @param alias - The provider alias to resolve
   * @returns The concrete SearchProvider
   * @throws ProviderUnavailableError if the alias is not configured
   */
  resolve(alias: ProviderAlias): SearchProvider {
    const provider = this.providers.get(alias);
    if (!provider) {
      throw new ProviderUnavailableError(
        `Provider '${alias}' is not configured. Available providers: ${this.availableAliases.join(', ')}`,
        { requestedAlias: alias, availableAliases: this.availableAliases }
      );
    }
    return provider;
  }

  /**
   * Get the auto (chained) provider.
   */
  getAutoProvider(): SearchProvider {
    return this.providers.get('auto')!;
  }
}

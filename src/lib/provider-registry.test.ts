/**
 * Tests for ProviderRegistry
 *
 * Tests verify:
 * 1. ProviderRegistry resolves aliases to providers
 * 2. ProviderRegistry handles unavailable aliases correctly
 * 3. ProviderRegistry exposes available aliases
 */

import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from './provider-registry.js';
import type { SearchProvider } from '../providers/interfaces.js';
import { ProviderUnavailableError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockProvider(id: string, name: string): SearchProvider {
  return {
    id,
    name,
    search: vi.fn().mockResolvedValue([]),
    checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
  } as unknown as SearchProvider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  describe('construction', () => {
    it('requires auto provider', () => {
      const autoProvider = createMockProvider('auto', 'Auto Provider');
      const registry = new ProviderRegistry({ auto: autoProvider });
      expect(registry).toBeDefined();
    });

    it('accepts optional providers', () => {
      const autoProvider = createMockProvider('auto', 'Auto Provider');
      const localProvider = createMockProvider('local', 'Local Provider');
      const fallback1Provider = createMockProvider('fallback1', 'Fallback 1');
      const fallback2Provider = createMockProvider('fallback2', 'Fallback 2');

      const registry = new ProviderRegistry({
        auto: autoProvider,
        local: localProvider,
        fallback1: fallback1Provider,
        fallback2: fallback2Provider,
      });

      expect(registry.isAvailable('auto')).toBe(true);
      expect(registry.isAvailable('local')).toBe(true);
      expect(registry.isAvailable('fallback1')).toBe(true);
      expect(registry.isAvailable('fallback2')).toBe(true);
    });

    it('only exposes auto when no optional providers given', () => {
      const autoProvider = createMockProvider('auto', 'Auto Provider');
      const registry = new ProviderRegistry({ auto: autoProvider });

      expect(registry.isAvailable('auto')).toBe(true);
      expect(registry.isAvailable('local')).toBe(false);
      expect(registry.isAvailable('fallback1')).toBe(false);
      expect(registry.isAvailable('fallback2')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('resolves auto to the chained provider', () => {
      const autoProvider = createMockProvider('chained', 'Chained Provider');
      const registry = new ProviderRegistry({ auto: autoProvider });

      const resolved = registry.resolve('auto');
      expect(resolved).toBe(autoProvider);
    });

    it('resolves local to the local provider when configured', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const localProvider = createMockProvider('local-searxng', 'Local SearXNG');
      const registry = new ProviderRegistry({
        auto: autoProvider,
        local: localProvider,
      });

      const resolved = registry.resolve('local');
      expect(resolved).toBe(localProvider);
    });

    it('resolves fallback1 to the first fallback when configured', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const fallback1Provider = createMockProvider('searx-party', 'searx.party');
      const registry = new ProviderRegistry({
        auto: autoProvider,
        fallback1: fallback1Provider,
      });

      const resolved = registry.resolve('fallback1');
      expect(resolved).toBe(fallback1Provider);
    });

    it('resolves fallback2 to the second fallback when configured', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const fallback2Provider = createMockProvider('sapti-me', 'search.sapti.me');
      const registry = new ProviderRegistry({
        auto: autoProvider,
        fallback2: fallback2Provider,
      });

      const resolved = registry.resolve('fallback2');
      expect(resolved).toBe(fallback2Provider);
    });

    it('throws ProviderUnavailableError for unconfigured local', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const registry = new ProviderRegistry({ auto: autoProvider });

      expect(() => registry.resolve('local')).toThrow(ProviderUnavailableError);
    });

    it('throws ProviderUnavailableError for unconfigured fallback1', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const registry = new ProviderRegistry({ auto: autoProvider });

      expect(() => registry.resolve('fallback1')).toThrow(ProviderUnavailableError);
    });

    it('throws ProviderUnavailableError for unconfigured fallback2', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const registry = new ProviderRegistry({ auto: autoProvider });

      expect(() => registry.resolve('fallback2')).toThrow(ProviderUnavailableError);
    });

    it('error message includes available providers', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const localProvider = createMockProvider('local', 'Local');
      const registry = new ProviderRegistry({
        auto: autoProvider,
        local: localProvider,
      });

      try {
        registry.resolve('fallback1');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderUnavailableError);
        expect((error as ProviderUnavailableError).message).toContain('Available providers:');
        expect((error as ProviderUnavailableError).message).toContain('auto');
        expect((error as ProviderUnavailableError).message).toContain('local');
      }
    });
  });

  describe('isAvailable', () => {
    it('returns true for configured providers', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const localProvider = createMockProvider('local', 'Local');
      const registry = new ProviderRegistry({
        auto: autoProvider,
        local: localProvider,
      });

      expect(registry.isAvailable('auto')).toBe(true);
      expect(registry.isAvailable('local')).toBe(true);
      expect(registry.isAvailable('fallback1')).toBe(false);
      expect(registry.isAvailable('fallback2')).toBe(false);
    });
  });

  describe('getAvailableAliases', () => {
    it('returns only auto when no optional providers', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const registry = new ProviderRegistry({ auto: autoProvider });

      const aliases = registry.getAvailableAliases();
      expect(aliases).toEqual(['auto']);
    });

    it('returns all configured aliases', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const localProvider = createMockProvider('local', 'Local');
      const fallback1Provider = createMockProvider('fb1', 'FB1');
      const registry = new ProviderRegistry({
        auto: autoProvider,
        local: localProvider,
        fallback1: fallback1Provider,
      });

      const aliases = registry.getAvailableAliases();
      expect(aliases).toContain('auto');
      expect(aliases).toContain('local');
      expect(aliases).toContain('fallback1');
      expect(aliases).toHaveLength(3);
    });
  });

  describe('getAutoProvider', () => {
    it('returns the auto provider', () => {
      const autoProvider = createMockProvider('auto', 'Auto');
      const registry = new ProviderRegistry({ auto: autoProvider });

      expect(registry.getAutoProvider()).toBe(autoProvider);
    });
  });
});

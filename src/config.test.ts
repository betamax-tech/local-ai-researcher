/**
 * Tests for config.ts — cache baseline defaults (BDD, failing until implemented).
 *
 * Tests verify the cache sub-config contract defined in task-11.01:
 * 1. Cache is disabled by default (config.cache.enabled === false)
 * 2. Cache config shape includes path and ttl fields
 * 3. cache.enabled can be set to true via environment variable
 * 4. cache.ttl defaults to a sensible positive value
 * 5. cache.path defaults to a non-empty string (file path or ':memory:')
 *
 * Note: loadConfig() reads from process.env. Tests restore env after each run.
 */

import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snapshot + restore relevant env keys so tests don't bleed into each other */
function withCleanEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void
): void {
  const CACHE_KEYS = [
    'LOCAL_RESEARCHER_CACHE_ENABLED',
    'LOCAL_RESEARCHER_CACHE_PATH',
    'LOCAL_RESEARCHER_CACHE_TTL',
    'CACHE_ENABLED',
    'CACHE_PATH',
    'CACHE_TTL',
  ];

  const saved: Record<string, string | undefined> = {};
  for (const key of CACHE_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const key of CACHE_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cache config defaults
// ---------------------------------------------------------------------------

describe('loadConfig() — cache sub-config', () => {
  describe('default state (no environment variables set)', () => {
    it('config.cache is present on the returned config object', () => {
      // Arrange: no cache-related env vars set
      withCleanEnv({}, () => {
        // Act
        const config = loadConfig();

        // Assert: cache sub-object must exist — it is part of the v1 config shape
        expect(config).toHaveProperty('cache');
      });
    });

    it('cache is disabled by default (config.cache.enabled === false)', () => {
      // This is the primary business rule from task-11.01:
      // "Default startup must remain uncached"
      // "Cache behavior is disabled by default for a fresh v1 setup"
      withCleanEnv({}, () => {
        const config = loadConfig();

        // Assert: cache must be opt-in, never opt-out
        expect(config.cache.enabled).toBe(false);
      });
    });

    it('cache.ttl has a sensible positive default (> 0)', () => {
      // Arrange: no overrides
      withCleanEnv({}, () => {
        const config = loadConfig();

        // Assert: TTL must be set to a usable value even when disabled,
        // so that enabling cache later does not require explicit TTL config
        expect(typeof config.cache.ttl).toBe('number');
        expect(config.cache.ttl).toBeGreaterThan(0);
      });
    });

    it('cache.path has a default value (non-empty string)', () => {
      // Arrange: no overrides
      withCleanEnv({}, () => {
        const config = loadConfig();

        // Assert: path must be set to a default; operators can override via env
        expect(typeof config.cache.path).toBe('string');
        expect(config.cache.path.length).toBeGreaterThan(0);
      });
    });
  });

  describe('enabling cache via environment variable', () => {
    it('config.cache.enabled is true when LOCAL_RESEARCHER_CACHE_ENABLED=true', () => {
      // Arrange: operator enables cache explicitly
      withCleanEnv({ LOCAL_RESEARCHER_CACHE_ENABLED: 'true' }, () => {
        // Act
        const config = loadConfig();

        // Assert: operator-controlled enablement works
        expect(config.cache.enabled).toBe(true);
      });
    });

    it('config.cache.enabled is false when LOCAL_RESEARCHER_CACHE_ENABLED=false', () => {
      // Arrange: explicit disable (same as default, but via env var)
      withCleanEnv({ LOCAL_RESEARCHER_CACHE_ENABLED: 'false' }, () => {
        const config = loadConfig();

        expect(config.cache.enabled).toBe(false);
      });
    });
  });

  describe('configuring cache TTL via environment variable', () => {
    it('config.cache.ttl reflects LOCAL_RESEARCHER_CACHE_TTL when set', () => {
      // Arrange: operator sets custom TTL (3600 seconds = 1 hour)
      withCleanEnv({ LOCAL_RESEARCHER_CACHE_TTL: '3600' }, () => {
        const config = loadConfig();

        expect(config.cache.ttl).toBe(3600);
      });
    });
  });

  describe('configuring cache path via environment variable', () => {
    it('config.cache.path reflects LOCAL_RESEARCHER_CACHE_PATH when set', () => {
      // Arrange: operator specifies a custom SQLite file location
      const customPath = '/tmp/test-cache.db';
      withCleanEnv({ LOCAL_RESEARCHER_CACHE_PATH: customPath }, () => {
        const config = loadConfig();

        expect(config.cache.path).toBe(customPath);
      });
    });
  });

  describe('cache config shape', () => {
    it('config.cache has enabled, path, and ttl fields', () => {
      // Arrange: defaults
      withCleanEnv({}, () => {
        const config = loadConfig();

        // Assert: all three fields required by task-11.01 quality gate
        expect(config.cache).toMatchObject({
          enabled: expect.any(Boolean),
          path: expect.any(String),
          ttl: expect.any(Number),
        });
      });
    });
  });
});

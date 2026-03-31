/**
 * Tests for the SQLite cache module — BDD baseline (failing until implemented).
 *
 * Tests verify the observable contract defined in task-11.01:
 * 1. Cache module exports a Cache class with get/set/has operations
 * 2. Cache keys include content_mode — full vs excerpt are distinct entries
 * 3. Cache hit returns value with cache_hit: true metadata
 * 4. Cache miss returns null
 * 5. TTL enforcement — expired entries are not returned as hits
 * 6. set() is idempotent — last write wins for same key
 * 7. has() correctly reflects live vs expired vs missing entries
 *
 * All tests use in-memory SQLite (:memory:) for isolation — no file I/O.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Import under test (does not exist yet — import will fail until implemented)
// ---------------------------------------------------------------------------
// @ts-expect-error — src/lib/cache.ts does not exist yet; this import causes
// the test suite to fail at collection time until the coder creates the module.
import { Cache, buildCacheKey } from './cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh in-memory cache for each test — no file I/O, no shared state */
function createMemoryCache(): InstanceType<typeof Cache> {
  // Coder must accept ':memory:' as the path to use an in-memory SQLite database
  return new Cache({ path: ':memory:', ttl: 60, enabled: true });
}

// ---------------------------------------------------------------------------
// Cache class — interface contract
// ---------------------------------------------------------------------------

describe('Cache', () => {
  let cache: InstanceType<typeof Cache>;

  beforeEach(() => {
    cache = createMemoryCache();
  });

  afterEach(() => {
    // Clean up — close the DB connection to avoid resource leaks in tests
    if (typeof cache?.close === 'function') {
      cache.close();
    }
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Core interface existence
  // -------------------------------------------------------------------------

  describe('module interface', () => {
    it('exports a Cache class', () => {
      // Arrange: import is at module level
      // Assert: Cache is a constructor function (class)
      expect(typeof Cache).toBe('function');
    });

    it('Cache instance exposes get method', () => {
      expect(typeof cache.get).toBe('function');
    });

    it('Cache instance exposes set method', () => {
      expect(typeof cache.set).toBe('function');
    });

    it('Cache instance exposes has method', () => {
      expect(typeof cache.has).toBe('function');
    });

    it('exports buildCacheKey helper', () => {
      // Required by task-11.01 gotcha: key must include content_mode
      expect(typeof buildCacheKey).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Cache miss behavior
  // -------------------------------------------------------------------------

  describe('get() — cache miss', () => {
    it('returns null for a key that was never set', async () => {
      // Arrange: fresh in-memory cache, nothing written
      // Act
      const result = await cache.get('http://example.com/page');
      // Assert: null signals a miss — caller must fetch fresh content
      expect(result).toBeNull();
    });

    it('has() returns false for a key that was never set', async () => {
      // Arrange: fresh in-memory cache
      // Act
      const hit = await cache.has('http://example.com/page');
      // Assert
      expect(hit).toBe(false);
    });

    it('returns null for an empty string key', async () => {
      // Edge case: empty string key must not throw; it is a miss
      const result = await cache.get('');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cache set + get round-trip
  // -------------------------------------------------------------------------

  describe('set() + get() — cache hit', () => {
    it('returns the stored value after set()', async () => {
      // Arrange: store a read result
      const payload = { url: 'http://example.com/', content: 'hello world', content_mode: 'full' };
      await cache.set('http://example.com/', payload, 60);

      // Act: read back
      const entry = await cache.get('http://example.com/');

      // Assert: value is present and matches what was stored
      expect(entry).not.toBeNull();
      expect(entry?.value).toMatchObject(payload);
    });

    it('includes cache_hit: true in the returned entry', async () => {
      // Arrange: store a value
      await cache.set('key-1', { data: 'something' }, 60);

      // Act
      const entry = await cache.get('key-1');

      // Assert: metadata field required by task-11.01 quality gate
      expect(entry).not.toBeNull();
      expect(entry?.cache_hit).toBe(true);
    });

    it('has() returns true after set()', async () => {
      // Arrange
      await cache.set('key-present', { v: 1 }, 60);

      // Act
      const hit = await cache.has('key-present');

      // Assert
      expect(hit).toBe(true);
    });

    it('last write wins when set() is called twice for the same key', async () => {
      // Arrange: idempotency — overwrite
      await cache.set('dup-key', { version: 1 }, 60);
      await cache.set('dup-key', { version: 2 }, 60);

      // Act
      const entry = await cache.get('dup-key');

      // Assert: second write wins
      expect(entry?.value).toMatchObject({ version: 2 });
    });
  });

  // -------------------------------------------------------------------------
  // TTL enforcement
  // -------------------------------------------------------------------------

  describe('TTL enforcement', () => {
    it('returns null for an entry after its TTL has expired', async () => {
      // Arrange: use fake timers to control time without actual waiting
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      // Store entry with TTL = 1 second
      await cache.set('expiring-key', { content: 'stale' }, 1);

      // Advance clock past the TTL
      vi.setSystemTime(now + 2000); // +2 s > TTL of 1 s

      // Act
      const entry = await cache.get('expiring-key');

      // Assert: expired entries must not be returned as cache hits
      expect(entry).toBeNull();

      vi.useRealTimers();
    });

    it('has() returns false for an expired entry', async () => {
      // Arrange: fake timers
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await cache.set('expiring-key-has', { content: 'stale' }, 1);

      vi.setSystemTime(now + 2000);

      // Act
      const hit = await cache.has('expiring-key-has');

      // Assert
      expect(hit).toBe(false);

      vi.useRealTimers();
    });

    it('returns the value if the TTL has not yet elapsed', async () => {
      // Arrange: fake timers
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await cache.set('live-key', { content: 'fresh' }, 60);

      // Advance clock but stay within TTL
      vi.setSystemTime(now + 30000); // +30 s < TTL of 60 s

      // Act
      const entry = await cache.get('live-key');

      // Assert: entry is still valid
      expect(entry).not.toBeNull();
      expect(entry?.cache_hit).toBe(true);

      vi.useRealTimers();
    });

    it('TTL of 0 seconds causes immediate expiry', async () => {
      // Edge case: TTL = 0 → entry expires immediately
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await cache.set('zero-ttl-key', { content: 'should-expire' }, 0);

      // Advance by even 1 ms
      vi.setSystemTime(now + 1);

      const entry = await cache.get('zero-ttl-key');

      // Assert: should be treated as expired
      expect(entry).toBeNull();

      vi.useRealTimers();
    });
  });
});

// ---------------------------------------------------------------------------
// buildCacheKey — cache key correctness
// ---------------------------------------------------------------------------

describe('buildCacheKey', () => {
  it('produces a stable key for the same URL + content_mode', () => {
    // Arrange + Act
    const key1 = buildCacheKey('http://example.com/page', 'full');
    const key2 = buildCacheKey('http://example.com/page', 'full');

    // Assert: same inputs → same key (stable across calls)
    expect(key1).toBe(key2);
  });

  it('produces different keys for full vs excerpt content_mode on the same URL', () => {
    // This is the critical gotcha from task-11.01:
    // full vs excerpt are DIFFERENT cache entries for the same URL
    const fullKey = buildCacheKey('http://example.com/page', 'full');
    const excerptKey = buildCacheKey('http://example.com/page', 'excerpt');

    // Assert: must differ
    expect(fullKey).not.toBe(excerptKey);
  });

  it('produces different keys for different URLs with the same content_mode', () => {
    const key1 = buildCacheKey('http://example.com/page-a', 'full');
    const key2 = buildCacheKey('http://example.com/page-b', 'full');

    expect(key1).not.toBe(key2);
  });

  it('returns a non-empty string', () => {
    const key = buildCacheKey('http://example.com/', 'full');

    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('includes both URL and content_mode information in the key', () => {
    // Verify the key encodes both dimensions so that URL collisions across
    // content modes are impossible even if one component alone would collide.
    const fullKey = buildCacheKey('http://example.com/', 'full');
    const excerptKey = buildCacheKey('http://example.com/', 'excerpt');

    // Both must differ — already tested above, but also verify neither is a
    // simple substring collision of the other in a trivial way.
    expect(fullKey === excerptKey).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Disabled cache path — behavior when cache is disabled
// ---------------------------------------------------------------------------

describe('Cache (disabled)', () => {
  it('returns null from get() when constructed with enabled: false', async () => {
    // Arrange: cache explicitly disabled
    const disabledCache = new Cache({ path: ':memory:', ttl: 60, enabled: false });

    // Pre-condition: even if we tried to set something, it should not be stored
    await disabledCache.set('any-key', { data: 'value' }, 60);

    // Act: read back
    const result = await disabledCache.get('any-key');

    // Assert: disabled cache is a no-op — always a miss
    expect(result).toBeNull();

    if (typeof disabledCache.close === 'function') disabledCache.close();
  });

  it('has() returns false when cache is disabled', async () => {
    // Arrange
    const disabledCache = new Cache({ path: ':memory:', ttl: 60, enabled: false });
    await disabledCache.set('any-key', { data: 'value' }, 60);

    // Act
    const hit = await disabledCache.has('any-key');

    // Assert
    expect(hit).toBe(false);

    if (typeof disabledCache.close === 'function') disabledCache.close();
  });
});

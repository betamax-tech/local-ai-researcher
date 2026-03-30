/**
 * Interface contract tests for SearchProvider and ReaderProvider (task 13.01).
 *
 * These tests FAIL on the current codebase because:
 *   1. `src/providers/interfaces.ts` does not exist yet.
 *   2. Neither SearxngProvider nor JinaReaderProvider has a `get id()` getter.
 *   3. The `implements SearchProvider` / `implements ReaderProvider` declarations
 *      are absent — TypeScript cannot verify structural satisfaction.
 *
 * Tests are structured in two complementary layers:
 *   - Type-level:   Assigning a concrete instance to an interface-typed variable
 *                   proves compile-time structural satisfaction. If the shape is
 *                   wrong the file will not compile and the test suite fails.
 *   - Runtime:      Verify the `id` getter returns a non-empty string and that
 *                   `checkHealth()` returns an object matching the ProviderHealth
 *                   shape (status ∈ union, latency_ms is a number, optional fields
 *                   are absent when unused).
 *
 * DO NOT modify this file to make tests pass — implement the interfaces and
 * provider additions in the coder task.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Interfaces under contract ─────────────────────────────────────────────
// These imports will cause a compile error until interfaces.ts is created.
import type { SearchProvider, ReaderProvider, ProviderHealth } from './interfaces.js';

// ── Concrete providers ────────────────────────────────────────────────────
import { SearxngProvider } from './searxng.js';
import { JinaReaderProvider } from './jinaReader.js';
import type { SearxngConfig, JinaReaderConfig } from '../domain/types.js';
import { HttpClient } from '../lib/http.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Mock factories — mirror the patterns used in searxng.test.ts and
// jinaReader.test.ts so construction is identical.
// ---------------------------------------------------------------------------

function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
  } as unknown as HttpClient;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createSearxngConfig(): SearxngConfig {
  return {
    endpoint: 'http://localhost:8888',
    timeout: 10000,
    allowPrivateNetworks: true,
  };
}

function createJinaConfig(): JinaReaderConfig {
  return {
    endpoint: 'https://r.jina.ai/',
    timeout: 15000,
  };
}

// ---------------------------------------------------------------------------
// Shared valid ProviderHealth statuses (locked union per spec)
// ---------------------------------------------------------------------------

const VALID_HEALTH_STATUSES = new Set([
  'connected',
  'degraded',
  'unavailable',
  'error',
] as const);

// ---------------------------------------------------------------------------
// Helper: runtime ProviderHealth shape guard
// ---------------------------------------------------------------------------

function assertProviderHealthShape(result: unknown): void {
  expect(result).toBeDefined();
  expect(typeof result).toBe('object');
  expect(result).not.toBeNull();

  const health = result as Record<string, unknown>;

  // status: one of the locked union values
  expect(typeof health.status).toBe('string');
  expect(VALID_HEALTH_STATUSES.has(health.status as ProviderHealth['status'])).toBe(true);

  // latency_ms: required, non-negative number
  expect(typeof health.latency_ms).toBe('number');
  expect(health.latency_ms as number).toBeGreaterThanOrEqual(0);

  // error: optional — if present, must be string
  if (health.error !== undefined) {
    expect(typeof health.error).toBe('string');
  }

  // error_code: optional — if present, must be string
  if (health.error_code !== undefined) {
    expect(typeof health.error_code).toBe('string');
  }
}

// ===========================================================================
// SearxngProvider — SearchProvider interface contract
// ===========================================================================

describe('SearxngProvider satisfies SearchProvider', () => {
  let provider: SearxngProvider;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    provider = new SearxngProvider(createSearxngConfig(), mockHttpClient, createMockLogger());
  });

  // ── Type-level: structural assignability ────────────────────────────────
  //
  // Assigning `provider` to a `SearchProvider`-typed variable proves that
  // TypeScript accepts the concrete class as a structural implementation of
  // the interface. If any required member is missing or wrongly typed the
  // compiler will reject this file and the test run fails.

  it('is structurally assignable to SearchProvider (type-level contract)', () => {
    // This assignment is the test. If interfaces.ts is missing or SearxngProvider
    // lacks the required members, TypeScript will emit a compile error here.
    const asInterface: SearchProvider = provider;

    // Runtime smoke-check: the variable is the same object
    expect(asInterface).toBe(provider);
  });

  // ── Runtime: id getter ──────────────────────────────────────────────────

  it('exposes a non-empty string id getter', () => {
    // `get id()` does not exist yet — accessing it currently returns undefined.
    // After the coder adds `get id(): string { return 'searxng'; }` this passes.
    expect(typeof provider.id).toBe('string');
    expect(provider.id.length).toBeGreaterThan(0);
  });

  it('id getter is idempotent — returns the same value on repeated access', () => {
    expect(provider.id).toBe(provider.id);
  });

  it('id is "searxng" (canonical provider identifier)', () => {
    expect(provider.id).toBe('searxng');
  });

  // ── Runtime: name getter (already exists, verified for interface parity) ─

  it('exposes a non-empty string name getter', () => {
    expect(typeof provider.name).toBe('string');
    expect(provider.name.length).toBeGreaterThan(0);
  });

  // ── Runtime: search() method signature ─────────────────────────────────

  it('exposes a search() method', () => {
    expect(typeof provider.search).toBe('function');
  });

  // ── Runtime: checkHealth() returns ProviderHealth shape ─────────────────

  it('checkHealth() returns an object matching ProviderHealth shape on connected response', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
    });

    const result = await provider.checkHealth();

    assertProviderHealthShape(result);
    // SearxngProvider does not emit 'degraded' (no slow-response detection)
    expect(result.status).toBe('connected');
  });

  it('checkHealth() status is one of the ProviderHealth union values on failure', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Connection refused')
    );

    const result = await provider.checkHealth();

    assertProviderHealthShape(result);
    // Must be a valid union value, not undefined or an arbitrary string
    expect(VALID_HEALTH_STATUSES.has(result.status)).toBe(true);
  });

  it('checkHealth() latency_ms is a non-negative number', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
    });

    const result = await provider.checkHealth();

    expect(typeof result.latency_ms).toBe('number');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('checkHealth() does not include error or error_code on success', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
    });

    const result = await provider.checkHealth();

    expect(result.error).toBeUndefined();
    expect(result.error_code).toBeUndefined();
  });
});

// ===========================================================================
// JinaReaderProvider — ReaderProvider interface contract
// ===========================================================================

describe('JinaReaderProvider satisfies ReaderProvider', () => {
  let provider: JinaReaderProvider;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    provider = new JinaReaderProvider(createJinaConfig(), mockHttpClient, createMockLogger());
  });

  // ── Type-level: structural assignability ────────────────────────────────

  it('is structurally assignable to ReaderProvider (type-level contract)', () => {
    // Same pattern as SearchProvider — compile error if interface members missing.
    const asInterface: ReaderProvider = provider;

    expect(asInterface).toBe(provider);
  });

  // ── Runtime: id getter ──────────────────────────────────────────────────

  it('exposes a non-empty string id getter', () => {
    // `get id()` does not exist yet on JinaReaderProvider.
    expect(typeof provider.id).toBe('string');
    expect(provider.id.length).toBeGreaterThan(0);
  });

  it('id getter is idempotent — returns the same value on repeated access', () => {
    expect(provider.id).toBe(provider.id);
  });

  it('id is "jina-reader" (canonical provider identifier)', () => {
    expect(provider.id).toBe('jina-reader');
  });

  // ── Runtime: name getter ────────────────────────────────────────────────

  it('exposes a non-empty string name getter', () => {
    expect(typeof provider.name).toBe('string');
    expect(provider.name.length).toBeGreaterThan(0);
  });

  // ── Runtime: canRead() method ───────────────────────────────────────────

  it('exposes a canRead() method', () => {
    expect(typeof provider.canRead).toBe('function');
  });

  it('canRead() returns boolean for any input', () => {
    expect(typeof provider.canRead('https://example.com')).toBe('boolean');
    expect(typeof provider.canRead('')).toBe('boolean');
  });

  // ── Runtime: read() method signature ────────────────────────────────────

  it('exposes a read() method', () => {
    expect(typeof provider.read).toBe('function');
  });

  // ── Runtime: checkHealth() returns ProviderHealth shape ─────────────────

  it('checkHealth() returns an object matching ProviderHealth shape on connected response', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      body: {
        url: 'https://example.com',
        title: 'Example',
        content: 'Hello world',
      },
    });

    const result = await provider.checkHealth();

    assertProviderHealthShape(result);
    expect(result.status).toBe('connected');
  });

  it('checkHealth() returns degraded status — included in ProviderHealth union', async () => {
    // JinaReaderProvider already emits 'degraded' for slow responses (>2000ms).
    // This test verifies 'degraded' is part of the ProviderHealth contract.
    vi.useFakeTimers();

    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(2100);
      return {
        status: 200,
        body: { url: 'https://example.com', title: 'Example', content: 'Hello world' },
      };
    });

    const result = await provider.checkHealth();

    assertProviderHealthShape(result);
    expect(result.status).toBe('degraded');

    vi.useRealTimers();
  });

  it('checkHealth() status is one of the ProviderHealth union values on failure', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ECONNREFUSED')
    );

    const result = await provider.checkHealth();

    assertProviderHealthShape(result);
    expect(VALID_HEALTH_STATUSES.has(result.status)).toBe(true);
  });

  it('checkHealth() latency_ms is a non-negative number', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      body: { url: 'https://example.com', title: 'Example', content: 'Hello world' },
    });

    const result = await provider.checkHealth();

    expect(typeof result.latency_ms).toBe('number');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('checkHealth() does not include error or error_code on success', async () => {
    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      body: { url: 'https://example.com', title: 'Example', content: 'Hello world' },
    });

    const result = await provider.checkHealth();

    expect(result.error).toBeUndefined();
    expect(result.error_code).toBeUndefined();
  });
});

// ===========================================================================
// ProviderHealth shape — standalone contract tests
// ===========================================================================

describe('ProviderHealth type contract', () => {
  // These tests document the exact shape required by the ProviderHealth interface.
  // They fail because ProviderHealth does not yet exist in interfaces.ts.

  it('SearchProvider checkHealth() status is constrained to the 4-value union', async () => {
    // Exhaustive union check via the Set guard — the runtime value must be
    // one of: connected | degraded | unavailable | error
    const mockHttpClient = createMockHttpClient();
    const provider = new SearxngProvider(
      createSearxngConfig(),
      mockHttpClient,
      createMockLogger()
    );

    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 200 });

    const result = await provider.checkHealth();

    // If status were an arbitrary string this would fail
    const validStatuses: ReadonlyArray<string> = ['connected', 'degraded', 'unavailable', 'error'];
    expect(validStatuses).toContain(result.status);
  });

  it('ReaderProvider checkHealth() status is constrained to the 4-value union', async () => {
    const mockHttpClient = createMockHttpClient();
    const provider = new JinaReaderProvider(
      createJinaConfig(),
      mockHttpClient,
      createMockLogger()
    );

    (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      body: { url: 'https://example.com', title: 'Example', content: 'Hello world' },
    });

    const result = await provider.checkHealth();

    const validStatuses: ReadonlyArray<string> = ['connected', 'degraded', 'unavailable', 'error'];
    expect(validStatuses).toContain(result.status);
  });
});

/**
 * Provider interface contracts — task 13.01.
 *
 * Defines the shared type boundary for search and reader providers.
 * All concrete providers must implement these interfaces to participate
 * in the provider layer.
 */

import type { SearchOptions, ReadOptions, SearchResult, ReadResult } from '../domain/types.js';

// ---------------------------------------------------------------------------
// ProviderHealth
// ---------------------------------------------------------------------------

/**
 * Structured health probe result — shared by all provider types.
 *
 * Status semantics:
 * - `connected`   — endpoint is reachable and responding normally.
 * - `degraded`    — endpoint is reachable but responding slowly or partially.
 * - `unavailable` — connection failed, timed out, or returned a non-success status.
 * - `error`       — configuration problem (e.g. SSRF blocked); not a connectivity issue.
 */
export interface ProviderHealth {
  status: 'connected' | 'degraded' | 'unavailable' | 'error';
  latency_ms: number;
  error?: string;
  error_code?: string;
}

// ---------------------------------------------------------------------------
// SearchProvider
// ---------------------------------------------------------------------------

/**
 * Contract for web search providers.
 *
 * Implementors must expose a stable `id` and `name` for traceability,
 * a `search()` method returning normalized domain results, and a
 * `checkHealth()` probe for readiness checks.
 */
export interface SearchProvider {
  readonly id: string;
  readonly name: string;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  checkHealth(): Promise<ProviderHealth>;
}

// ---------------------------------------------------------------------------
// ReaderProvider
// ---------------------------------------------------------------------------

/**
 * Contract for URL content extraction providers.
 *
 * Implementors must expose a stable `id` and `name` for traceability,
 * a `canRead()` guard, a `read()` method returning normalized domain results,
 * and a `checkHealth()` probe for readiness checks.
 */
export interface ReaderProvider {
  readonly id: string;
  readonly name: string;
  canRead(url: string): boolean;
  read(url: string, options: ReadOptions): Promise<ReadResult>;
  checkHealth(): Promise<ProviderHealth>;
}

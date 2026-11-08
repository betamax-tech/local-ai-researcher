/**
 * SearxNG provider — locked v1 implementation.
 *
 * Boundary contract:
 * - Outputs normalized SearchResult domain objects (no provider-specific leakage).
 * - Throws typed error codes from the locked taxonomy (ERR_SEARXNG_*).
 * - id is a deterministic hash of canonical URL + query + position.
 * - excerpt is always populated (30-line default).
 */

import { createHash } from 'crypto';

import type { SearchResult, SearxngConfig } from '../domain/types.js';
import { HttpClient } from '../lib/http.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import {
  SearxngTimeoutError,
  SearxngUnavailableError,
  SearxngInvalidResponseError,
  SsrfError,
  ErrorCode,
} from '../lib/errors.js';
import { TimeoutError } from '../lib/errors.js';
import { canonicalizeUrl } from '../lib/url.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** SearxNG search options */
export interface SearxngSearchOptions {
  /** Number of results (default: 10, max: 50) */
  limit?: number;

  /** Search category (optional) */
  category?: string;

  /** Language code (optional) */
  language?: string;

  /** Time filter (optional) */
  timeRange?: string;

  /** Force specific engines on this request (internal higher-level tool hint) */
  forcedEngines?: string[];
}

/** Raw SearxNG API response shape */
interface SearxngResponse {
  query: string;
  results: Array<{
    url: string;
    title: string;
    content: string;
    engine?: string;
    category?: string;
    publishedDate?: string;
    score?: number;
  }>;
}

/**
 * Quality-probe canary for {@link SearxngProvider.checkHealth}.
 *
 * `/healthz` only proves the instance is reachable — it says nothing about
 * whether `format=json` actually works (public instances commonly disable
 * it) or whether the result set is junk (engine-suspension / safesearch
 * gaps leaking off-topic content). When a canary is configured, checkHealth()
 * runs one real search and inspects the result for both failure modes before
 * reporting `connected`. See the 2026-10-12 SearXNG junk-results
 * investigation (P7) for the motivating incident.
 */
export interface SearxngHealthCanary {
  /** Query sent to probe search quality. Should be specific enough that a
   *  healthy, on-topic engine mix returns real hits (bare/ambiguous tokens
   *  are exactly what exposes an unfiltered engine — see the investigation's
   *  "RA 4726" / "misconduct" examples). */
  query: string;
  /** Result URLs containing any of these substrings mark the probe
   *  'degraded' even though the instance answered 200 — off-topic/adult
   *  content leaking through an engine with no safesearch support. */
  junkDomains: string[];
}

/**
 * Default canary — a specific, on-topic technical query (low ambiguity) plus
 * the junk-domain set observed leaking through unfiltered engines in the
 * 2026-10-12 investigation (adult content, generic game/sim sites).
 */
export const DEFAULT_SEARXNG_HEALTH_CANARY: SearxngHealthCanary = {
  query: 'pgvector HNSW index larger than RAM',
  junkDomains: [
    'pornhub.com',
    'xvideos.com',
    'xnxx.com',
    'xhamster.com',
    'redtube.com',
    'youporn.com',
    'onlyfans.com',
    'chaturbate.com',
    'stripchat.com',
    'friv.com',
    'framesynthesis.com',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce the first `lines` lines of a text block (excerpt-first model).
 * Matches the 30-line default specified in the PRD.
 */
function firstLines(text: string, lines: number): string {
  return text.split('\n').slice(0, lines).join('\n');
}

/**
 * Deterministic result ID: SHA-256 of canonical URL + query + position.
 * Same request always produces the same ID regardless of result ordering.
 */
function makeResultId(canonicalUrl: string, query: string, position: number): string {
  return createHash('sha256')
    .update(`${canonicalUrl}::${query}::${position}`)
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Constructor options for {@link SearxngProvider}. */
export interface SearxngProviderOptions {
  /**
   * Enables the quality-probe stage of checkHealth(). Undefined (default)
   * preserves the pre-2026-10-12 reachability-only contract exactly —
   * existing callers and the generic ProviderHealth interface tests are
   * unaffected. Pass {@link DEFAULT_SEARXNG_HEALTH_CANARY} (or a custom
   * canary) to opt a specific instance into quality-aware health reporting;
   * `index.ts` enables it for every live SearxngProvider.
   */
  healthCanary?: SearxngHealthCanary;
}

/** SearxNG provider */
export class SearxngProvider implements SearchProvider {
  private config: SearxngConfig;
  private httpClient: HttpClient;
  private logger: Logger;
  private readonly healthCanary?: SearxngHealthCanary;

  constructor(
    config: SearxngConfig,
    httpClient: HttpClient,
    logger: Logger,
    options?: SearxngProviderOptions
  ) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger;
    this.healthCanary = options?.healthCanary;
  }

  get id(): string {
    return 'searxng';
  }

  get name(): string {
    return 'SearxNG';
  }

  /** Endpoint without a trailing slash, so paths join cleanly. */
  private get base(): string {
    return this.config.endpoint.replace(/\/+$/, '');
  }

  private get ssrfAllowed(): string[] {
    return this.config.allowPrivateNetworks
      ? ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10']
      : [];
  }

  /**
   * Check if the SearxNG instance is reachable.
   * @returns true when {@link checkHealth} reports `connected`
   */
  async isHealthy(): Promise<boolean> {
    const health = await this.checkHealth();
    return health.status === 'connected';
  }

  /**
   * Probe SearxNG and return structured readiness with latency.
   *
   * Two stages:
   * 1. **Reachability** — `GET /healthz`. Always run; unchanged from the
   *    original v1 contract (see {@link probeReachability}).
   * 2. **Quality** (only when a `healthCanary` was supplied at construction,
   *    and only when stage 1 reports `connected`) — runs a real canary
   *    search via {@link probeQuality} and downgrades `connected` to
   *    `degraded` when the response can't actually be used: not valid JSON
   *    (`format=json` unsupported — common on public instances), zero
   *    results (the documented "200 but engine-suspended" failure mode), or
   *    a junk-domain hit (an unfiltered engine leaking off-topic content).
   *
   * Quality probing is opt-in via the constructor so the shared
   * `SearchProvider`/`ProviderHealth` interface contract (one request,
   * `connected` on any sub-500 `/healthz` answer) is unchanged for callers
   * that don't configure a canary. `index.ts` enables it for every
   * live-wired instance (local + both public fallbacks) per the 2026-10-12
   * SearXNG junk-results investigation, P7.
   *
   * @returns Structured health result with latency and optional error info
   */
  async checkHealth(): Promise<ProviderHealth> {
    const reachability = await this.probeReachability();
    if (reachability.status !== 'connected' || !this.healthCanary) {
      return reachability;
    }
    return this.probeQuality(this.healthCanary, reachability.latency_ms);
  }

  /**
   * Stage 1 — `GET /healthz` reachability probe (served by SearXNG and by
   * the searxng-resilient-router). **Any HTTP answer below 500 counts as
   * connected**. The previous probe (`GET /search` with no query, accepting
   * only 200/405) failed against the router, which answers `400 missing q` —
   * and `HttpClient` throws on every non-2xx — so `auto` search skipped the
   * local instance on every call and sent all queries to public fallbacks.
   *
   * Status semantics:
   * - `connected`   — the server answered (status < 500).
   * - `unavailable` — connection failed, timed out, or the server answered 5xx.
   * - `error`       — request was blocked by SSRF protection; treat as a
   *                   configuration problem (error_code: ERR_SSRF_BLOCKED).
   */
  private async probeReachability(): Promise<ProviderHealth> {
    const startTime = Date.now();
    let status: number | undefined;

    try {
      const response = await this.httpClient.get(`${this.base}/healthz`, {
        timeout: 5000,
        retry: false,
        ssrfAllowedNetworks: this.ssrfAllowed,
      });
      status = response.status;
    } catch (error) {
      const latency_ms = Date.now() - startTime;

      // SSRF-blocked requests are a configuration problem, not a connectivity problem
      if (error instanceof SsrfError) {
        this.logger.warn('SearxNG checkHealth: SSRF blocked', {
          component: 'SearxngProvider',
          latency_ms,
          error: error.message,
        });
        return {
          status: 'error',
          latency_ms,
          error: error.message,
          error_code: ErrorCode.ERR_SSRF_BLOCKED,
        };
      }

      // HttpClient throws on non-2xx; the status rides along in details.
      const httpStatus = (error as { details?: { status?: unknown } })?.details?.status;
      if (typeof httpStatus !== 'number') {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn('SearxNG checkHealth: unavailable', {
          component: 'SearxngProvider',
          latency_ms,
          error: message,
        });
        return { status: 'unavailable', latency_ms, error: message };
      }
      status = httpStatus;
    }

    const latency_ms = Date.now() - startTime;
    if (status < 500) {
      this.logger.debug('SearxNG checkHealth: connected', {
        component: 'SearxngProvider',
        latency_ms,
        status,
      });
      return { status: 'connected', latency_ms };
    }

    this.logger.warn('SearxNG checkHealth: unexpected status', {
      component: 'SearxngProvider',
      latency_ms,
      httpStatus: status,
    });
    return {
      status: 'unavailable',
      latency_ms,
      error: `Unexpected HTTP status: ${status}`,
    };
  }

  /**
   * Stage 2 — quality probe. Runs a real search for `canary.query` and
   * inspects the outcome:
   * - Non-JSON / unparseable response (`search()` throws
   *   {@link SearxngInvalidResponseError}) → `degraded`,
   *   `error_code: ERR_SEARXNG_JSON_UNSUPPORTED`. This is the exact trap
   *   named in P7: an instance can be reachable at `/healthz` while its
   *   `/search?format=json` endpoint has the JSON API disabled (the README's
   *   own documented state of both public fallback instances).
   * - Zero results → `degraded`, `error_code: ERR_SEARXNG_LOW_QUALITY`. This
   *   is the "HTTP 200 with zero results" failure mode documented in
   *   "Bring Your Own SearXNG" (engine CAPTCHA/rate-limit on this IP).
   * - A result URL matching `canary.junkDomains` → `degraded`,
   *   `error_code: ERR_SEARXNG_LOW_QUALITY`, naming the offending URL. This
   *   is the Yandex-safesearch-gap symptom from the 2026-10-12 investigation.
   * - Otherwise → `connected`.
   *
   * Any other search failure (timeout, network error, 5xx) also reports
   * `degraded` rather than re-promoting to `unavailable` — the instance did
   * answer `/healthz`, so it is not fully down, just not currently trustworthy
   * for search.
   */
  private async probeQuality(
    canary: SearxngHealthCanary,
    reachabilityLatencyMs: number
  ): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      const results = await this.search(canary.query, { limit: 10 });
      const latency_ms = reachabilityLatencyMs + (Date.now() - startTime);

      if (results.length === 0) {
        this.logger.warn('SearxNG checkHealth: quality canary returned zero results', {
          component: 'SearxngProvider',
          canaryQuery: canary.query,
          latency_ms,
        });
        return {
          status: 'degraded',
          latency_ms,
          error:
            `Quality canary query "${canary.query}" returned zero results — ` +
            'instance is reachable but likely engine-suspended or misconfigured',
          error_code: ErrorCode.ERR_SEARXNG_LOW_QUALITY,
        };
      }

      const junkHit = results.find(r =>
        canary.junkDomains.some(domain => r.url.includes(domain))
      );
      if (junkHit) {
        this.logger.warn('SearxNG checkHealth: quality canary returned a junk-domain result', {
          component: 'SearxngProvider',
          canaryQuery: canary.query,
          junkUrl: junkHit.url,
          latency_ms,
        });
        return {
          status: 'degraded',
          latency_ms,
          error: `Quality canary query "${canary.query}" returned a junk-domain result: ${junkHit.url}`,
          error_code: ErrorCode.ERR_SEARXNG_LOW_QUALITY,
        };
      }

      this.logger.debug('SearxNG checkHealth: quality canary passed', {
        component: 'SearxngProvider',
        canaryQuery: canary.query,
        resultCount: results.length,
        latency_ms,
      });
      return { status: 'connected', latency_ms };
    } catch (error) {
      const latency_ms = reachabilityLatencyMs + (Date.now() - startTime);

      if (error instanceof SearxngInvalidResponseError) {
        this.logger.warn('SearxNG checkHealth: quality canary got a non-JSON/invalid response', {
          component: 'SearxngProvider',
          canaryQuery: canary.query,
          latency_ms,
          error: error.message,
        });
        return {
          status: 'degraded',
          latency_ms,
          error:
            `Quality canary failed — instance did not return a valid JSON results array for ` +
            `format=json (${error.message}). Public SearXNG instances commonly disable the ` +
            'JSON API; this instance cannot serve JSON-mode callers.',
          error_code: ErrorCode.ERR_SEARXNG_JSON_UNSUPPORTED,
        };
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('SearxNG checkHealth: quality canary failed', {
        component: 'SearxngProvider',
        canaryQuery: canary.query,
        latency_ms,
        error: message,
      });
      return {
        status: 'degraded',
        latency_ms,
        error: `Quality canary query failed: ${message}`,
        error_code: ErrorCode.ERR_SEARXNG_LOW_QUALITY,
      };
    }
  }

  /**
   * Perform a web search via SearxNG.
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Normalized SearchResult array with ids and excerpts
   * @throws SearxngTimeoutError | SearxngUnavailableError | SearxngInvalidResponseError
   */
  async search(query: string, options: SearxngSearchOptions = {}): Promise<SearchResult[]> {
    const startTime = Date.now();
    const limit = Math.min(options.limit ?? 10, 50);

    try {
      const language = options.language ?? 'en';

      const params = new URLSearchParams({
        q: query,
        format: 'json',
        language,
      });

      // Only an explicit engine list is sent (e.g. searchDork forces google).
      // There is deliberately no default "exclusion": SearXNG's `engines`
      // parameter is a list of engines to *enable* — `-bing news,...` was
      // silently ignored (verified 2026-10-10: identical results with and
      // without it), and any `engines=` makes the searxng-resilient-router skip
      // its engine rotation ("caller-specified → rotation skipped").
      if (options.forcedEngines && options.forcedEngines.length > 0) {
        params.append('engines', options.forcedEngines.join(','));
      }

      if (options.category) params.append('categories', options.category);
      if (options.timeRange) params.append('time_range', options.timeRange);
      params.append('pageno', '1');

      const url = `${this.base}/search?${params.toString()}`;

      this.logger.debug('SearxNG search request', {
        component: 'SearxngProvider',
        query,
        limit,
        url,
      });

      const response = await this.httpClient.get(url, {
        timeout: this.config.timeout,
        ssrfAllowedNetworks: this.ssrfAllowed,
      });

      // Validate response shape
      const data = response.body as SearxngResponse;
      if (!Array.isArray(data?.results)) {
        throw new SearxngInvalidResponseError(
          'SearxNG response missing results array',
          { url, status: response.status }
        );
      }

      // Normalize to domain SearchResult — no provider-specific fields in output
      const results: SearchResult[] = data.results
        .slice(0, limit)
        .map((raw, position) => {
          let canonicalUrl: string;
          try {
            canonicalUrl = canonicalizeUrl(raw.url);
          } catch {
            canonicalUrl = raw.url; // keep as-is if un-parseable
          }

          return {
            id: makeResultId(canonicalUrl, query, position),
            url: canonicalUrl,
            title: raw.title ?? '',
            excerpt: firstLines(raw.content ?? '', 30),
            source: 'web' as const,
            relevance: raw.score != null ? Math.min(Math.max(raw.score, 0), 1) : undefined,
            date: raw.publishedDate,
            _engine: raw.engine ?? raw.category,
          };
        });

      const duration = Date.now() - startTime;

      this.logger.info('SearxNG search completed', {
        component: 'SearxngProvider',
        query,
        resultCount: results.length,
        duration,
      });

      return results;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Re-throw typed errors from the taxonomy without double-wrapping
      if (
        error instanceof SearxngTimeoutError ||
        error instanceof SearxngUnavailableError ||
        error instanceof SearxngInvalidResponseError
      ) {
        throw error;
      }

      // Map TimeoutError → SearxngTimeoutError
      if (error instanceof TimeoutError) {
        throw new SearxngTimeoutError(
          `SearxNG search timed out: ${error.message}`,
          { query, duration }
        );
      }

      this.logger.error('SearxNG search failed', {
        component: 'SearxngProvider',
        query,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new SearxngUnavailableError(
        `SearxNG search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { query, duration }
      );
    }
  }
}

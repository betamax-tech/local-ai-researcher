/**
 * Search tool — locked v1 implementation.
 *
 * Returns a normalized ToolResponseEnvelope wrapping SearchResult[].
 * All outputs are AI-first: schema_version, ok flag, typed error codes.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { SearchResult, ResponseMeta } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearchProvider } from '../providers/interfaces.js';
import { ResearcherError, ProviderUnavailableError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { type Cache } from '../lib/cache.js';
import { ProviderRegistry, type ProviderAlias } from '../lib/provider-registry.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Provider alias schema with description for AI callers.
 */
const ProviderAliasSchema = z
  .enum(['auto', 'local', 'fallback1', 'fallback2'])
  .optional()
  .default('auto')
  .describe(
    'Search provider to use. "auto" = chained fallback (default), "local" = local SearXNG, ' +
    '"fallback1" = https://searx.party/, "fallback2" = https://search.sapti.me/. ' +
    'Returns error if the requested provider is not configured.'
  );

/** SearXNG categories (the values previously documented for the free-string field). */
export const SearchCategorySchema = z.enum([
  'general', 'news', 'science', 'it', 'images', 'videos', 'map', 'music', 'files', 'social media',
]);

/** SearXNG time_range values. */
export const SearchTimeRangeSchema = z.enum(['day', 'week', 'month', 'year']);

/**
 * Search tool input — AI-facing contract (locked v1).
 */
export const SearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'Search query in plain words; by default it is spread across several engines. Operators: ' +
        '"exact phrase", -exclude, site:example.com, OR. Engine bangs pin one engine — ' +
        "'!google', '!bing', '!ddg', '!br' (Brave), '!wp' (Wikipedia), '!gh' (GitHub); use one only when " +
        'you need that engine. For inurl:/intitle:/filetype: queries use search_dork.'
    ),

  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(5)
    .describe('Maximum number of results to return (default 5, max 50).'),

  content_mode: z
    .enum(['full', 'excerpt'])
    .optional()
    .default('full')
    .describe(
      'Accepted for v1 compatibility; results are always title + URL + snippet in either mode. ' +
        'For page text use read (one URL) or gather (search + read).'
    ),

  category: SearchCategorySchema.optional().describe(
    "Topic engines to route to (default 'general'): 'news' for news, 'science' for academic papers, " +
      "'it' for programming/tech docs; also 'images', 'videos', 'map', 'music', 'files', 'social media'."
  ),

  language: z.string().optional().describe("Language code to bias results, e.g. 'en', 'de'."),

  timeRange: SearchTimeRangeSchema.optional().describe(
    'Only results from the last day, week, month or year. Set it only when the user asks for recent/latest items.'
  ),

  bypass_cache: z
    .boolean()
    .optional()
    .default(false)
    .describe('Skip the cache and force a fresh search (cache is not updated). Default false.'),

  provider: ProviderAliasSchema,
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the search tool.
 *
 * @param providerOrRegistry - Either a single SearchProvider (backward compat) or ProviderRegistry
 * @param logger - Logger instance
 * @param options - Optional timeout and cache
 */
export function createSearchTool(
  providerOrRegistry: SearchProvider | ProviderRegistry,
  logger: Logger,
  options?: { timeoutMs?: number; cache?: Cache }
) {
  const timeoutMs = options?.timeoutMs ?? 10000; // Default 10s per locked PRD
  const cache = options?.cache ?? null;

  // Support both old single-provider and new registry patterns
  const getProvider = (alias: ProviderAlias): SearchProvider => {
    if (providerOrRegistry instanceof ProviderRegistry) {
      return providerOrRegistry.resolve(alias);
    }
    // Backward compat: single provider ignores alias
    return providerOrRegistry;
  };

  return {
    name: 'search',
    description:
      'Web search that returns a ranked list of links: title, URL and a short snippet per result — no page text. ' +
      'Use when the user asks to find, look up or list links, sources, websites, docs or recent news about something ' +
      '(a site: restriction alone is fine here), or when you need candidate URLs before deciding what to read. ' +
      'The query accepts operators ("exact phrase", -word, site:example.com) and engine bangs (!google, !gh, !wp); ' +
      'category and timeRange narrow to news, papers, code docs or the last day/week/month/year.\n' +
      'Choose search over gather when you need links, one fact a snippet can answer, or want to pick which pages to read; ' +
      'choose gather when you would otherwise search and then read 3+ results. ' +
      'Use search_dork instead only when the query needs inurl:, intitle: or filetype:.\n' +
      'Not for reading a URL you already have — use read; not for records on a listing page — use scrape_listing. ' +
      'Fast: one search request, small response.',
    inputSchema: SearchInputSchema,

    /**
     * Handle a search request.
     */
    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = SearchInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      // Resolve provider based on alias
      let provider: SearchProvider;
      try {
        provider = getProvider(input.provider);
      } catch (error) {
        // Provider unavailable - return clear error envelope
        if (error instanceof ProviderUnavailableError) {
          const meta: ResponseMeta = {
            request_id: requestId,
            timestamp,
            provider_id: 'registry',
            provider_name: 'Provider Registry',
            applied_limits: {
              timeout_ms: timeoutMs,
              max_results: input.limit,
            },
            cache_status: 'disabled',
          };

          logger.warn('Search tool: provider unavailable', {
            component: 'search',
            requestedProvider: input.provider,
            request_id: requestId,
          });

          const envelope: ToolResponseEnvelope<never> = {
            schema_version: SCHEMA_VERSION,
            ok: false,
            meta,
            error: {
              code: error.code,
              message: error.message,
              retryable: false,
              details: error.details,
            },
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
            isError: true,
          };
        }
        throw error;
      }

      // Determine initial cache_status before any operation
      const cacheEnabled = cache !== null && cache.isEnabled();
      let cacheStatus: 'hit' | 'miss' | 'bypass' | 'disabled' = cacheEnabled
        ? (input.bypass_cache ? 'bypass' : 'miss')
        : 'disabled';

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          timeout_ms: timeoutMs,
          max_results: input.limit,
        },
        cache_status: cacheStatus,
      };

      logger.info('Search tool invoked', {
        component: 'search',
        query: input.query,
        limit: input.limit,
        content_mode: input.content_mode,
        bypass_cache: input.bypass_cache,
        provider: input.provider,
        request_id: requestId,
      });

      // Build cache key from query + relevant options + provider
      const cacheKey = `search:${input.provider}:${input.query}:${input.limit ?? 5}:${input.category ?? ''}:${input.language ?? ''}:${input.timeRange ?? ''}`;

      // Cache lookup when enabled and not bypassed
      if (cacheEnabled && !input.bypass_cache) {
        const cached = await cache.get<{ results: SearchResult[]; total: number }>(cacheKey);
        if (cached) {
          cacheStatus = 'hit';
          meta.cache_status = 'hit';
          logger.debug('Search cache hit', { component: 'search', query: input.query, request_id: requestId });

          const envelope: ToolResponseEnvelope<{ results: SearchResult[]; total: number }> = {
            schema_version: SCHEMA_VERSION,
            ok: true,
            meta,
            result: cached.value,
          };
          return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
        }
        // cache miss — cacheStatus stays 'miss'
        logger.debug('Search cache miss', { component: 'search', query: input.query, request_id: requestId });
      }

      try {
        const results: SearchResult[] = await provider.search(input.query, {
          limit: input.limit,
          category: input.category,
          language: input.language,
          timeRange: input.timeRange,
        });

        logger.info('Search tool completed', {
          component: 'search',
          query: input.query,
          resultCount: results.length,
          cache_status: cacheStatus,
          provider: input.provider,
          request_id: requestId,
        });

        const payload = { results, total: results.length };

        // Store in cache on miss (not on bypass — bypass does not update cache)
        if (cacheEnabled && !input.bypass_cache) {
          await cache.set(cacheKey, payload);
        }

        const envelope: ToolResponseEnvelope<{ results: SearchResult[]; total: number }> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result: payload,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (error) {
        logger.error('Search tool failed', {
          component: 'search',
          query: input.query,
          error: error instanceof Error ? error.message : 'Unknown error',
          cache_status: cacheStatus,
          provider: input.provider,
          request_id: requestId,
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
          meta,
          error: {
            code: error instanceof ResearcherError
              ? error.code
              : 'ERR_SEARXNG_UNAVAILABLE',
            message: error instanceof Error ? error.message : 'Unknown error',
            retryable: error instanceof ResearcherError ? error.retryable : false,
            details: error instanceof ResearcherError ? error.details : undefined,
          },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
          isError: true,
        };
      }
    },
  };
}

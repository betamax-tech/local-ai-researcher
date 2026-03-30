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
import { ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Search tool input — AI-facing contract (locked v1).
 */
export const SearchInputSchema = z.object({
  /** Search query string */
  query: z.string().min(1).max(500).describe('Search query'),

  /**
   * Max results to return (default: 5 per locked PRD).
   * Capped at 50.
   */
  limit: z.number().int().min(1).max(50).optional().default(5),

  /**
   * Content mode for search results (default: 'full').
   * 'full' returns full page text, 'excerpt' returns a preview.
   */
  content_mode: z.enum(['full', 'excerpt']).optional().default('full'),

  /** Search category (e.g., 'general', 'news', 'images') */
  category: z.string().optional(),

  /** Language code (e.g., 'en', 'de') */
  language: z.string().optional(),

  /** Time range filter (e.g., 'day', 'week', 'month') */
  timeRange: z.string().optional(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the search tool.
 */
export function createSearchTool(
  provider: SearchProvider,
  logger: Logger,
  options?: { timeoutMs?: number }
) {
  const timeoutMs = options?.timeoutMs ?? 10000; // Default 10s per locked PRD

  return {
    name: 'search',
    description:
      'Search the web using SearxNG. Returns result titles, canonical URLs, and content. ' +
      'Use content_mode: "full" for complete page text (default) or "excerpt" for a preview.',
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

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          timeout_ms: timeoutMs,
          max_results: input.limit,
        },
      };

      logger.info('Search tool invoked', {
        component: 'search',
        query: input.query,
        limit: input.limit,
        content_mode: input.content_mode,
        request_id: requestId,
      });

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
          request_id: requestId,
        });

        const envelope: ToolResponseEnvelope<{ results: SearchResult[]; total: number }> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result: {
            results,
            total: results.length,
          },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (error) {
        logger.error('Search tool failed', {
          component: 'search',
          query: input.query,
          error: error instanceof Error ? error.message : 'Unknown error',
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

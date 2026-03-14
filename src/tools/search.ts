/**
 * Search tool — locked v1 implementation.
 *
 * Returns a normalized ToolResponseEnvelope wrapping SearchResult[].
 * All outputs are AI-first: schema_version, ok flag, typed error codes.
 */

import { z } from 'zod';
import type { SearchResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import { SearxngProvider } from '../providers/searxng.js';
import { ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Search tool input — AI-facing contract.
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
   * Return full text instead of 30-line excerpt (default: false).
   * Excerpt-first is the locked v1 default.
   */
  fullText: z.boolean().optional().default(false),

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
  provider: SearxngProvider,
  logger: Logger
) {
  return {
    name: 'search',
    description:
      'Search the web using SearxNG. Returns result titles, canonical URLs, and 30-line excerpts. ' +
      'Set fullText: true to get full page text (excerpt-first is the default).',
    inputSchema: SearchInputSchema,

    /**
     * Handle a search request.
     */
    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = SearchInputSchema.parse(params);

      logger.info('Search tool invoked', {
        component: 'search',
        query: input.query,
        limit: input.limit,
        fullText: input.fullText,
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
        });

        const envelope: ToolResponseEnvelope<{ results: SearchResult[]; total: number }> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
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
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
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

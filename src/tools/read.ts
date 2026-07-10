/**
 * Read tool — locked v1 implementation.
 *
 * Full-content model: returns full content by default.
 * Set content_mode: 'excerpt' to get truncated preview with metadata.
 * Wraps Jina Reader provider behind the stable MCP/domain contract.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ReadResult, ResponseMeta } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { ReaderProvider } from '../providers/interfaces.js';
import { ValidationError, ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { buildCacheKey, type Cache } from '../lib/cache.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Read tool input — AI-facing contract.
 */
export const ReadInputSchema = z.object({
  url: z.string().url().max(2000).describe('URL to read and extract content from'),

  content_mode: z
    .enum(['full', 'excerpt'])
    .optional()
    .default('full')
    .describe("'full' returns the whole page as prose; 'excerpt' returns a truncated preview."),

  targetWords: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe('Approximate word budget for the excerpt (only used when content_mode is "excerpt").'),

  language: z.string().optional().describe("Optional language hint for the reader, e.g. 'en'."),

  bypass_cache: z
    .boolean()
    .optional()
    .default(false)
    .describe('Skip the cache and force a fresh read (cache is not updated). Default false.'),
});

export type ReadInput = z.infer<typeof ReadInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the read tool.
 */
export function createReadTool(
  provider: ReaderProvider,
  logger: Logger,
  options?: { timeoutMs?: number; cache?: Cache }
) {
  const timeoutMs = options?.timeoutMs ?? 15000; // Default 15s per locked PRD
  const cache = options?.cache ?? null;

  return {
    name: 'read',
    description:
      'Read a page as prose using Jina Reader. Returns full content by default. Use this when the goal is understanding, summarization, explanation, or documentation/article reading. ' +
      'Prefer scrape_page, scrape_listing, or scrape_many when the goal is collecting fields, prices, listings, or repeated records.',
    inputSchema: ReadInputSchema,

    /**
     * Handle a read request.
     * Internal overload: accepts _bypassCache to support gather propagation.
     */
    async handler(
      params: unknown,
      _bypassCacheOverride?: boolean
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = ReadInputSchema.parse(params);
      // Allow gather to propagate bypass_cache (internal use only)
      const effectiveBypass = _bypassCacheOverride ?? input.bypass_cache;
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      // Determine cache_status before operation
      const cacheEnabled = cache !== null && cache.isEnabled();
      let cacheStatus: 'hit' | 'miss' | 'bypass' | 'disabled' = cacheEnabled
        ? (effectiveBypass ? 'bypass' : 'miss')
        : 'disabled';

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          timeout_ms: timeoutMs,
        },
        cache_status: cacheStatus,
      };

      logger.info('Read tool invoked', {
        component: 'read',
        url: input.url,
        content_mode: input.content_mode,
        bypass_cache: effectiveBypass,
        request_id: requestId,
      });

      // Check URL is supported before making a network call
      if (!provider.canRead(input.url)) {
        throw new ValidationError(
          `URL protocol not supported: ${input.url}`,
          'url',
          input.url
        );
      }

      // Cache key includes content_mode — full vs excerpt are separate entries
      const cacheKey = buildCacheKey(input.url, input.content_mode);

      // Cache lookup when enabled and not bypassed
      if (cacheEnabled && !effectiveBypass) {
        const cached = await cache.get<ReadResult>(cacheKey);
        if (cached) {
          cacheStatus = 'hit';
          meta.cache_status = 'hit';
          logger.debug('Read cache hit', { component: 'read', url: input.url, request_id: requestId });

          const envelope: ToolResponseEnvelope<ReadResult> = {
            schema_version: SCHEMA_VERSION,
            ok: true,
            meta,
            result: cached.value,
          };
          return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
        }
        logger.debug('Read cache miss', { component: 'read', url: input.url, request_id: requestId });
      }

      try {
        const result: ReadResult = await provider.read(input.url, {
          content_mode: input.content_mode,
          targetWords: input.targetWords,
          language: input.language,
        });

        logger.info('Read tool completed', {
          component: 'read',
          url: input.url,
          wordCount: result.wordCount,
          content_mode: result.content_mode,
          content_truncated: result.content_truncated,
          cache_status: cacheStatus,
          request_id: requestId,
        });

        // Store in cache on miss (not on bypass)
        if (cacheEnabled && !effectiveBypass) {
          await cache.set(cacheKey, result);
        }

        const envelope: ToolResponseEnvelope<ReadResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (error) {
        logger.error('Read tool failed', {
          component: 'read',
          url: input.url,
          error: error instanceof Error ? error.message : 'Unknown error',
          cache_status: cacheStatus,
          request_id: requestId,
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
          meta,
          error: {
            code: error instanceof ResearcherError
              ? error.code
              : 'ERR_READER_UNAVAILABLE',
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

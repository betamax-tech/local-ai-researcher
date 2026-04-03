/**
 * Gather tool — locked v1 implementation.
 *
 * Orchestrates search + parallel reads, returns a normalized GatherResult
 * envelope ready for LLM consumption.
 *
 * Full-content model: reads return full content by default.
 * Set content_mode: 'excerpt' to get truncated previews.
 * Request-scoped dedup: enabled by default (URL canonicalization).
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type {
  GatherResult,
  GatherSource,
  ReadResult,
  SearchResult,
  ResponseMeta,
} from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearchProvider, ReaderProvider } from '../providers/interfaces.js';
import {
  GatherTimeoutError,
  GatherNoSourcesError,
} from '../lib/errors.js';
import { canonicalizeUrl } from '../lib/url.js';
import { Logger } from '../lib/logger.js';
import {
  scoreReads,
  deduplicateReads,
  buildSynthesisBody,
  buildDegradedSection,
} from '../lib/synthesis.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { ResearcherError } from '../lib/errors.js';
import { type Cache } from '../lib/cache.js';

// ---------------------------------------------------------------------------
// Input schema (Zod)
// ---------------------------------------------------------------------------

/**
 * Gather tool input — AI-facing contract.
 * Keep field names and descriptions stable across v1.
 */
export const GatherInputSchema = z.object({
  /** Search query / research prompt */
  query: z.string().min(1).max(500).describe('Research query to search and gather content for'),

  /** Max results to fetch from search (default: 5 per locked PRD) */
  maxResults: z.number().int().min(1).max(20).optional().default(5),

  /**
   * Enable request-scoped URL deduplication (default: true).
   * Dedup uses URL canonicalization — same canonical URL is only read once.
   */
  dedup: z.boolean().optional().default(true),

  /**
   * Content mode for reads: 'full' for full content, 'excerpt' for preview.
   * Default: 'full' (full-content-by-default model).
   */
  content_mode: z.enum(['full', 'excerpt']).optional().default('full'),

  /** Total gather timeout ms (default: 10000) */
  timeout: z.number().int().min(1000).max(60000).optional().default(10000),

  /**
   * Bypass cache for this request — forces fresh provider call for all operations.
   * Propagates to all nested read calls. Cache is NOT updated on bypass.
   * Default: false.
   */
  bypass_cache: z.boolean().optional().default(false),
});

export type GatherInput = z.infer<typeof GatherInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the gather tool.
 */
export function createGatherTool(
  searchProvider: SearchProvider,
  readProvider: ReaderProvider,
  logger: Logger,
  options?: { cache?: Cache }
) {
  const cache = options?.cache ?? null;

  return {
    name: 'gather',
    description:
      'Search the web for a query and optionally read each result in parallel. ' +
      'Returns a normalized research envelope with search results, excerpts, dedup stats, ' +
      'and a pre-formatted synthesis block for LLM insertion.',
    inputSchema: GatherInputSchema,

    /**
     * Handle a gather request.
     */
    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = GatherInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      // Determine cache_status before any operation
      const cacheEnabled = cache !== null && cache.isEnabled();
      let cacheStatus: 'hit' | 'miss' | 'bypass' | 'disabled' = cacheEnabled
        ? (input.bypass_cache ? 'bypass' : 'miss')
        : 'disabled';

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: 'orchestrator',
        provider_name: 'Orchestrator',
        applied_limits: {
          timeout_ms: input.timeout,
          max_results: input.maxResults,
        },
        cache_status: cacheStatus,
      };

      logger.info('Gather tool invoked', {
        component: 'gather',
        query: input.query,
        maxResults: input.maxResults,
        content_mode: input.content_mode,
        dedup: input.dedup,
        bypass_cache: input.bypass_cache,
        request_id: requestId,
      });

      // Gather-level cache key — caches the entire GatherResult
      const gatherCacheKey = `gather:${input.query}:${input.maxResults ?? 5}:${input.content_mode}:${input.dedup}`;

      // Cache lookup — serve entire cached GatherResult on hit
      if (cacheEnabled && !input.bypass_cache) {
        const cached = await cache.get<GatherResult>(gatherCacheKey);
        if (cached) {
          cacheStatus = 'hit';
          meta.cache_status = 'hit';
          logger.debug('Gather cache hit', { component: 'gather', query: input.query, request_id: requestId });

          const envelope: ToolResponseEnvelope<GatherResult> = {
            schema_version: SCHEMA_VERSION,
            ok: true,
            meta,
            result: cached.value,
          };
          return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
        }
        logger.debug('Gather cache miss', { component: 'gather', query: input.query, request_id: requestId });
      }

      const startTime = Date.now();
      const gatherTimeout = input.timeout;

      try {
        // --- Step 1: Search ---
        const searchResults: SearchResult[] = await withTimeout(
          searchProvider.search(input.query, { limit: input.maxResults }),
          gatherTimeout,
          `search for "${input.query}"`
        );

        if (searchResults.length === 0) {
          throw new GatherNoSourcesError(
            'Search returned no results — cannot gather content'
          );
        }

        logger.info('Gather search completed', {
          component: 'gather',
          query: input.query,
          resultCount: searchResults.length,
          request_id: requestId,
        });

        // --- Step 2: Dedup URLs ---
        const urlsToRead = deduplicateUrls(
          searchResults.map(r => r.url),
          input.dedup
        );

        const dedupStats = {
          total: searchResults.length,
          deduped: searchResults.length - urlsToRead.length,
        };

        // --- Step 3: Parallel reads ---
        const reads: ReadResult[] = [];
        let successfulReads = 0;
        let failedReads = 0;
        let degradedReads = 0;

        if (urlsToRead.length > 0) {
          const readPromises = urlsToRead.map(async (url) => {
            try {
              const result = await withTimeout(
                readProvider.read(url, {
                  content_mode: input.content_mode,
                }),
                // Each read gets a proportional share; at minimum 5 s
                Math.max(5000, gatherTimeout - (Date.now() - startTime)),
                `read ${url}`
              );
              return { url, result, success: true as const };
            } catch (error) {
              logger.warn('Gather read failed for URL', {
                component: 'gather',
                url,
                error: error instanceof Error ? error.message : 'Unknown error',
                request_id: requestId,
              });
              return { url, success: false as const };
            }
          });

          const readResults = await Promise.all(readPromises);

          for (const r of readResults) {
            if (r.success && r.result) {
              reads.push(r.result);
              // Check if this read is degraded
              if (r.result.degraded === true) {
                degradedReads++;
              } else {
                successfulReads++;
              }
            } else {
              failedReads++;
            }
          }

          logger.info('Gather reads completed', {
            component: 'gather',
            attempted: urlsToRead.length,
            successfulReads,
            failedReads,
            request_id: requestId,
          });
        }

        // --- Step 4: Build GatherSource list ---
        const sources: GatherSource[] = searchResults.map(r => ({
          type: 'web' as const,
          target: r.url,
        }));

        // --- Step 5: Synthesize context block ---
        const synthesis = buildSynthesis(input.query, searchResults, reads);

        const totalDuration = Date.now() - startTime;

        // --- Step 6: Assemble result envelope ---
        const result: GatherResult = {
          id: randomUUID(),
          prompt: input.query,
          context: {
            sources,
            results: searchResults,
            reads,
            dedupStats,
          },
          synthesis,
          summary: {
            totalResults: searchResults.length,
            attemptedReads: urlsToRead.length,
            successfulReads,
            failedReads,
            degradedReads,
            totalDuration,
          },
        };

        logger.info('Gather tool completed', {
          component: 'gather',
          query: input.query,
          totalResults: result.summary.totalResults,
          successfulReads: result.summary.successfulReads,
          totalDuration: result.summary.totalDuration,
          cache_status: cacheStatus,
          request_id: requestId,
        });

        // Store in cache on miss (not on bypass — bypass does not update cache)
        if (cacheEnabled && !input.bypass_cache) {
          await cache.set(gatherCacheKey, result);
        }

        const envelope: ToolResponseEnvelope<GatherResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (error) {
        const duration = Date.now() - startTime;

        logger.error('Gather tool failed', {
          component: 'gather',
          query: input.query,
          duration,
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
              : 'ERR_GATHER_TIMEOUT',
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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicate URLs using canonical form.
 * When dedup=false, returns all URLs unchanged.
 */
function deduplicateUrls(urls: string[], dedup: boolean): string[] {
  if (!dedup) return urls;
  const seen = new Set<string>();
  return urls.filter(url => {
    let canonical: string;
    try {
      canonical = canonicalizeUrl(url);
    } catch {
      canonical = url;
    }
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

/**
 * Build a text synthesis block for LLM insertion.
 * Implements task 14.04 quality improvements:
 * - Excludes degraded reads from primary synthesis
 * - Orders by relevance (provider score or query term overlap)
 * - Deduplicates similar content
 * - Shows degraded sources section separately
 */
function buildSynthesis(
  query: string,
  results: SearchResult[],
  reads: ReadResult[]
): string {
  // Separate degraded and normal reads
  const normalReads = reads.filter(r => r.degraded !== true);
  const degradedReads = reads.filter(r => r.degraded === true);
  
  // Score and order normal reads by relevance
  const scoredReads = scoreReads(normalReads, results, query);
  
  // Deduplicate similar content
  const { deduped, duplicatesRemoved } = deduplicateReads(scoredReads);
  
  // Build header
  const lines: string[] = [
    `## Research Results for: ${query}`,
    '',
    `Found ${results.length} result(s).${duplicatesRemoved > 0 ? ` Deduplicated ${duplicatesRemoved} similar passage${duplicatesRemoved > 1 ? 's' : ''}.` : ''}`,
    '',
  ];
  
  // Build synthesis body from deduplicated, relevance-ordered reads
  const synthesisBody = buildSynthesisBody(query, deduped);
  if (synthesisBody) {
    lines.push(synthesisBody);
  }
  
  // Add degraded section if any degraded reads exist
  if (degradedReads.length > 0) {
    lines.push(buildDegradedSection(degradedReads.length));
  }
  
  return lines.join('\n');
}

/**
 * Wrap a promise with a timeout that throws GatherTimeoutError.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GatherTimeoutError(
        `Gather timeout after ${ms}ms during: ${operation}`,
        { operation, timeout: ms }
      ));
    }, ms);

    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

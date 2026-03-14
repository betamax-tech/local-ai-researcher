/**
 * Gather tool — locked v1 implementation.
 *
 * Orchestrates search + parallel reads, returns a normalized GatherResult
 * envelope ready for LLM consumption.
 *
 * Excerpt-first model: reads return 30-line excerpts by default.
 * Full text opt-in: set fullText: true.
 * Request-scoped dedup: enabled by default (URL canonicalization).
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type {
  GatherResult,
  GatherSource,
  ReadResult,
  SearchResult,
} from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import { SearxngProvider } from '../providers/searxng.js';
import { JinaReaderProvider } from '../providers/jinaReader.js';
import {
  GatherTimeoutError,
  GatherNoSourcesError,
} from '../lib/errors.js';
import { canonicalizeUrl } from '../lib/url.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { ResearcherError } from '../lib/errors.js';

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
   * Retrieve full text for reads instead of 30-line excerpts (default: false).
   * Opt-in: excerpt-first is the locked v1 default.
   */
  fullText: z.boolean().optional().default(false),

  /** Total gather timeout ms (default: 10000) */
  timeout: z.number().int().min(1000).max(60000).optional().default(10000),
});

export type GatherInput = z.infer<typeof GatherInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the gather tool.
 */
export function createGatherTool(
  searchProvider: SearxngProvider,
  readProvider: JinaReaderProvider,
  logger: Logger
) {
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

      logger.info('Gather tool invoked', {
        component: 'gather',
        query: input.query,
        maxResults: input.maxResults,
        fullText: input.fullText,
        dedup: input.dedup,
      });

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

        if (urlsToRead.length > 0) {
          const readPromises = urlsToRead.map(async (url) => {
            try {
              const result = await withTimeout(
                readProvider.read(url, {
                  fullText: input.fullText,
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
              });
              return { url, success: false as const };
            }
          });

          const readResults = await Promise.all(readPromises);

          for (const r of readResults) {
            if (r.success && r.result) {
              reads.push(r.result);
              successfulReads++;
            } else {
              failedReads++;
            }
          }

          logger.info('Gather reads completed', {
            component: 'gather',
            attempted: urlsToRead.length,
            successfulReads,
            failedReads,
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
            totalDuration,
          },
        };

        logger.info('Gather tool completed', {
          component: 'gather',
          query: input.query,
          totalResults: result.summary.totalResults,
          successfulReads: result.summary.successfulReads,
          totalDuration: result.summary.totalDuration,
        });

        const envelope: ToolResponseEnvelope<GatherResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
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
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
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
 * Format is stable across v1: numbered results with excerpt, followed by reads.
 */
function buildSynthesis(
  query: string,
  results: SearchResult[],
  reads: ReadResult[]
): string {
  const lines: string[] = [
    `## Research Results for: ${query}`,
    '',
    `Found ${results.length} result(s).`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r) continue;
    lines.push(`### [${i + 1}] ${r.title}`);
    lines.push(`URL: ${r.url}`);
    if (r.date) lines.push(`Date: ${r.date}`);
    lines.push('');
    lines.push(r.excerpt);
    lines.push('');

    // Attach read content if available
    const readResult = reads.find(rd => rd.url === r.url);
    if (readResult) {
      lines.push('**Extracted content:**');
      lines.push(readResult.content ?? readResult.excerpt);
      lines.push('');
    }
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

/**
 * Read tool — locked v1 implementation.
 *
 * Excerpt-first model: returns 30-line excerpt by default.
 * Full text opt-in: set fullText: true.
 * Wraps Jina Reader provider behind the stable MCP/domain contract.
 */

import { z } from 'zod';
import type { ReadResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import { JinaReaderProvider } from '../providers/jinaReader.js';
import { ValidationError, ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Read tool input — AI-facing contract.
 */
export const ReadInputSchema = z.object({
  /** URL to fetch and extract content from */
  url: z.string().url().max(2000).describe('URL to read and extract content from'),

  /**
   * Return full text instead of 30-line excerpt (default: false).
   * Excerpt-first is the locked v1 default.
   */
  fullText: z.boolean().optional().default(false),

  /**
   * Target word count for excerpt trimming.
   * Overrides the 30-line default when set.
   */
  targetWords: z.number().int().min(1).max(10000).optional(),

  /** Language hint for Jina Reader (optional) */
  language: z.string().optional(),
});

export type ReadInput = z.infer<typeof ReadInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the read tool.
 */
export function createReadTool(
  provider: JinaReaderProvider,
  logger: Logger
) {
  return {
    name: 'read',
    description:
      'Extract content from a URL using Jina Reader. ' +
      'Returns a 30-line excerpt by default (excerpt-first model). ' +
      'Set fullText: true to retrieve the full page text.',
    inputSchema: ReadInputSchema,

    /**
     * Handle a read request.
     */
    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = ReadInputSchema.parse(params);

      logger.info('Read tool invoked', {
        component: 'read',
        url: input.url,
        fullText: input.fullText,
      });

      // Check URL is supported before making a network call
      if (!provider.canRead(input.url)) {
        throw new ValidationError(
          `URL protocol not supported: ${input.url}`,
          'url',
          input.url
        );
      }

      try {
        const result: ReadResult = await provider.read(input.url, {
          fullText: input.fullText,
          targetWords: input.targetWords,
          language: input.language,
        });

        logger.info('Read tool completed', {
          component: 'read',
          url: input.url,
          wordCount: result.wordCount,
        });

        const envelope: ToolResponseEnvelope<ReadResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
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
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
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

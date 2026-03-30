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
   * Content mode: 'full' returns full content, 'excerpt' returns truncated preview.
   * Default: 'full' (full-content-by-default model).
   */
  content_mode: z.enum(['full', 'excerpt']).optional().default('full'),

  /**
   * Target word count for excerpt trimming.
   * Only used when content_mode: 'excerpt'.
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
  provider: ReaderProvider,
  logger: Logger,
  options?: { timeoutMs?: number }
) {
  const timeoutMs = options?.timeoutMs ?? 15000; // Default 15s per locked PRD

  return {
    name: 'read',
    description:
      'Extract content from a URL using Jina Reader. ' +
      'Returns full content by default. ' +
      'Set content_mode: "excerpt" to get a truncated preview.',
    inputSchema: ReadInputSchema,

    /**
     * Handle a read request.
     */
    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = ReadInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          timeout_ms: timeoutMs,
        },
      };

      logger.info('Read tool invoked', {
        component: 'read',
        url: input.url,
        content_mode: input.content_mode,
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
          request_id: requestId,
        });

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

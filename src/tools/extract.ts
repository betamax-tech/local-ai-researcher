import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { ExtractResult, ResponseMeta } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { ExtractProvider } from '../providers/interfaces.js';
import { Logger } from '../lib/logger.js';
import { ResearcherError, ValidationError } from '../lib/errors.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { scraplingModeField, fetchAuthShape } from './_fetchAuthSchema.js';

export const ExtractInputSchema = z.object({
  url: z.string().url().max(2000).describe('URL to extract structured or targeted content from'),
  mode: scraplingModeField,
  selector: z
    .string()
    .optional()
    .describe('Optional CSS selector to scope extraction to matching elements'),
  goal: z
    .string()
    .optional()
    .describe('Optional natural-language description of what to extract (guides the extractor)'),
  content_mode: z
    .enum(['full', 'excerpt'])
    .optional()
    .default('full')
    .describe("'full' returns the whole extracted content; 'excerpt' returns a short preview."),
  targetWords: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe('Approximate word budget for the excerpt (only used when content_mode is "excerpt").'),
  maxRecords: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(25)
    .describe('Maximum number of repeated records to return when the page has many similar items.'),
  // --- auth / egress / stealth controls (fetch behind logins, choose egress IP) ---
  ...fetchAuthShape,
});

export type ExtractInput = z.infer<typeof ExtractInputSchema>;

export function createExtractTool(provider: ExtractProvider, logger: Logger) {
  return {
    name: 'extract',
    description:
      'Extract targeted or structured content from a single URL (JS-heavy pages, tables, ' +
      'listings, or CSS-selector-targeted regions) using the Scrapling browser lane. ' +
      'This is the tool that can reach HARD pages: pass `cookies` to read pages behind a ' +
      'sign-in wall (as a logged-in user), set `mode:"stealth"` to bypass bot-walls / ' +
      'Cloudflare / "verify you are human" challenges, and set `direct:true` to keep a ' +
      "cookie'd session pinned to one IP. Escalate mode only as needed " +
      '(auto → dynamic → stealth). Prefer `read` for plain prose/article understanding, ' +
      'and `scrape_listing`/`scrape_many` for many items or many URLs.',
    inputSchema: ExtractInputSchema,

    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = ExtractInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          max_results: input.maxRecords,
        },
      };

      logger.info('Extract tool invoked', {
        component: 'extract',
        url: input.url,
        mode: input.mode,
        selector: input.selector,
        request_id: requestId,
      });

      if (!provider.canExtract(input.url)) {
        throw new ValidationError(
          `URL protocol not supported: ${input.url}`,
          'url',
          input.url
        );
      }

      try {
        const result: ExtractResult = await provider.extract(input.url, {
          mode: input.mode,
          selector: input.selector,
          goal: input.goal,
          content_mode: input.content_mode,
          targetWords: input.targetWords,
          maxRecords: input.maxRecords,
          cookies: input.cookies,
          headers: input.headers,
          proxy: input.proxy,
          direct: input.direct,
        });

        const envelope: ToolResponseEnvelope<ExtractResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (error) {
        logger.error('Extract tool failed', {
          component: 'extract',
          url: input.url,
          error: error instanceof Error ? error.message : 'Unknown error',
          request_id: requestId,
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
          meta,
          error: {
            code: error instanceof ResearcherError ? error.code : 'ERR_EXTRACT_UNAVAILABLE',
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

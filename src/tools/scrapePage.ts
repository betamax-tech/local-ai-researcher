import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { ResponseMeta, ScrapePageResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { ScrapeProvider } from '../providers/interfaces.js';
import { Logger } from '../lib/logger.js';
import { ResearcherError, ValidationError } from '../lib/errors.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { scraplingModeField, fetchAuthShape } from './_fetchAuthSchema.js';

export const ScrapePageInputSchema = z.object({
  url: z.string().url().max(2000).describe('Known page URL to scrape for data or targeted content'),
  entity_type: z.enum(['generic', 'product', 'job', 'company', 'event', 'property']).optional().default('generic')
    .describe('Entity type hint derived from the task, such as product, job, event, company, or property'),
  fields: z.array(z.string().min(1)).optional().default([])
    .describe('Fields the AI wants from this page, such as price, company, location, rating, or availability'),
  goal: z.string().optional().describe('Natural-language scraping goal for this page'),
  selector: z.string().optional().describe('Optional CSS selector hint if you already know the relevant page region'),
  mode: scraplingModeField,
  content_mode: z
    .enum(['full', 'excerpt'])
    .optional()
    .default('full')
    .describe("'full' returns all page content; 'excerpt' returns a short preview."),
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
    .describe('Maximum number of repeated records to return if the page contains many similar items.'),
  // fetch behind logins (cookies), bypass bot-walls (mode:stealth), pin egress IP (direct)
  ...fetchAuthShape,
});

export function createScrapePageTool(provider: ScrapeProvider, logger: Logger) {
  return {
    name: 'scrape_page',
    description:
      'Scrape one known page for data. Use this when you already have the page URL and want fields, facts, or exact page data from that page. ' +
      'Good for product pages, job detail pages, event pages, company profiles, or other detail pages. ' +
      'For hard pages, pass `cookies` to scrape behind a sign-in wall, `mode:"stealth"` to bypass ' +
      'bot-walls/Cloudflare, and `direct:true` to keep a session on one IP. ' +
      'Prefer read when you mainly want narrative understanding rather than structured facts.',
    inputSchema: ScrapePageInputSchema,

    async handler(params: unknown): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = ScrapePageInputSchema.parse(params);
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

      logger.info('Scrape page tool invoked', {
        component: 'scrape_page',
        url: input.url,
        entity_type: input.entity_type,
        fields: input.fields,
        request_id: requestId,
      });

      if (!provider.canExtract(input.url)) {
        throw new ValidationError(`URL protocol not supported: ${input.url}`, 'url', input.url);
      }

      try {
        const result: ScrapePageResult = await provider.scrapePage(input.url, input);
        const envelope: ToolResponseEnvelope<ScrapePageResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result,
        };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      } catch (error) {
        logger.error('Scrape page tool failed', {
          component: 'scrape_page',
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
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
      }
    },
  };
}

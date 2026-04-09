import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { ResponseMeta, ScrapeListingResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { ScrapeProvider } from '../providers/interfaces.js';
import { Logger } from '../lib/logger.js';
import { ResearcherError, ValidationError } from '../lib/errors.js';
import type { ToolResponseEnvelope } from '../domain/types.js';

export const ScrapeListingInputSchema = z.object({
  url: z.string().url().max(2000).describe('Listing, category, or search-result page URL to scrape into repeated records'),
  entity_type: z.enum(['generic', 'product', 'job', 'company', 'event', 'property']).optional().default('generic')
    .describe('Entity type of the records expected on this listing page'),
  fields: z.array(z.string().min(1)).optional().default([])
    .describe('Fields the AI wants from each record, such as title, price, company, location, date, or URL'),
  goal: z.string().optional().describe('Natural-language scraping goal for this listing page'),
  item_selector: z.string().optional().describe('Optional CSS selector hint for individual listing items if you know it'),
  mode: z.enum(['auto', 'static', 'dynamic']).optional().default('auto'),
  maxItems: z.number().int().min(1).max(200).optional().default(25),
});

export function createScrapeListingTool(provider: ScrapeProvider, logger: Logger) {
  return {
    name: 'scrape_listing',
    description:
      'Scrape a listing, category, or search-results page into repeated records. Use this for products, jobs, vendors, events, properties, or other repeated entities.',
    inputSchema: ScrapeListingInputSchema,

    async handler(params: unknown): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = ScrapeListingInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          max_results: input.maxItems,
        },
      };

      logger.info('Scrape listing tool invoked', {
        component: 'scrape_listing',
        url: input.url,
        entity_type: input.entity_type,
        fields: input.fields,
        request_id: requestId,
      });

      if (!provider.canExtract(input.url)) {
        throw new ValidationError(`URL protocol not supported: ${input.url}`, 'url', input.url);
      }

      try {
        const result: ScrapeListingResult = await provider.scrapeListing(input.url, input);
        const envelope: ToolResponseEnvelope<ScrapeListingResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result,
        };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      } catch (error) {
        logger.error('Scrape listing tool failed', {
          component: 'scrape_listing',
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

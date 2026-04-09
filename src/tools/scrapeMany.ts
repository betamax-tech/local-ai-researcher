import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { ResponseMeta, ScrapeManyResult, ScrapePageResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { ScrapeProvider } from '../providers/interfaces.js';
import { Logger } from '../lib/logger.js';
import { ResearcherError, ValidationError } from '../lib/errors.js';
import type { ToolResponseEnvelope } from '../domain/types.js';

export const ScrapeManyInputSchema = z.object({
  urls: z.array(z.string().url().max(2000)).min(1).max(50)
    .describe('Known detail-page URLs to scrape in parallel'),
  entity_type: z.enum(['generic', 'product', 'job', 'company', 'event', 'property']).optional().default('generic')
    .describe('Entity type shared by the pages being scraped'),
  fields: z.array(z.string().min(1)).optional().default([])
    .describe('Fields the AI wants from each page, such as price, company, location, rating, or date'),
  goal: z.string().optional().describe('Shared natural-language scraping goal applied to all URLs'),
  mode: z.enum(['auto', 'static', 'dynamic']).optional().default('auto'),
  content_mode: z.enum(['full', 'excerpt']).optional().default('full'),
  targetWords: z.number().int().min(1).max(10000).optional(),
  maxRecords: z.number().int().min(1).max(200).optional().default(10),
  maxConcurrency: z.number().int().min(1).max(10).optional().default(5),
});

export function createScrapeManyTool(provider: ScrapeProvider, logger: Logger) {
  return {
    name: 'scrape_many',
    description:
      'Scrape many known URLs in parallel using the same extraction intent. Use this after collecting detail-page links from a listing page or another source.',
    inputSchema: ScrapeManyInputSchema,

    async handler(params: unknown): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = ScrapeManyInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          max_results: input.urls.length,
          max_concurrent_reads: input.maxConcurrency,
        },
      };

      logger.info('Scrape many tool invoked', {
        component: 'scrape_many',
        count: input.urls.length,
        entity_type: input.entity_type,
        request_id: requestId,
      });

      for (const url of input.urls) {
        if (!provider.canExtract(url)) {
          throw new ValidationError(`URL protocol not supported: ${url}`, 'urls', url);
        }
      }

      try {
        const startTime = Date.now();
        const results: ScrapePageResult[] = [];
        const failures: Array<{ url: string; error: string }> = [];

        let cursor = 0;
        const workerCount = Math.min(input.maxConcurrency, input.urls.length);

        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= input.urls.length) return;
            const url = input.urls[index];
            if (!url) return;
            try {
              const result = await provider.scrapePage(url, {
                entity_type: input.entity_type,
                fields: input.fields,
                goal: input.goal,
                mode: input.mode,
                content_mode: input.content_mode,
                targetWords: input.targetWords,
                maxRecords: input.maxRecords,
              });
              results.push(result);
            } catch (error) {
              failures.push({
                url,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }));

        const result: ScrapeManyResult = {
          entity_type: input.entity_type,
          goal: input.goal,
          fields_requested: input.fields,
          results,
          failures,
          summary: {
            attempted: input.urls.length,
            succeeded: results.length,
            failed: failures.length,
            totalDuration: Date.now() - startTime,
          },
        };

        const envelope: ToolResponseEnvelope<ScrapeManyResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result,
        };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      } catch (error) {
        logger.error('Scrape many tool failed', {
          component: 'scrape_many',
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

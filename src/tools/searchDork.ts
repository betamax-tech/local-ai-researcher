import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { ResponseMeta, SearchResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearchProvider } from '../providers/interfaces.js';
import { ProviderUnavailableError, ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { ProviderRegistry } from '../lib/provider-registry.js';

export const SearchDorkInputSchema = z.object({
  query: z.string().min(1).max(500).describe('Google-style operator query, e.g. site:dof.gov.ph filetype:pdf intitle:budget'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe('Maximum number of result URLs to return (default 10, max 50).'),
  language: z.string().optional().describe('Optional language code for the Google-backed search request'),
});

export function createSearchDorkTool(
  providerOrRegistry: SearchProvider | ProviderRegistry,
  logger: Logger,
  options?: { timeoutMs?: number }
) {
  const timeoutMs = options?.timeoutMs ?? 10000;

  const getProvider = (): SearchProvider => {
    if (providerOrRegistry instanceof ProviderRegistry) {
      return providerOrRegistry.resolve('local');
    }
    return providerOrRegistry;
  };

  return {
    name: 'search_dork',
    description:
      'Google-only search for queries that need the inurl:, intitle: or filetype: operators, which it applies ' +
      'strictly. Returns up to 10 links (title, URL, snippet) by default.\n' +
      'Use when the user asks for files of a type ("PDFs", "spreadsheets", "slides"), or for pages with a ' +
      'given word in their URL or title.\n' +
      'Tie-break vs search: the user asks for a file type, or for a word in the URL or title → search_dork ' +
      '(even when a site is also named). Everything else — plain words, quotes, or a site: restriction on its ' +
      'own — → search, which covers more engines and has news/time filters.\n' +
      'Not for reading the pages — use read; not for records on a listing page — use scrape_listing.',
    inputSchema: SearchDorkInputSchema,

    async handler(params: unknown): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = SearchDorkInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      let provider: SearchProvider;
      try {
        provider = getProvider();
      } catch (error) {
        if (error instanceof ProviderUnavailableError) {
          const meta: ResponseMeta = {
            request_id: requestId,
            timestamp,
            provider_id: 'registry',
            provider_name: 'Provider Registry',
            applied_limits: {
              timeout_ms: timeoutMs,
              max_results: input.limit,
            },
            cache_status: 'disabled',
          };

          const envelope: ToolResponseEnvelope<never> = {
            schema_version: SCHEMA_VERSION,
            ok: false,
            meta,
            error: {
              code: error.code,
              message: `search_dork requires a configured local SearXNG provider with Google engine support. ${error.message}`,
              retryable: false,
              details: error.details,
            },
          };
          return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
        }
        throw error;
      }

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          timeout_ms: timeoutMs,
          max_results: input.limit,
        },
        cache_status: 'disabled',
      };

      logger.info('Search dork tool invoked', {
        component: 'search_dork',
        query: input.query,
        request_id: requestId,
      });

      try {
        const results: SearchResult[] = await provider.search(input.query, {
          limit: input.limit,
          language: input.language,
          forcedEngines: ['google'],
        });

        const envelope: ToolResponseEnvelope<{ results: SearchResult[]; total: number }> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result: {
            results,
            total: results.length,
          },
        };

        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      } catch (error) {
        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
          meta,
          error: {
            code: error instanceof ResearcherError ? error.code : 'ERR_SEARXNG_UNAVAILABLE',
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

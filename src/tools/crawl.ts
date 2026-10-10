/**
 * Background crawl tools — thin wrappers over the Scrapling sidecar's /jobs API.
 *
 * The crawl runs inside the sidecar container and survives this MCP process
 * (and container restarts). These tools only start, poll, control, and read.
 * Design: vault/ai/docs/access-escalation-and-crawl-jobs.md (Part B).
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { ResponseMeta, ToolResponseEnvelope } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import { ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import { validateSsrf } from '../lib/ssrf.js';

export interface CrawlBackend {
  id: string;
  name: string;
  crawl(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown>;
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const jobId = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,64}$/)
  .describe('Job id returned by crawl_start');

export const CrawlStartInputSchema = z.object({
  start_urls: z.array(z.string().url().max(2000)).min(1).max(50)
    .describe('Pages to start from. Links found on them are followed (same site by default).'),
  allow: z.string().max(500).optional()
    .describe('Only follow URLs matching this regex (replaces the same-site rule), e.g. "example\\\\.com/docs/".'),
  deny: z.string().max(500).optional().describe('Never follow URLs matching this regex, e.g. "/(tag|login)/".'),
  max_pages: z.number().int().min(1).max(5000).optional().default(200)
    .describe('Stop after this many pages (default 200, max 5000).'),
  max_depth: z.number().int().min(0).max(20).optional().default(3)
    .describe('Link hops from the start pages (0 = only the start pages).'),
  max_hours: z.number().min(0.05).max(72).optional().default(24).describe('Stop after this many hours.'),
  delay_s: z.number().min(1).max(600).optional()
    .describe('Seconds between requests. Default 2 s, 30 s after pages that needed the stealth browser.'),
  max_tier: z.enum(['static', 'dynamic', 'stealth']).optional().default('stealth')
    .describe("Highest fetch tier the crawl may escalate to. 'static' crawls are cheaper and two can run at once; " +
      'only one browser-capable crawl runs at a time (others wait in the queue).'),
  extract: z.enum(['text', 'selector', 'links']).optional().default('text')
    .describe("'text' = main page text per page; 'selector' = elements matching `selector`; 'links' = just record the URLs."),
  selector: z.string().max(500).optional().describe("CSS selector, required when extract is 'selector'."),
  label: z.string().max(200).optional().describe('Free-text label to recognise the job later.'),
});

export const CrawlStatusInputSchema = z.object({
  job_id: jobId.optional().describe('Job id. Omit to list recent jobs.'),
});

export const CrawlControlInputSchema = z.object({
  job_id: jobId,
  action: z.enum(['pause', 'resume', 'cancel'])
    .describe("'pause' keeps progress (resume later); 'cancel' stops for good (results stay readable)."),
});

export const CrawlResultsInputSchema = z.object({
  job_id: jobId,
  cursor: z.number().int().min(0).optional().default(0)
    .describe('Start at this item index; pass the previous response\'s next_cursor.'),
  limit: z.number().int().min(1).max(100).optional().default(20).describe('Items per call (max 100).'),
});

function envelope(backend: CrawlBackend, result: unknown): ToolResult {
  const meta: ResponseMeta = {
    request_id: randomUUID(),
    timestamp: new Date().toISOString(),
    provider_id: backend.id,
    provider_name: backend.name,
    applied_limits: { timeout_ms: 15000 },
  };
  const env: ToolResponseEnvelope<unknown> = { schema_version: SCHEMA_VERSION, ok: true, meta, result };
  return { content: [{ type: 'text', text: JSON.stringify(env, null, 2) }] };
}

function failure(backend: CrawlBackend, error: unknown): ToolResult {
  const meta: ResponseMeta = {
    request_id: randomUUID(),
    timestamp: new Date().toISOString(),
    provider_id: backend.id,
    provider_name: backend.name,
    applied_limits: { timeout_ms: 15000 },
  };
  const env: ToolResponseEnvelope<never> = {
    schema_version: SCHEMA_VERSION,
    ok: false,
    meta,
    error: {
      code: error instanceof ResearcherError ? error.code : 'ERR_EXTRACT_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Unknown error',
      retryable: error instanceof ResearcherError ? error.retryable : false,
    },
  };
  return { content: [{ type: 'text', text: JSON.stringify(env, null, 2) }], isError: true };
}

const STATE_GUIDE =
  "Job `state`: queued (waiting for a free slot) · running · rate_limited (a site asked us to slow down; " +
  'the job waits out `retry_after_s` by itself — do not start another crawl of that site) · paused · ' +
  'done · failed · cancelled.';

export function createCrawlTools(backend: CrawlBackend, logger: Logger, options: { allowPrivateNetworks?: boolean } = {}) {
  const allowed = options.allowPrivateNetworks ? ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] : [];

  const wrap = (name: string, run: (input: any) => Promise<unknown>, schema: z.ZodTypeAny) =>
    async (params: unknown): Promise<ToolResult> => {
      try {
        const input = schema.parse(params);
        logger.info('Crawl tool invoked', { component: name });
        return envelope(backend, await run(input));
      } catch (error) {
        logger.warn('Crawl tool failed', {
          component: name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return failure(backend, error);
      }
    };

  const start = {
    name: 'crawl_start',
    description:
      'Start a background crawl that follows links from `start_urls` and collects page text (or selected ' +
      'elements). Returns a job id immediately; the crawl keeps running after this call, after this session, ' +
      'and across restarts. Poll `crawl_status` (at most once a minute) and read data with `crawl_results`. ' +
      'Use this for tens to thousands of pages on one site; for one page use `scrape_page`, for a handful ' +
      'of known URLs use `scrape_many`. The crawl obeys robots.txt, stays on the start site by default, ' +
      'escalates to a stealth browser by itself when a site needs it, and pauses itself on rate limits.',
    inputSchema: CrawlStartInputSchema,
    handler: wrap('crawl_start', async (input) => {
      for (const u of input.start_urls as string[]) await validateSsrf(u, allowed);
      return backend.crawl('POST', '/jobs', input);
    }, CrawlStartInputSchema),
  };

  const status = {
    name: 'crawl_status',
    description:
      'Progress of a background crawl: state, pages done / failed / queued, items collected, the last ' +
      'page\'s access outcome. Omit job_id to list recent jobs. ' + STATE_GUIDE,
    inputSchema: CrawlStatusInputSchema,
    handler: wrap('crawl_status', async (input) =>
      input.job_id ? backend.crawl('GET', `/jobs/${input.job_id}`) : backend.crawl('GET', '/jobs'),
    CrawlStatusInputSchema),
  };

  const control = {
    name: 'crawl_control',
    description: 'Pause, resume, or cancel a background crawl. Paused crawls keep their progress.',
    inputSchema: CrawlControlInputSchema,
    handler: wrap('crawl_control', async (input) =>
      backend.crawl('POST', `/jobs/${input.job_id}/${input.action}`), CrawlControlInputSchema),
  };

  const results = {
    name: 'crawl_results',
    description:
      'Read items a background crawl has collected so far, in pages of up to 100. Each item has url, ' +
      'title, depth, tier, and text (or records). Pass `next_cursor` back as `cursor` for the next page; ' +
      'null means you have everything collected so far. Works while the crawl is still running. ' +
      'Results are deleted 14 days after the crawl ends.',
    inputSchema: CrawlResultsInputSchema,
    handler: wrap('crawl_results', async (input) =>
      backend.crawl('GET', `/jobs/${input.job_id}/results?cursor=${input.cursor}&limit=${input.limit}`),
    CrawlResultsInputSchema),
  };

  return [start, status, control, results];
}

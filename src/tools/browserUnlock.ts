import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BrowserUnlockResult } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';

export const BrowserUnlockInputSchema = z.object({
  url: z.string().url().max(2000).describe('Public HTTP(S) page needing a browser bot check. Never use on a rate-limited host.'),
});

export function createBrowserUnlockTool(backend: { unlock(url: string): Promise<BrowserUnlockResult> }) {
  return {
    name: 'browser_unlock',
    description: 'Open a public URL in the user\'s own local browser so they can pass a Cloudflare / "verify you are ' +
      'human" check by hand; waits for the new clearance so later scrapes of that site can succeed.\n' +
      'Use only after scrape_page, scrape_listing or scrape_many returned access.outcome \'bot_challenge\' for a ' +
      'page the user still needs, and the user is at the machine to click through the check in the opened tab.\n' +
      'Never for \'rate_limited\' (wait out access.retry_after_s), \'forbidden\' or \'not_found\' (use another ' +
      'source) or \'auth_required\' (pass `cookies`). Opt-in: returns status \'disabled\' unless ' +
      'BROWSER_COOKIES=auto; honours host cooldowns.\n' +
      'Returns {captured, status, domain, hint} only, never cookies. After \'captured\', retry the scrape once; ' +
      'if still refused, use another source — do not loop.',
    inputSchema: BrowserUnlockInputSchema,
    async handler(params: unknown) {
      try {
        const { url } = BrowserUnlockInputSchema.parse(params);
        const value = await backend.unlock(url);
        // Allowlist output even if an injected backend returns additional properties.
        const result = { captured: value.captured, status: value.status, domain: value.domain, hint: value.hint };
        return { content: [{ type: 'text', text: JSON.stringify({ schema_version: SCHEMA_VERSION, ok: true,
          meta: { request_id: randomUUID(), timestamp: new Date().toISOString(), provider_id: 'scrapling',
            provider_name: 'Scrapling', applied_limits: {} }, result }) }] };
      } catch {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ schema_version: SCHEMA_VERSION,
          ok: false, error: { code: 'ERR_VALIDATION', message: 'Browser unlock failed or URL invalid.', retryable: false } }) }] };
      }
    },
  };
}

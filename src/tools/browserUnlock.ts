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
    description: 'Open a public URL in the opted-in local browser and wait for a newly created Cloudflare clearance. ' +
      'Complete the check in the opened tab. Honors host cooldowns. Disabled unless BROWSER_COOKIES=auto. ' +
      'Returns only capture status and guidance, never cookies. Retry scraping once after capture; do not loop.',
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

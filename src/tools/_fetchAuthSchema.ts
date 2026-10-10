/**
 * Shared Zod field definitions for auth / egress / stealth controls, reused by
 * every Scrapling-backed tool (extract, scrape_page, scrape_listing,
 * scrape_many) so the AI-facing descriptions stay identical and discoverable.
 *
 * These are the strings the model reads to decide WHEN and HOW to fetch behind
 * sign-in walls, bypass bot-walls, and control the egress IP.
 */
import { z } from 'zod';

/** Fetch-mode enum shared by all Scrapling tools. Expert override only. */
export const scraplingModeField = z
  .enum(['auto', 'static', 'dynamic', 'stealth'])
  .optional()
  .default('auto')
  .describe(
    "Leave as 'auto'. The server escalates by itself: plain HTTP → browser (pages that need " +
      'JavaScript) → stealth browser (bot checks, Cloudflare "just a moment", 403), and remembers per ' +
      "site which tier works. Set 'static' / 'dynamic' / 'stealth' only to force exactly one tier " +
      'for debugging; a forced tier does not escalate.'
  );

/**
 * Shared paragraph appended to every Scrapling tool description: how to read
 * `access` and what to do about each outcome.
 */
export const ACCESS_GUIDANCE =
  ' Every result has `access.outcome` — check it before using the content. ' +
  "'ok' = real page. 'rate_limited' = the site asked us to slow down: do NOT contact that site " +
  'again until `access.retry_after_s` has passed, with ANY tool or mode — switching tools or modes ' +
  "does not help and makes the block longer. 'bot_challenge' / 'forbidden' = the site refused even " +
  "the stealth browser: use another source. 'auth_required' = login needed: retry only with " +
  "`cookies` you are allowed to use. 'not_found' = page gone. Follow `access.next` when present.";

/** Cookie / header / proxy / direct fields, identical across all Scrapling tools. */
export const fetchAuthShape = {
  max_tier: z
    .enum(['static', 'dynamic', 'stealth'])
    .optional()
    .describe(
      "Highest tier the server may escalate to (default 'stealth'). Set 'static' or 'dynamic' " +
        'only when you need fast, cheap fetches and can accept failure on protected sites.'
    ),
  cookies: z
    .union([z.record(z.string()), z.string(), z.array(z.record(z.unknown()))])
    .optional()
    .describe(
      'Session cookies to fetch pages behind a sign-in wall (i.e. as a logged-in ' +
        'user). Accepts a {name: value} map, a raw "k=v; k2=v2" Cookie-header string, ' +
        'or a list of cookie objects. Pair with direct:true to keep the session on one IP.'
    ),
  headers: z
    .record(z.string())
    .optional()
    .describe('Extra HTTP request headers to send (e.g. a custom User-Agent or Referer).'),
  proxy: z
    .string()
    .optional()
    .describe(
      'Egress proxy URL (http://host:port) to route this fetch through. ' +
        'Omit to use the server default (or direct egress if none). Ignored when direct:true.'
    ),
  direct: z
    .boolean()
    .optional()
    .describe(
      'Force direct egress with NO proxy, even if a default proxy is configured. ' +
        "Set true when using cookies/authenticated sessions so all requests for that " +
        'session come from ONE consistent IP (avoids multi-IP fraud flags / re-login prompts).'
    ),
} as const;

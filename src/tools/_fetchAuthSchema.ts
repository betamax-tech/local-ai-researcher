/**
 * Shared Zod field definitions for auth / egress / stealth controls, reused by
 * every Scrapling-backed tool (extract, scrape_page, scrape_listing,
 * scrape_many) so the AI-facing descriptions stay identical and discoverable.
 *
 * These are the strings the model reads to decide WHEN and HOW to fetch behind
 * sign-in walls, bypass bot-walls, and control the egress IP.
 */
import { z } from 'zod';

/** Fetch-mode enum shared by all Scrapling tools, including the stealth lane. */
export const scraplingModeField = z
  .enum(['auto', 'static', 'dynamic', 'stealth'])
  .optional()
  .default('auto')
  .describe(
    'How to fetch the page. Escalate only as needed: ' +
      "'static' = fast HTTP, no JavaScript; " +
      "'dynamic' = headless browser that renders JavaScript (use for JS-heavy pages); " +
      "'stealth' = anti-detection browser that solves Cloudflare challenges and hardens " +
      'fingerprints — use ONLY when a site blocks normal fetches (bot-wall, "verify you are ' +
      'human", 403/CAPTCHA); it is the slowest; ' +
      "'auto' (default) = start static and escalate to dynamic when content looks thin."
  );

/** Cookie / header / proxy / direct fields, identical across all Scrapling tools. */
export const fetchAuthShape = {
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

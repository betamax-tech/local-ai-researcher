import { open } from 'node:fs/promises';
import { z } from 'zod';

const cookieSchema = z.object({
  name: z.string().min(1), value: z.string(),
  domain: z.string().regex(/^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i),
  path: z.string().startsWith('/'), secure: z.boolean().optional(),
  expires: z.number().finite().optional(), httpOnly: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  partitionKey: z.string().optional(),
});
export type ReadCookie = z.infer<typeof cookieSchema>;

/** Preserve domain/path/secure metadata; never flatten authenticated browser cookies. */
export function scopeReadCookies(cookies: ReadCookie[], value: string): ReadCookie[] {
  const url = new URL(value);
  return cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    const matches = cookie.domain.startsWith('.')
      ? url.hostname === domain || url.hostname.endsWith(`.${domain}`) : url.hostname === domain;
    const path = cookie.path;
    return matches && !cookie.partitionKey && (!cookie.secure || url.protocol === 'https:') &&
      (cookie.expires == null || cookie.expires === -1 || cookie.expires > Date.now() / 1000) &&
      (url.pathname === path || (url.pathname.startsWith(path) && (path.endsWith('/') || url.pathname[path.length] === '/')));
  });
}

export function parseReadCookies(value: unknown, url: string): ReadCookie[] {
  return scopeReadCookies(z.array(cookieSchema).max(10000).parse(value), url);
}

/** Operator-configured mounted secret; never accept a path from tool arguments. */
export async function readCookieFile(path: string, url: string): Promise<ReadCookie[]> {
  try {
    const file = await open(path, 'r');
    try {
      const maxBytes = 1024 * 1024;
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw new Error();
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxBytes) throw new Error();
      const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      return parseReadCookies(Array.isArray(value) ? value : value.cookies, url);
    } finally { await file.close(); }
  } catch { throw new Error('Reader cookie file unavailable or invalid.'); }
}

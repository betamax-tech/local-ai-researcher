import { execFile, spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { BlockList } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { BrowserUnlockConfig, BrowserUnlockResult } from '../domain/types.js';
import { validateSsrfSync } from './ssrf.js';

const snapshotSchema = z.object({
  domain: z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/),
  cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string(),
    path: z.string(), secure: z.boolean().optional(), expires: z.number().optional() }).passthrough()),
  clearance_created_at: z.number().finite().nullable(),
});
export type CookieSnapshot = z.infer<typeof snapshotSchema>;

/** Static Fetcher accepts a cookie map, not Playwright cookie objects. Select
 * only cookies that apply to this URL before dropping their browser metadata. */
export function cookiesForUrl(snapshot: CookieSnapshot, value: string): Record<string, string> {
  const url = new URL(value);
  const applicable = snapshot.cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    const domainMatches = cookie.domain.startsWith('.')
      ? url.hostname === domain || url.hostname.endsWith(`.${domain}`) : url.hostname === domain;
    const path = cookie.path || '/';
    return domainMatches && (!cookie.secure || url.protocol === 'https:') &&
      (cookie.expires == null || cookie.expires > Date.now() / 1000) &&
      (url.pathname === path || (url.pathname.startsWith(path) && (path.endsWith('/') || url.pathname[path.length] === '/')));
  });
  // Maps cannot retain duplicate names: prefer the most-specific applicable path.
  return Object.fromEntries(applicable.sort((a, b) => a.path.length - b.path.length).map(cookie => [cookie.name, cookie.value]));
}

export interface BrowserUnlockDependencies {
  read(url: string): Promise<CookieSnapshot>;
  open(url: string): Promise<void>;
  validate(url: string): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Internal cookie-only live probes must set false. Not an environment option. */
  allowOpen: boolean;
}

const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv6Special = new BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  ipv6Special.addSubnet(network, prefix, 'ipv6');
}

// Fail closed on DNS errors and mixed public/private answers. The existing
// sidecar remains responsible for validating its own redirects.
export async function validateBrowserUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (value.length > 2000 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.')) throw new Error('Invalid browser URL');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Browser URL DNS timeout')), 2000); }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length) throw new Error('Invalid browser URL');
  for (const { address, family } of addresses) {
    if (family === 6) {
      if (!ipv6Global.check(address, 'ipv6') || ipv6Special.check(address, 'ipv6')) throw new Error('Invalid browser URL');
      continue;
    }
    if (family !== 4 || Number(address.split('.')[0]) >= 224 || address.startsWith('198.18.') || address.startsWith('198.19.')) {
      throw new Error('Invalid browser URL');
    }
    validateSsrfSync(`http://${address}`);
  }
}

function defaults(config: BrowserUnlockConfig): BrowserUnlockDependencies {
  // Match Python expanduser/resolve semantics for the selected browser root.
  const root = config.userDataDir;
  const userDataDir = root ? resolve(root === '~' ? homedir() : root.startsWith('~/') ? `${homedir()}/${root.slice(2)}` : root) : undefined;
  return {
    allowOpen: true,
    validate: validateBrowserUrl,
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    read: url => new Promise((resolve, reject) => {
      execFile('python3', [fileURLToPath(new URL('../../scripts/browser_cookies.py', import.meta.url)), '--url', url], {
        timeout: 10000, maxBuffer: 1024 * 1024,
        env: { ...process.env, LOCAL_RESEARCHER_BROWSER_PROFILE: config.profile,
          ...(userDataDir ? { LOCAL_RESEARCHER_BROWSER_USER_DATA_DIR: userDataDir } : {}) },
      }, (error, stdout) => {
        // Never expose stderr, raw JSON, or child-process exception properties.
        if (error) { reject(new Error('Browser cookie extraction failed.')); return; }
        try { resolve(snapshotSchema.parse(JSON.parse(stdout))); }
        catch { reject(new Error('Browser cookie extraction failed.')); }
      });
    }),
    open: url => new Promise((resolve, reject) => {
      const child = spawn(config.command, [
        ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
        `--profile-directory=${config.profile}`, url,
      ], { detached: true, stdio: 'ignore', shell: false });
      child.once('error', () => reject(new Error('Browser launch failed.')));
      child.once('spawn', () => { child.unref(); resolve(); });
    }),
  };
}

export class BrowserUnlockCoordinator {
  private pending = new Map<string, Promise<BrowserUnlockResult>>();
  private deps: BrowserUnlockDependencies;
  constructor(private config: BrowserUnlockConfig | undefined,
    private held: (host: string) => Promise<boolean>, dependencies: Partial<BrowserUnlockDependencies> = {}) {
    this.deps = { ...defaults(config ?? { cookies: 'off', profile: 'Profile 1', command: 'brave-origin-stable',
      userAgent: '', unlockWait: 120, impersonate: 'chrome131' }), ...dependencies };
  }
  get enabled(): boolean { return this.config?.cookies === 'auto'; }
  async read(url: string): Promise<CookieSnapshot | undefined> {
    if (!this.enabled) return undefined;
    try {
      await this.deps.validate(url);
      const snapshot = snapshotSchema.parse(await this.deps.read(url));
      const host = new URL(url).hostname;
      if (host !== snapshot.domain && !host.endsWith(`.${snapshot.domain}`)) return undefined;
      return snapshot;
    } catch { return undefined; }
  }
  async unlock(url: string): Promise<BrowserUnlockResult> {
    const result = (status: BrowserUnlockResult['status'], domain = ''): BrowserUnlockResult => ({
      captured: status === 'captured', status, domain,
      hint: status === 'captured' ? 'Fresh clearance captured; retry the page once.' :
        status === 'rate_limited' ? 'Host cooldown active. Wait; do not retry with any tool.' :
        status === 'disabled' ? 'Browser cookies are off; opt in to enable browser unlock.' :
        status === 'timeout' ? 'Complete the check in the opened tab. If the site refused access, use another source.' :
        'Browser unlock unavailable; use another source or check local browser setup.',
    });
    if (!this.enabled) return result('disabled');
    try { await this.deps.validate(url); } catch { return result('invalid_url'); }
    try {
      const host = new URL(url).hostname;
      if (await this.held(host)) return result('rate_limited', host);
      const initial = await this.read(url);
      if (!initial) return result('failed', host);
      const domain = initial.domain;
      const active = this.pending.get(domain);
      if (active) return active;
      if (!this.deps.allowOpen) return result('open_disabled', domain);
      const work = async () => {
        try {
          // Recheck after cookie read: holds can arrive while the helper runs.
          if (await this.held(host)) return result('rate_limited', domain);
          await this.deps.validate(url);
          const openedAt = this.deps.now() / 1000;
          await this.deps.open(url);
          const deadline = openedAt * 1000 + this.config!.unlockWait * 1000;
          while (this.deps.now() < deadline) {
            if (await this.held(host)) return result('rate_limited', domain);
            const fresh = await this.read(url);
            if (fresh?.clearance_created_at != null && fresh.clearance_created_at > openedAt &&
                Object.hasOwn(cookiesForUrl(fresh, url), 'cf_clearance')) return result('captured', domain);
            await this.deps.sleep(Math.min(1000, Math.max(0, deadline - this.deps.now())));
          }
          return result('timeout', domain);
        } catch { return result('failed', domain); }
      };
      const promise = work();
      this.pending.set(domain, promise);
      try { return await promise; } finally { this.pending.delete(domain); }
    } catch { return result('failed'); }
  }
}

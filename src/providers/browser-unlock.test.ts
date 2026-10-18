import { describe, it, expect, vi } from 'vitest';
import { ScraplingProvider } from './scrapling.js';
import type { BrowserUnlockConfig } from '../domain/types.js';
import { Logger } from '../lib/logger.js';
import { createScrapeManyTool } from '../tools/scrapeMany.js';

const browser: BrowserUnlockConfig = { cookies: 'auto', profile: 'Profile 1', command: 'brave-origin-stable',
  userAgent: 'test UA', unlockWait: 2, impersonate: 'chrome131' };
const snapshot = (created: number | null = null) => ({ domain: 'example.com',
  cookies: [{ name: 'cf_clearance', value: 'fake-clearance', domain: '.example.com', path: '/' }], clearance_created_at: created });
function setup(outcomes: string[], allowOpen = true, enabled = true) {
  const post = vi.fn();
  for (const outcome of outcomes) post.mockResolvedValueOnce({ body: { url: 'https://example.com', mode_used: 'static',
    excerpt: 'content', sections: [], records: [], access: { outcome, tier: 'static', tried: ['static'] } } });
  const get = vi.fn(async () => ({ body: { cooldown_remaining_s: 0 } }));
  let now = 100000;
  const read = vi.fn(async () => snapshot());
  const open = vi.fn(async () => { read.mockResolvedValue(snapshot(101)); });
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
  const provider = new ScraplingProvider({ browser: enabled ? browser : undefined, enabled: 'auto',
    endpoint: 'http://127.0.0.1:8090', timeout: 10000, defaultMode: 'auto', bootstrapWithDocker: false,
    allowPrivateNetworks: false, defaultProxy: 'http://proxy.test' }, { post, get } as any, logger, {
    read, open, validate: async () => {}, now: () => now, sleep: async ms => { now += ms; }, allowOpen,
  });
  return { provider, post, get, read, open, logger };
}

describe('provider bounded browser cookie retries', () => {
  it('scrape_many inherits automatic recovery for every page without exposing cookies', async () => {
    const { provider, post, open, logger } = setup(['bot_challenge', 'ok', 'bot_challenge', 'ok']);
    const response = await createScrapeManyTool(provider, logger).handler({
      urls: ['https://example.com/a', 'https://example.com/b'], maxConcurrency: 1,
    });
    const envelope = JSON.parse(response.content[0]!.text);
    expect(envelope.result.results.map((page: any) => page.access.outcome)).toEqual(['ok', 'ok']);
    expect(response.content[0]!.text).not.toContain('fake-clearance');
    expect(post).toHaveBeenCalledTimes(4); expect(open).not.toHaveBeenCalled();
  });
  it('explicit unlock checks the sidecar host cooldown before helper or browser access', async () => {
    const { provider, get, read, open } = setup([]);
    get.mockResolvedValue({ body: { cooldown_remaining_s: 300 } });
    expect((await provider.browserUnlock.unlock('https://example.com')).status).toBe('rate_limited');
    expect(get).toHaveBeenCalledWith('http://127.0.0.1:8090/hosts/example.com', expect.objectContaining({ retry: false }));
    expect(read).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it.each(['scrapePage', 'scrapeListing', 'extract'] as const)('retries %s once using existing cookies, static impersonation, matching UA, direct egress', async method => {
    const { provider, post, open } = setup(['bot_challenge', 'ok']);
    expect((await provider[method]('https://example.com', { headers: { 'user-agent': 'wrong', Referer: 'https://example.com' } })).access?.outcome).toBe('ok');
    expect(post).toHaveBeenCalledTimes(2); expect(open).not.toHaveBeenCalled();
    expect(post.mock.calls[1]![1]).toMatchObject({ mode: 'static', max_tier: 'static', impersonate: 'chrome131',
      headers: { 'User-Agent': 'test UA', Referer: 'https://example.com' }, cookies: { cf_clearance: 'fake-clearance' } });
    expect(post.mock.calls[1]![1]).not.toHaveProperty('proxy');
    expect(post.mock.calls[1]![1].headers).not.toHaveProperty('user-agent');
  });
  it('opens/polls once and retries once with fresh cookies, never loops on final challenge', async () => {
    const { provider, post, open } = setup(['bot_challenge', 'bot_challenge', 'bot_challenge']);
    expect((await provider.scrapePage('https://example.com')).access?.next).toContain('Site refused');
    expect(post).toHaveBeenCalledTimes(3); expect(open).toHaveBeenCalledTimes(1);
  });
  it('fresh cookies can resolve the second-stage challenge', async () => {
    const { provider, post, open } = setup(['bot_challenge', 'bot_challenge', 'ok']);
    expect((await provider.scrapeListing('https://example.com')).access?.outcome).toBe('ok');
    expect(post).toHaveBeenCalledTimes(3); expect(open).toHaveBeenCalledTimes(1);
  });
  it.each(['rate_limited', 'forbidden', 'auth_required', 'not_found', 'network', 'js_required', 'server_error', 'ok'])
  ('never reads cookies or opens for %s', async outcome => {
    const { provider, post, read, open } = setup([outcome]);
    await provider.scrapePage('https://example.com');
    expect(post).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it.each(['rate_limited', 'forbidden', 'auth_required'])('stops after cookie retry becomes %s', async outcome => {
    const { provider, post, open } = setup(['bot_challenge', outcome]);
    expect((await provider.scrapePage('https://example.com')).access?.outcome).toBe(outcome);
    expect(post).toHaveBeenCalledTimes(2); expect(open).not.toHaveBeenCalled();
  });
  it('disabled cold start has no helper or browser work', async () => {
    const { provider, post, read, open } = setup(['bot_challenge'], true, false);
    await provider.scrapePage('https://example.com');
    expect(post).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    expect((await provider.browserUnlock.unlock('https://example.com')).status).toBe('disabled');
  });
  it('cookie-only mode keeps a final challenge and never opens a tab', async () => {
    const { provider, post, open } = setup(['bot_challenge', 'bot_challenge'], false);
    expect((await provider.scrapePage('https://example.com')).access?.outcome).toBe('bot_challenge');
    expect(post).toHaveBeenCalledTimes(2); expect(open).not.toHaveBeenCalled();
  });
  it('does not leak errors/bodies from credential retries', async () => {
    const { provider, post, logger } = setup(['bot_challenge']);
    post.mockRejectedValueOnce(Object.assign(new Error('secret-cookie'), { details: { body: { cookie: 'secret-cookie' } } }));
    await expect(provider.scrapePage('https://example.com')).rejects.toThrow('credential request failed');
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('secret-cookie');
  });
});

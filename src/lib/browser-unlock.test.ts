import { describe, it, expect, vi } from 'vitest';
import { BrowserUnlockCoordinator, cookiesForUrl, validateBrowserUrl, type BrowserUnlockDependencies } from './browser-unlock.js';
import type { BrowserUnlockConfig } from '../domain/types.js';

export const config: BrowserUnlockConfig = { cookies: 'auto', profile: 'Profile 1', command: 'brave-origin-stable',
  userAgent: 'test UA', unlockWait: 2, impersonate: 'chrome131' };
export const snapshot = (created: number | null = null) => ({ domain: 'example.com',
  cookies: [{ name: 'cf_clearance', value: 'fake-test-value', domain: '.example.com', path: '/' }], clearance_created_at: created });
function setup(overrides: Partial<BrowserUnlockDependencies> = {}, held = vi.fn(async () => false)) {
  let now = 100000;
  const deps = { read: vi.fn(async () => snapshot()), open: vi.fn(async () => {}), validate: vi.fn(async () => {}),
    now: () => now, sleep: vi.fn(async (ms: number) => { now += ms; }), allowOpen: true, ...overrides };
  return { deps, held, coordinator: new BrowserUnlockCoordinator(config, held, deps) };
}

describe('browser unlock coordinator (no live browser or cookie access)', () => {
  it('selects URL-scoped cookies for the static map without sibling, path, secure or expired cookies', () => {
    const cookies = [
      { name: 'cf_clearance', value: 'root', domain: '.example.com', path: '/' },
      { name: 'cf_clearance', value: 'specific', domain: '.example.com', path: '/docs' },
      { name: 'sibling', value: 'omit', domain: 'shop.example.com', path: '/' },
      { name: 'hostonly', value: 'omit', domain: 'example.com', path: '/' },
      { name: 'path', value: 'omit', domain: '.example.com', path: '/doc' },
      { name: 'expired', value: 'omit', domain: '.example.com', path: '/', expires: 1 },
      { name: 'secure', value: 'omit-http', domain: '.example.com', path: '/', secure: true },
    ];
    expect(cookiesForUrl({ ...snapshot(), cookies }, 'http://www.example.com/docs/a')).toEqual({ cf_clearance: 'specific' });
    expect(cookiesForUrl({ ...snapshot(), cookies }, 'https://www.example.com/docs/a')).toEqual({ cf_clearance: 'specific', secure: 'omit-http' });
  });
  it('does nothing at disabled cold start, including explicit unlock', async () => {
    const read = vi.fn(), open = vi.fn(), validate = vi.fn();
    const coordinator = new BrowserUnlockCoordinator(undefined, vi.fn(), { read, open, validate });
    expect(await coordinator.read('not a URL')).toBeUndefined();
    expect((await coordinator.unlock('not a URL')).status).toBe('disabled');
    expect(read).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
  });
  it('requires creation strictly newer than open, not an old clearance', async () => {
    const { coordinator, deps } = setup();
    vi.mocked(deps.read).mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(100)).mockResolvedValueOnce(snapshot(100.1));
    expect(await coordinator.unlock('https://example.com/a')).toMatchObject({ captured: true, status: 'captured', domain: 'example.com' });
    expect(deps.open).toHaveBeenCalledTimes(1); expect(deps.sleep).toHaveBeenCalledTimes(1);
  });
  it('times out once, releases the lock, and gives opened-tab guidance', async () => {
    const { coordinator, deps } = setup();
    expect(await coordinator.unlock('https://example.com')).toMatchObject({ captured: false, status: 'timeout', hint: expect.stringContaining('opened tab') });
    await coordinator.unlock('https://example.com');
    expect(deps.open).toHaveBeenCalledTimes(2);
  });
  it('shares one pending open per helper-derived registrable domain across subdomains', async () => {
    let finish!: () => void;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const open = vi.fn(() => wait);
    const { coordinator, deps } = setup({ open });
    const first = coordinator.unlock('https://www.example.com/a');
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const second = coordinator.unlock('https://shop.example.com/b');
    await vi.waitFor(() => expect(deps.read).toHaveBeenCalledTimes(2));
    finish();
    expect(await first).toEqual(await second); expect(open).toHaveBeenCalledTimes(1);
  });
  it('honors cooldown before reading or opening, and fails closed on unavailable host state', async () => {
    const held = vi.fn(async () => true);
    const { coordinator, deps } = setup({}, held);
    expect((await coordinator.unlock('https://example.com')).status).toBe('rate_limited');
    expect(deps.read).not.toHaveBeenCalled(); expect(deps.open).not.toHaveBeenCalled();
    held.mockRejectedValueOnce(new Error('secret body'));
    expect(JSON.stringify(await coordinator.unlock('https://example.com'))).not.toContain('secret body');
  });
  it('supports internal no-open probes without a public environment setting', async () => {
    const { coordinator, deps } = setup({ allowOpen: false });
    expect((await coordinator.unlock('https://example.com')).status).toBe('open_disabled');
    expect(deps.open).not.toHaveBeenCalled();
  });
  it('sanitizes helper and spawn failures and releases failed opens', async () => {
    const { coordinator, deps } = setup();
    vi.mocked(deps.open).mockRejectedValue(new Error('secret error'));
    expect((await coordinator.unlock('https://example.com')).status).toBe('failed');
    await coordinator.unlock('https://example.com');
    expect(deps.open).toHaveBeenCalledTimes(2);
    vi.mocked(deps.read).mockRejectedValue(new Error('secret error'));
    expect(await coordinator.read('https://example.com')).toBeUndefined();
    expect(JSON.stringify(await coordinator.unlock('https://example.com'))).not.toContain('secret');
  });
  it('rejects helper domain mismatches and URL validation failures before open', async () => {
    const { coordinator, deps } = setup();
    expect((await coordinator.unlock('https://evil.test')).status).toBe('failed');
    vi.mocked(deps.validate).mockRejectedValue(new Error('bad URL'));
    expect((await coordinator.unlock('https://example.com')).status).toBe('invalid_url');
    expect(deps.open).not.toHaveBeenCalled();
  });
  it.each(['file:///tmp/test', 'https://u:p@example.com', 'http://127.0.0.1', 'http://100.64.0.1', 'http://[::1]', '--flag'])
  ('rejects unsafe browser target %s', async url => { await expect(validateBrowserUrl(url)).rejects.toThrow(); });
});

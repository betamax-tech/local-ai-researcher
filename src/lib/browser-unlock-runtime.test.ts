import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserUnlockCoordinator, validateBrowserUrl } from './browser-unlock.js';
import type { BrowserUnlockConfig } from '../domain/types.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn(), lookup: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile, spawn: mocks.spawn }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
afterEach(() => vi.resetAllMocks());
const config: BrowserUnlockConfig = { cookies: 'auto', profile: 'Profile 1', command: 'brave-origin-stable',
  userDataDir: '/tmp/fake-browser', userAgent: 'UA', unlockWait: 1, impersonate: 'chrome131' };

it('calls python3 helper without shell, isolates stdout in memory and passes selected profile', async () => {
  mocks.execFile.mockImplementation((_file, _args, _opts, callback) => callback(null,
    JSON.stringify({ domain: 'example.com', cookies: [], clearance_created_at: null }), 'private stderr'));
  const coordinator = new BrowserUnlockCoordinator(config, async () => false, { validate: async () => {} });
  expect(await coordinator.read('https://example.com')).toMatchObject({ cookies: [] });
  const [executable, args, options] = mocks.execFile.mock.calls[0]!;
  expect(executable).toBe('python3');
  expect(args).toEqual([expect.stringMatching(/\/scripts\/browser_cookies.py$/), '--url', 'https://example.com']);
  expect(options.env).toMatchObject({ LOCAL_RESEARCHER_BROWSER_PROFILE: 'Profile 1', LOCAL_RESEARCHER_BROWSER_USER_DATA_DIR: '/tmp/fake-browser' });
  expect(options.shell).not.toBe(true); expect(options.timeout).toBe(10000);
});
it('suppresses raw helper exception, stderr and malformed output', async () => {
  const coordinator = new BrowserUnlockCoordinator(config, async () => false, { validate: async () => {} });
  mocks.execFile.mockImplementation((_file, _args, _opts, callback) => callback(new Error('raw credentials'), '', 'raw credentials'));
  expect(await coordinator.read('https://example.com')).toBeUndefined();
  mocks.execFile.mockImplementation((_file, _args, _opts, callback) => callback(null, 'malformed raw credentials', 'raw credentials'));
  expect(await coordinator.read('https://example.com')).toBeUndefined();
});
it('expands a configured home-relative root before passing it to helper or browser', async () => {
  let time = 100000;
  mocks.execFile.mockImplementation((_file, _args, _opts, callback) => callback(null,
    JSON.stringify({ domain: 'example.com', cookies: [], clearance_created_at: null }), ''));
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit('spawn')); return child;
  });
  const coordinator = new BrowserUnlockCoordinator({ ...config, userDataDir: '~/fake-browser' }, async () => false, {
    validate: async () => {}, now: () => time, sleep: async ms => { time += ms; },
  });
  await coordinator.unlock('https://example.com');
  expect(mocks.execFile.mock.calls[0]![2].env.LOCAL_RESEARCHER_BROWSER_USER_DATA_DIR).toBe(`${homedir()}/fake-browser`);
  expect(mocks.spawn.mock.calls[0]![1][0]).toBe(`--user-data-dir=${homedir()}/fake-browser`);
});
it('spawns detached Brave using individual argv and ignored stdio', async () => {
  let time = 100000;
  const data = { domain: 'example.com', cookies: [], clearance_created_at: null };
  mocks.execFile.mockImplementation((_file, _args, _opts, callback) => callback(null, JSON.stringify(data), ''));
  const unref = vi.fn();
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  const coordinator = new BrowserUnlockCoordinator(config, async () => false, {
    validate: async () => {}, now: () => time, sleep: async ms => { time += ms; },
  });
  expect((await coordinator.unlock('https://example.com/?q=$(touch%20/tmp/not-run)')).status).toBe('timeout');
  expect(mocks.spawn).toHaveBeenCalledWith('brave-origin-stable', [
    '--user-data-dir=/tmp/fake-browser', '--profile-directory=Profile 1', 'https://example.com/?q=$(touch%20/tmp/not-run)',
  ], { detached: true, stdio: 'ignore', shell: false });
  expect(unref).toHaveBeenCalledOnce();
});
it('validates all DNS answers, permits public dual-stack hosts and blocks private or special addresses', async () => {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  await expect(validateBrowserUrl('https://example.com')).resolves.toBeUndefined();
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }]);
  await expect(validateBrowserUrl('https://example.com')).resolves.toBeUndefined();
  for (const bad of [{ address: '10.0.0.1', family: 4 }, { address: '::1', family: 6 }, { address: '224.0.0.1', family: 4 },
    ...['fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::1'].map(address => ({ address, family: 6 }))]) {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, bad]);
    await expect(validateBrowserUrl('https://example.com')).rejects.toThrow();
  }
  mocks.lookup.mockRejectedValue(new Error('no DNS'));
  await expect(validateBrowserUrl('https://example.com')).rejects.toThrow();
});

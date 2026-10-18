import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';

const keys = ['COOKIES', 'USER_DATA_DIR', 'PROFILE', 'CMD', 'UA', 'UNLOCK_WAIT', 'IMPERSONATE'];
beforeEach(() => { for (const key of keys) { vi.stubEnv(`BROWSER_${key}`, undefined); vi.stubEnv(`LOCAL_RESEARCHER_BROWSER_${key}`, undefined); } });
afterEach(() => vi.unstubAllEnvs());
it('defaults fully off with specified Brave profile, executable, UA, timeout and impersonation', () => {
  expect(loadConfig().providers.scrapling.browser).toEqual({ cookies: 'off', userDataDir: undefined,
    profile: 'Profile 1', command: 'brave-origin-stable', unlockWait: 120, impersonate: 'chrome131',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' });
});
it('honors all prefixed overrides over legacy variables', () => {
  const values = ['auto', '/tmp/fake-profile', 'Default', '/usr/bin/brave-origin', 'custom UA', '30', 'chrome130'];
  keys.forEach((key, index) => vi.stubEnv(`LOCAL_RESEARCHER_BROWSER_${key}`, values[index]!));
  vi.stubEnv('BROWSER_COOKIES', 'off');
  expect(loadConfig().providers.scrapling.browser).toEqual({ cookies: 'auto', userDataDir: '/tmp/fake-profile',
    profile: 'Default', command: '/usr/bin/brave-origin', userAgent: 'custom UA', unlockWait: 30, impersonate: 'chrome130' });
});
it.each([['COOKIES', 'true'], ['PROFILE', '../profile'], ['PROFILE', '.'], ['CMD', 'brave; touch /tmp/test'],
  ['CMD', 'brave --flag'], ['CMD', '--flag'], ['UA', 'UA\r\nInjected: x'], ['UNLOCK_WAIT', '0'],
  ['UNLOCK_WAIT', '120x'], ['UNLOCK_WAIT', '3601'], ['IMPERSONATE', 'chrome131\n']])
('rejects invalid BROWSER_%s', (key, value) => {
  vi.stubEnv(`LOCAL_RESEARCHER_BROWSER_${key}`, value);
  expect(() => loadConfig()).toThrow();
});

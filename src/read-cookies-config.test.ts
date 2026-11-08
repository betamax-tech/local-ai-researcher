import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
afterEach(() => vi.unstubAllEnvs());
it('defaults reader cookies off, independently of browser unlock', () => {
  vi.stubEnv('READ_COOKIES', undefined); vi.stubEnv('LOCAL_RESEARCHER_READ_COOKIES', undefined);
  vi.stubEnv('LOCAL_RESEARCHER_BROWSER_COOKIES', 'auto');
  expect(loadConfig().providers.scrapling.readCookies?.source).toBe('off');
});
it('supports prefixed server file configuration and rejects missing files or invalid modes', () => {
  vi.stubEnv('READ_COOKIES', 'browser'); vi.stubEnv('LOCAL_RESEARCHER_READ_COOKIES', 'file');
  vi.stubEnv('LOCAL_RESEARCHER_READ_COOKIE_FILE', '/run/secrets/reader-cookies.json');
  expect(loadConfig().providers.scrapling.readCookies).toEqual({ source: 'file', file: '/run/secrets/reader-cookies.json' });
  vi.stubEnv('LOCAL_RESEARCHER_READ_COOKIE_FILE', '');
  expect(() => loadConfig()).toThrow('READ_COOKIE_FILE is required');
  vi.stubEnv('LOCAL_RESEARCHER_READ_COOKIES', 'auto');
  expect(() => loadConfig()).toThrow('READ_COOKIES must be');
});

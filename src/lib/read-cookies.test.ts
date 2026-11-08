import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCookieFile } from './read-cookies.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true }))); });
async function fixture(value: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'read-cookie-test-')); roots.push(root);
  const path = join(root, 'cookies.json');
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
const cookie = { name: 'session', value: 'synthetic-test-only', domain: 'example.com', path: '/', secure: true };

describe('server cookie file isolation', () => {
  it('accepts storage-state files, retaining metadata and only applicable cookies', async () => {
    const path = await fixture({ cookies: [cookie,
      { ...cookie, domain: 'other.test' }, { ...cookie, path: '/private' },
      { ...cookie, expires: 1 }, { ...cookie, name: 'parent', domain: '.example.com' }], origins: [] });
    const result = await readCookieFile(path, 'https://example.com/article');
    expect(result).toEqual([cookie, { ...cookie, name: 'parent', domain: '.example.com' }]);
    expect(await readCookieFile(path, 'https://example.com.attacker.test/article')).toEqual([]);
    expect(await readCookieFile(path, 'http://example.com/article')).toEqual([]);
  });
  it('accepts cookie arrays and Playwright session expiry -1', async () => {
    expect(await readCookieFile(await fixture([{ ...cookie, expires: -1 }]), 'https://example.com'))
      .toEqual([{ ...cookie, expires: -1 }]);
  });
  it('never promotes host-only cookies to subdomains', async () => {
    const path = await fixture([cookie]);
    expect(await readCookieFile(path, 'https://sub.example.com')).toEqual([]);
  });
  it('does not confuse cookie path prefixes or import partitioned cookies', async () => {
    const path = await fixture([{ ...cookie, path: '/app' }, { ...cookie, partitionKey: 'https://other.test' }]);
    expect(await readCookieFile(path, 'https://example.com/apple')).toEqual([]);
    expect(await readCookieFile(path, 'https://example.com/app/page')).toEqual([{ ...cookie, path: '/app' }]);
  });
  it('fails closed on invalid files without exposing cookie values or paths', async () => {
    for (const data of [{ session: 'synthetic-test-only' }, [{ name: 'session', value: 'synthetic-test-only' }]]) {
      await expect(readCookieFile(await fixture(data), 'https://example.com'))
        .rejects.toThrow(/^Reader cookie file unavailable or invalid\.$/);
    }
  });
  it('reloads rotated secrets and rejects oversized files', async () => {
    const path = await fixture([cookie]);
    expect((await readCookieFile(path, 'https://example.com'))[0]!.value).toBe(cookie.value);
    await writeFile(path, JSON.stringify([{ ...cookie, value: 'rotated-synthetic-only' }]));
    expect((await readCookieFile(path, 'https://example.com'))[0]!.value).toBe('rotated-synthetic-only');
    await writeFile(path, ' '.repeat(1024 * 1024 + 1));
    await expect(readCookieFile(path, 'https://example.com')).rejects.toThrow('Reader cookie file unavailable or invalid.');
  });
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';

const keys = ['SEARXNG_ENDPOINT', 'SEARXNG_ALLOW_PRIVATE_NETWORKS', 'SEARXNG_FALLBACK_1_ENDPOINT', 'SEARXNG_FALLBACK_2_ENDPOINT'];
beforeEach(() => {
  for (const key of keys) { vi.stubEnv(key, undefined); vi.stubEnv(`LOCAL_RESEARCHER_${key}`, undefined); }
});
afterEach(() => vi.unstubAllEnvs());
it('honors prefixed private-network opt-in and explicit opt-out over legacy settings', () => {
  vi.stubEnv('SEARXNG_ENDPOINT', 'http://100.90.81.5:8899');
  vi.stubEnv('SEARXNG_ALLOW_PRIVATE_NETWORKS', 'false');
  vi.stubEnv('LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS', 'true');
  expect(loadConfig().providers.searxng.allowPrivateNetworks).toBe(true);
  vi.stubEnv('SEARXNG_ENDPOINT', 'http://localhost:8080');
  vi.stubEnv('SEARXNG_ALLOW_PRIVATE_NETWORKS', 'true');
  vi.stubEnv('LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS', 'false');
  expect(loadConfig().providers.searxng.allowPrivateNetworks).toBe(false);
});
it.each(['http://localhost:8080', 'http://127.0.0.1:8080'])('permits explicitly configured loopback fallback %s', endpoint => {
  vi.stubEnv('SEARXNG_FALLBACK_1_ENDPOINT', endpoint);
  expect(loadConfig().providers.searxngFallbacks?.[0]?.allowPrivateNetworks).toBe(true);
});
it.each(['http://localhost.attacker.test:8080', 'http://127.0.0.1.attacker.test:8080', 'https://search.example.com'])
('does not grant private access to non-loopback provider %s', endpoint => {
  vi.stubEnv('SEARXNG_ENDPOINT', endpoint);
  vi.stubEnv('SEARXNG_FALLBACK_1_ENDPOINT', endpoint);
  expect(loadConfig().providers.searxng.allowPrivateNetworks).toBe(false);
  expect(loadConfig().providers.searxngFallbacks?.[0]?.allowPrivateNetworks).toBe(false);
});

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the actual entrypoint in an isolated package with fake Docker/curl/
// server processes. No daemon, network request, install, or MCP server is run.
function start(overrides: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'researcher-start-'));
  try {
    for (const dir of ['scripts', 'dist', 'bin']) mkdirSync(join(root, dir));
    copyFileSync(new URL('../scripts/start.sh', import.meta.url), join(root, 'scripts/start.sh'));
    writeFileSync(join(root, 'dist/index.js'), '');
    writeFileSync(join(root, 'bin/docker'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$1" = "info" ] && [ "${FAKE_DOCKER_UNAVAILABLE:-0}" = "1" ]; then exit 1; fi\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(root, 'bin/curl'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(root, 'bin/node'), '#!/bin/bash\nif [ "$1" = "-e" ]; then exec "$REAL_NODE" "$@"; fi\nexit 0\n', { mode: 0o755 });
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(LOCAL_RESEARCHER_)?(SCRAPLING|SEARXNG)_/.test(key)) delete env[key];
    }
    const log = join(root, 'calls');
    const result = spawnSync('bash', [join(root, 'scripts/start.sh')], {
      env: { ...env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CALL_LOG: log, REAL_NODE: process.execPath, ...overrides },
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return readFileSync(log, 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Scrapling startup ownership', () => {
  it('bootstraps loopback by default', () => {
    expect(start({})).toContain('--profile scrapling up -d scrapling');
  });

  describe.each(['LOCAL_RESEARCHER_', ''])('%s environment settings', (prefix) => {
    it.each(['http://100.100.10.20:8090', 'http://sidecar.example.test:8090', 'http://127.0.0.1.example.test:8090', 'http://127.0.0.1@remote.example.test:8090'])('does not bootstrap non-loopback %s', (endpoint) => {
      const calls = start({ [`${prefix}SCRAPLING_ENDPOINT`]: endpoint, [`${prefix}SCRAPLING_ENABLED`]: 'required' });
      expect(calls).not.toContain('--profile scrapling');
      expect(calls).toContain('up -d searxng');
    });
    it('honors bootstrap=false', () => {
      expect(start({ [`${prefix}SCRAPLING_BOOTSTRAP_WITH_DOCKER`]: 'false' })).not.toContain('--profile scrapling');
    });
    it('honors disabled mode', () => {
      expect(start({ [`${prefix}SCRAPLING_ENABLED`]: 'disabled' })).not.toContain('--profile scrapling');
    });
    it.each(['http://localhost:8090', 'http://127.1.2.3:8090', 'http://[::1]:8090'])('bootstraps loopback %s', (endpoint) => {
      expect(start({ [`${prefix}SCRAPLING_ENDPOINT`]: endpoint })).toContain('--profile scrapling');
    });
    it('does not require local Docker for a required remote sidecar', () => {
      expect(start({
        [`${prefix}SCRAPLING_ENDPOINT`]: 'http://100.100.10.20:8090',
        [`${prefix}SCRAPLING_ENABLED`]: 'required',
        FAKE_DOCKER_UNAVAILABLE: '1',
      })).not.toContain('--profile scrapling');
    });
  });

  it('prefers canonical settings over legacy values', () => {
    expect(start({
      LOCAL_RESEARCHER_SCRAPLING_ENDPOINT: 'http://100.100.10.20:8090',
      SCRAPLING_ENDPOINT: 'http://localhost:8090',
    })).not.toContain('--profile scrapling');
    expect(start({
      LOCAL_RESEARCHER_SCRAPLING_BOOTSTRAP_WITH_DOCKER: 'false',
      SCRAPLING_BOOTSTRAP_WITH_DOCKER: 'true',
    })).not.toContain('--profile scrapling');
  });
});

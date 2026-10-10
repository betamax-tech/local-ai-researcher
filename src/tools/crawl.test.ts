import { describe, it, expect, vi } from 'vitest';

import { createCrawlTools } from './crawl.js';
import { ValidationError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';

function logger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function setup(reply: unknown = { id: 'j1', state: 'queued' }) {
  const backend = { id: 'scrapling', name: 'Scrapling', crawl: vi.fn().mockResolvedValue(reply) };
  const tools = Object.fromEntries(createCrawlTools(backend, logger()).map((t) => [t.name, t]));
  return { backend, tools };
}

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0]!.text);

describe('crawl tools', () => {
  it('registers four tools with guidance for agents', () => {
    const { tools } = setup();
    expect(Object.keys(tools).sort()).toEqual(['crawl_control', 'crawl_results', 'crawl_start', 'crawl_status']);
    expect(tools.crawl_start!.description).toContain('crawl_status');
    expect(tools.crawl_status!.description).toContain('rate_limited');
  });

  it('crawl_start posts the job with defaults and returns the sidecar reply', async () => {
    const { backend, tools } = setup();
    const out = parse(await tools.crawl_start!.handler({ start_urls: ['https://example.com/'] }));
    expect(out.ok).toBe(true);
    expect(out.result.id).toBe('j1');
    const [method, path, body] = backend.crawl.mock.calls[0]!;
    expect([method, path]).toEqual(['POST', '/jobs']);
    expect(body).toMatchObject({ max_pages: 200, max_depth: 3, max_tier: 'stealth', extract: 'text' });
  });

  it('crawl_start refuses private-network start URLs', async () => {
    const { backend, tools } = setup();
    const out = parse(await tools.crawl_start!.handler({ start_urls: ['http://127.0.0.1:8090/'] }));
    expect(out.ok).toBe(false);
    expect(backend.crawl).not.toHaveBeenCalled();
  });

  it('status lists without id, controls and pages results by path', async () => {
    const { backend, tools } = setup({});
    await tools.crawl_status!.handler({});
    await tools.crawl_status!.handler({ job_id: 'abc-1' });
    await tools.crawl_control!.handler({ job_id: 'abc-1', action: 'pause' });
    await tools.crawl_results!.handler({ job_id: 'abc-1', cursor: 40 });
    expect(backend.crawl.mock.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      'GET /jobs', 'GET /jobs/abc-1', 'POST /jobs/abc-1/pause', 'GET /jobs/abc-1/results?cursor=40&limit=20',
    ]);
  });

  it('rejects path-injection job ids and surfaces sidecar errors', async () => {
    const { backend, tools } = setup();
    expect(parse(await tools.crawl_status!.handler({ job_id: '../hosts' })).ok).toBe(false);
    backend.crawl.mockRejectedValueOnce(new ValidationError('no such job: x', 'crawl'));
    const out = parse(await tools.crawl_status!.handler({ job_id: 'x' }));
    expect(out.ok).toBe(false);
    expect(out.error.message).toContain('no such job');
  });
});

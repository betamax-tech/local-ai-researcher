import { describe, expect, it, vi } from 'vitest';
import { ResilientReaderProvider } from './resilientReader.js';
import type { ReadResult, ScrapePageResult } from '../domain/types.js';
import { ReaderUnavailableError, SsrfError } from '../lib/errors.js';

const url = 'https://example.com/article';
const article = 'Useful article text. '.repeat(50);
const shell = 'Get responses tailored to you\n\nLog in to get answers based on saved chats, plus create images and upload files.';
function setup(content = article) {
  const primary = {
    id: 'jina-reader', name: 'Jina Reader', canRead: () => true,
    checkHealth: vi.fn(), read: vi.fn().mockResolvedValue({ url, content, excerpt: content,
      content_mode: 'full', content_truncated: false } satisfies ReadResult),
  };
  const browser = vi.fn().mockResolvedValue({ url, title: 'Article', content: article,
    excerpt: article, content_mode: 'full', content_truncated: false, mode_used: 'dynamic',
    access: { outcome: 'ok', tier: 'dynamic', tried: ['dynamic'], upstream_status: 200,
      retry_after_s: null, from_memory: false, next: null },
    records: [], sections: [], entity_type: 'generic', fields_requested: [],
  } satisfies ScrapePageResult);
  return { primary, browser, reader: new ResilientReaderProvider(primary, browser) };
}

describe('bounded reading fallback', () => {
  it('does not render an ordinary complete article', async () => {
    const { reader, browser } = setup();
    expect((await reader.read(url, {})).degraded).toBeFalsy();
    expect(browser).not.toHaveBeenCalled();
  });
  it('recovers the original twenty-word login shell', async () => {
    const { reader, browser } = setup(shell);
    const result = await reader.read(url, {});
    expect(browser).toHaveBeenCalledTimes(1);
    expect(result.reader_used).toBe('scrapling');
    expect(result.content).toBe(article);
    expect(result.degraded).toBe(false);
    expect(result.warnings?.join(' ')).toContain('login_shell');
  });
  it('verifies shared chats even when Jina returns a long but partial message', async () => {
    const { reader, browser } = setup();
    await reader.read('https://chatgpt.com/share/public-id', {});
    expect(browser).toHaveBeenCalledTimes(1);
  });
  it('does not mistake a different host or URL for a shared chat', async () => {
    const { reader, browser } = setup();
    await reader.read('https://chatgpt.com.attacker.test/share/public-id', {});
    expect(browser).not.toHaveBeenCalled();
  });
  it('preserves short-page uncertainty if rendering does not help', async () => {
    const { reader, browser } = setup('Hello world');
    browser.mockResolvedValueOnce({ ...(await browser()), content: 'Hello world' });
    browser.mockClear();
    const result = await reader.read(url, {});
    expect(result.content).toBe('Hello world');
    expect(result.degraded).toBe(true);
    expect(result.quality_reason).toBe('short_content');
    expect(browser).toHaveBeenCalledTimes(1);
  });
  it('does not return a login or rate-limit wall as the requested page', async () => {
    for (const outcome of ['auth_required', 'rate_limited', 'bot_challenge'] as const) {
      const { reader, browser } = setup(shell);
      const page = await browser();
      browser.mockResolvedValueOnce({ ...page, content: 'Access wall', access: { ...page.access, outcome } });
      browser.mockClear();
      const result = await reader.read(url, {});
      expect(result.degraded).toBe(true);
      expect(result.access?.outcome).toBe(outcome);
      expect(result.content).toBe('');
      expect(browser).toHaveBeenCalledTimes(1);
    }
  });
  it('does not escalate missing pages or rate limits', async () => {
    for (const status of [404, 410, 429]) {
      const { reader, primary, browser } = setup();
      primary.read.mockRejectedValueOnce(new ReaderUnavailableError('blocked', { status }));
      await expect(reader.read(url, {})).rejects.toThrow('blocked');
      expect(browser).not.toHaveBeenCalled();
    }
  });
  it('allows anonymous rendering after a primary authentication denial', async () => {
    for (const status of [401, 403]) {
      const { reader, primary, browser } = setup();
      primary.read.mockRejectedValueOnce(new ReaderUnavailableError('blocked', { status }));
      expect((await reader.read(url)).degraded).toBe(false);
      expect(browser).toHaveBeenCalledTimes(1);
    }
  });
  it('retries an access denial once with opt-in cookies, only after anonymous reading', async () => {
    for (const outcome of ['auth_required', 'forbidden', 'bot_challenge'] as const) {
      const { primary, browser } = setup(shell);
      const page = await browser(); browser.mockClear();
      browser.mockResolvedValueOnce({ ...page, access: { ...page.access!, outcome } });
      const authenticated = vi.fn().mockResolvedValue(page);
      const reader = new ResilientReaderProvider(primary, browser, authenticated);
      const result = await reader.read(url);
      expect(browser).toHaveBeenCalledTimes(1);
      expect(authenticated).toHaveBeenCalledTimes(1);
      expect(browser.mock.invocationCallOrder[0]).toBeLessThan(authenticated.mock.invocationCallOrder[0]!);
      expect(result.content).toBe(article);
      expect(result.authenticated).toBe(true);
      expect(result.degraded).toBe(false);
    }
  });
  it('never imports cookies after a rate limit or for a complete public page', async () => {
    const { primary, browser } = setup(shell);
    const page = await browser(); browser.mockClear();
    browser.mockResolvedValueOnce({ ...page, access: { ...page.access!, outcome: 'rate_limited' } });
    const authenticated = vi.fn();
    await new ResilientReaderProvider(primary, browser, authenticated).read(url);
    expect(authenticated).not.toHaveBeenCalled();
    primary.read.mockResolvedValueOnce({ url, content: article, excerpt: article, content_mode: 'full', content_truncated: false });
    await new ResilientReaderProvider(primary, browser, authenticated).read(url);
    expect(authenticated).not.toHaveBeenCalled();
  });
  it('reports persistent denial and sanitizes cookie-source failures', async () => {
    const { primary, browser } = setup(shell);
    const page = await browser(); browser.mockClear();
    const denied = { ...page, content: 'Private wall', access: { ...page.access!, outcome: 'auth_required' as const } };
    browser.mockResolvedValue(denied);
    const authenticated = vi.fn().mockResolvedValueOnce(denied);
    const reader = new ResilientReaderProvider(primary, browser, authenticated);
    const result = await reader.read(url);
    expect(result.degraded).toBe(true);
    expect(result.content).toBe('');
    expect(result.authenticated).toBe(true);
    authenticated.mockRejectedValueOnce(new Error('SECRET COOKIE VALUE'));
    const failed = await reader.read(url);
    expect(JSON.stringify(failed)).not.toContain('SECRET COOKIE VALUE');
    expect(failed.degraded).toBe(true);
  });
  it('does not start cookie import after the anonymous attempt exhausts the shared budget', async () => {
    const { primary, browser } = setup(shell);
    const page = await browser(); browser.mockClear();
    vi.useFakeTimers();
    try {
      browser.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 1000);
        return { ...page, access: { ...page.access!, outcome: 'auth_required' } };
      });
      const authenticated = vi.fn();
      const result = await new ResilientReaderProvider(primary, browser, authenticated).read(url, { timeoutMs: 500 });
      expect(result.degraded).toBe(true);
      expect(authenticated).not.toHaveBeenCalled();
      expect(result.warnings?.join(' ')).toContain('budget exhausted');
    } finally { vi.useRealTimers(); }
  });
  it('never retries an SSRF rejection through another provider', async () => {
    const { reader, primary, browser } = setup();
    primary.read.mockRejectedValueOnce(new SsrfError('blocked', url, 'private target'));
    await expect(reader.read(url, {})).rejects.toThrow(SsrfError);
    expect(browser).not.toHaveBeenCalled();
  });
  it('keeps incomplete primary content visibly degraded when the browser is unavailable', async () => {
    const { reader, browser } = setup(shell);
    browser.mockRejectedValueOnce(new Error('sidecar unavailable'));
    const result = await reader.read(url, {});
    expect(result.degraded).toBe(true);
    expect(result.warnings?.join(' ')).toContain('unavailable');
  });
  it('does not claim completeness for a shared chat when verification is unavailable', async () => {
    const { reader, browser } = setup();
    browser.mockRejectedValueOnce(new Error('offline'));
    expect((await reader.read('https://chatgpt.com/share/id', {})).degraded).toBe(true);
  });
  it('assesses the full result before applying a requested excerpt', async () => {
    const { reader } = setup();
    const result = await reader.read(url, { content_mode: 'excerpt', targetWords: 5, bypass_cache: true });
    expect(result.degraded).toBeFalsy();
    expect(result.content_truncated).toBe(true);
    expect(result.truncation?.applied_limit).toBe(5);
    expect(result.content?.split(/\s+/).length).toBe(5);
  });
  it('forwards cache bypass and a bounded remaining budget', async () => {
    const { reader, primary, browser } = setup(shell);
    await reader.read(url, { bypass_cache: true, timeoutMs: 1000 });
    expect(primary.read).toHaveBeenCalledWith(url, expect.objectContaining({ bypass_cache: true, timeoutMs: 1000 }));
    expect(browser).toHaveBeenCalledWith(url, expect.any(Number));
    expect(browser.mock.calls[0]![1]).toBeLessThanOrEqual(1000);
  });
  it('does not start browser work when the total budget is exhausted', async () => {
    vi.useFakeTimers();
    try {
      const { reader, primary, browser } = setup(shell);
      primary.read.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 2000);
        return { url, content: shell, excerpt: shell, content_mode: 'full', content_truncated: false };
      });
      const result = await reader.read(url, { timeoutMs: 1000 });
      expect(result.degraded).toBe(true);
      expect(browser).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

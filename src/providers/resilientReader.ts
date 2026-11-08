import type { ReadOptions, ReadResult, ScrapePageResult } from '../domain/types.js';
import { ResearcherError, SsrfError } from '../lib/errors.js';
import { needsConversationRendering, readQuality } from '../lib/read-quality.js';
import type { ReaderProvider } from './interfaces.js';

type BrowserRead = (url: string, timeoutMs: number) => Promise<ScrapePageResult>;

/** One total budget, at most one unauthenticated browser attempt, no daemon. */
export class ResilientReaderProvider implements ReaderProvider {
  readonly id = 'resilient-reader';
  readonly name = 'Jina Reader + headless fallback';

  constructor(private primary: ReaderProvider, private browserRead: BrowserRead) {}

  canRead(url: string): boolean { return this.primary.canRead(url); }
  checkHealth() { return this.primary.checkHealth(); }

  async read(url: string, options: ReadOptions = {}): Promise<ReadResult> {
    const started = Date.now();
    const budget = Math.max(1, Math.min(options.timeoutMs ?? 60000, 60000));
    let result: ReadResult;
    let reason: string | undefined;
    try {
      result = await this.primary.read(url, { ...options, content_mode: 'full', timeoutMs: budget });
      reason = result.quality_reason ?? readQuality(result.content ?? result.excerpt);
      if (result.degraded && !reason) reason = 'provider_degraded';
    } catch (error) {
      // A refusal is not an invitation to try another route to the same host.
      const status = error instanceof ResearcherError ? error.details?.status : undefined;
      if (error instanceof SsrfError || [401, 403, 404, 410, 429].includes(Number(status))) throw error;
      reason = 'reader_unavailable';
      result = { url, content: '', excerpt: '', content_mode: 'full', content_truncated: false };
    }

    const verifyChat = needsConversationRendering(url);
    const warnings = [...(result.warnings ?? [])];
    if (reason || verifyChat) {
      const cause = reason ?? 'shared_conversation_requires_rendering';
      warnings.push(`Primary extraction needs verification: ${cause}.`);
      const remaining = budget - (Date.now() - started);
      if (remaining > 0) {
        try {
          const page = await this.browserRead(url, remaining);
          const access = page.access;
          if (!access || access.outcome !== 'ok') {
            // Never feed access-wall prose into synthesis as if it were content.
            result = { url, title: page.title, content: '', excerpt: '', content_mode: 'full',
              content_truncated: false, access, reader_used: 'scrapling' };
            reason = access?.outcome ?? 'unverified_browser_access';
          } else {
            const content = page.content ?? page.excerpt;
            result = { url, title: page.title, content, excerpt: page.excerpt,
              content_mode: 'full', content_truncated: page.content_truncated,
              truncation: page.truncation, access, reader_used: 'scrapling' };
            reason = readQuality(content) ?? (page.degraded ? 'provider_degraded' : undefined);
          }
        } catch (error) {
          if (error instanceof SsrfError) throw error;
          warnings.push('Headless browser fallback unavailable; extraction remains unverified.');
          reason = reason ?? 'unverified_conversation';
        }
      } else {
        warnings.push('Read budget exhausted before browser fallback.');
        reason = reason ?? 'unverified_conversation';
      }
    }

    const full = result.content ?? result.excerpt;
    result = { ...result, wordCount: full.trim() ? full.trim().split(/\s+/).length : 0,
      degraded: reason !== undefined, quality_reason: reason,
      warnings: warnings.length ? warnings : undefined, duration: Date.now() - started };
    // Quality is evaluated on full content, never on the caller's small excerpt.
    if (options.content_mode === 'excerpt') {
      const words = full.trim() ? full.trim().split(/\s+/) : [];
      const limit = options.targetWords ?? 120;
      const content = words.length > limit ? words.slice(0, limit).join(' ') + '...' : full;
      return { ...result, content, excerpt: content, content_mode: 'excerpt',
        content_truncated: result.content_truncated || words.length > limit,
        truncation: words.length > limit ? { applied_limit: limit, reason: 'explicit_excerpt' } : result.truncation };
    }
    return result;
  }
}

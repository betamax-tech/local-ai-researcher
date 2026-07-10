import type {
  ExtractOptions,
  FetchAuthOptions,
  ExtractResult,
  ScraplingConfig,
  ScrapePageOptions,
  ScrapePageResult,
  ScrapeListingOptions,
  ScrapeListingResult,
} from '../domain/types.js';
import type { ProviderHealth, ScrapeProvider } from './interfaces.js';
import { HttpClient } from '../lib/http.js';
import {
  ExtractInvalidResponseError,
  ExtractTimeoutError,
  ExtractUnavailableError,
  ErrorCode,
  TimeoutError,
} from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import { validateSsrf } from '../lib/ssrf.js';

const LOCAL_NETWORKS = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

interface SidecarHealthResponse {
  status: 'connected' | 'degraded' | 'unavailable' | 'error';
  detected_version?: string;
  runtime?: string;
  error?: string;
  error_code?: string;
}

interface SidecarPageResponse {
  url: string;
  title?: string;
  mode_used: 'static' | 'dynamic' | 'stealth';
  selector?: string;
  goal?: string;
  excerpt: string;
  content?: string;
  sections: Array<{ label: string; text: string }>;
  records: Array<{
    index: number;
    title?: string;
    url?: string;
    text: string;
    attributes?: Record<string, string>;
    field_candidates?: Record<string, string>;
  }>;
  field_candidates?: Record<string, string>;
  wordCount?: number;
  degraded?: boolean;
  duration?: number;
}

interface SidecarListingResponse {
  url: string;
  mode_used: 'static' | 'dynamic' | 'stealth';
  item_selector?: string;
  records: Array<{
    index: number;
    title?: string;
    url?: string;
    text: string;
    attributes?: Record<string, string>;
    field_candidates?: Record<string, string>;
  }>;
  duration?: number;
}

export class ScraplingProvider implements ScrapeProvider {
  private config: ScraplingConfig;
  private httpClient: HttpClient;
  private logger: Logger;

  constructor(config: ScraplingConfig, httpClient: HttpClient, logger: Logger) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger;
  }

  get id(): string {
    return 'scrapling';
  }

  get name(): string {
    return 'Scrapling';
  }

  canExtract(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private get sidecarAllowedNetworks(): string[] {
    return [...LOCAL_NETWORKS];
  }

  private get targetAllowedNetworks(): string[] {
    return this.config.allowPrivateNetworks ? [...LOCAL_NETWORKS] : [];
  }

  private ensureEnabled(): void {
    if (this.config.enabled === 'disabled') {
      throw new ExtractUnavailableError('Scrapling scraping lane is disabled');
    }
  }

  /**
   * Resolve per-request auth/egress fields for the sidecar request body.
   * - cookies/headers are passed through as-is.
   * - proxy resolution: `direct: true` forces NO proxy (pins to the sidecar's
   *   own IP, e.g. to keep a cookie'd session on one consistent IP); otherwise
   *   an explicit `options.proxy` wins, else the configured default proxy.
   */
  private buildAuthFields(options: FetchAuthOptions): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (options.cookies) fields.cookies = options.cookies;
    if (options.headers) fields.headers = options.headers;
    if (!options.direct) {
      const proxy = options.proxy ?? this.config.defaultProxy;
      if (proxy) fields.proxy = proxy;
    }
    return fields;
  }

  async checkHealth(): Promise<ProviderHealth> {
    if (this.config.enabled === 'disabled') {
      return {
        status: 'unavailable',
        latency_ms: 0,
        error: 'Scrapling scraping lane disabled',
        error_code: ErrorCode.ERR_EXTRACT_UNAVAILABLE,
      };
    }

    const startTime = Date.now();
    try {
      const response = await this.httpClient.get(`${this.config.endpoint}/health`, {
        timeout: Math.min(this.config.timeout, 10000),
        retry: false,
        ssrfAllowedNetworks: this.sidecarAllowedNetworks,
      });
      const payload = response.body as SidecarHealthResponse;
      return {
        status: payload.status,
        latency_ms: Date.now() - startTime,
        error: payload.error,
        error_code: payload.error_code,
        detected_version: payload.detected_version,
        runtime: payload.runtime,
      };
    } catch (error) {
      const latency_ms = Date.now() - startTime;
      if (error instanceof TimeoutError) {
        return {
          status: 'unavailable',
          latency_ms,
          error: error.message,
          error_code: ErrorCode.ERR_EXTRACT_TIMEOUT,
        };
      }
      return {
        status: this.config.enabled === 'required' ? 'error' : 'unavailable',
        latency_ms,
        error: error instanceof Error ? error.message : 'Scrapling health failed',
        error_code: ErrorCode.ERR_EXTRACT_UNAVAILABLE,
      };
    }
  }

  async scrapePage(url: string, options: ScrapePageOptions = {}): Promise<ScrapePageResult> {
    await validateSsrf(url, this.targetAllowedNetworks);
    this.ensureEnabled();

    const mode = options.mode ?? this.config.defaultMode;
    const contentMode = options.content_mode ?? 'full';

    try {
      const response = await this.httpClient.post(
        `${this.config.endpoint}/scrape-page`,
        {
          url,
          mode,
          selector: options.selector,
          goal: options.goal,
          entity_type: options.entity_type ?? 'generic',
          fields: options.fields ?? [],
          maxRecords: options.maxRecords,
          ...this.buildAuthFields(options),
        },
        {
          timeout: this.config.timeout,
          retry: false,
          ssrfAllowedNetworks: this.sidecarAllowedNetworks,
        }
      );

      const payload = response.body as SidecarPageResponse;
      if (!payload || typeof payload.excerpt !== 'string' || !Array.isArray(payload.sections) || !Array.isArray(payload.records)) {
        throw new ExtractInvalidResponseError('Scrapling sidecar returned an invalid page payload');
      }

      const fullContent = payload.content ?? payload.excerpt;
      const wordCount = payload.wordCount ?? (fullContent.trim() ? fullContent.trim().split(/\s+/).length : 0);

      if (contentMode === 'excerpt') {
        const words = fullContent.trim() ? fullContent.trim().split(/\s+/) : [];
        const appliedLimit = options.targetWords ?? 120;
        const excerptContent = words.length > appliedLimit
          ? `${words.slice(0, appliedLimit).join(' ')}...`
          : fullContent;

        return {
          url: payload.url,
          title: payload.title,
          entity_type: options.entity_type ?? 'generic',
          goal: options.goal,
          fields_requested: options.fields ?? [],
          mode_used: payload.mode_used,
          excerpt: excerptContent,
          content: excerptContent,
          content_mode: 'excerpt',
          content_truncated: words.length > appliedLimit,
          truncation: words.length > appliedLimit ? { applied_limit: appliedLimit, reason: 'explicit_excerpt' } : undefined,
          sections: payload.sections,
          records: payload.records,
          field_candidates: payload.field_candidates,
          wordCount,
          degraded: payload.degraded ?? wordCount < 20,
          duration: payload.duration,
        };
      }

      return {
        url: payload.url,
        title: payload.title,
        entity_type: options.entity_type ?? 'generic',
        goal: options.goal,
        fields_requested: options.fields ?? [],
        mode_used: payload.mode_used,
        excerpt: payload.excerpt,
        content: fullContent,
        content_mode: 'full',
        content_truncated: false,
        sections: payload.sections,
        records: payload.records,
        field_candidates: payload.field_candidates,
        wordCount,
        degraded: payload.degraded ?? wordCount < 20,
        duration: payload.duration,
      };
    } catch (error) {
      this.logger.warn('Scrapling page scrape failed', {
        component: 'ScraplingProvider',
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      if (error instanceof ExtractInvalidResponseError) throw error;
      if (error instanceof TimeoutError) {
        throw new ExtractTimeoutError('Scrapling page scrape timed out', { url, timeout: this.config.timeout });
      }
      if (error instanceof SyntaxError) {
        throw new ExtractInvalidResponseError('Scrapling sidecar returned malformed JSON', { url });
      }
      throw new ExtractUnavailableError(error instanceof Error ? error.message : 'Scrapling page scrape failed', { url });
    }
  }

  async scrapeListing(url: string, options: ScrapeListingOptions = {}): Promise<ScrapeListingResult> {
    await validateSsrf(url, this.targetAllowedNetworks);
    this.ensureEnabled();
    const mode = options.mode ?? this.config.defaultMode;

    try {
      const response = await this.httpClient.post(
        `${this.config.endpoint}/scrape-listing`,
        {
          url,
          mode,
          goal: options.goal,
          entity_type: options.entity_type ?? 'generic',
          fields: options.fields ?? [],
          item_selector: options.item_selector,
          maxItems: options.maxItems,
          ...this.buildAuthFields(options),
        },
        {
          timeout: this.config.timeout,
          retry: false,
          ssrfAllowedNetworks: this.sidecarAllowedNetworks,
        }
      );

      const payload = response.body as SidecarListingResponse;
      if (!payload || !Array.isArray(payload.records)) {
        throw new ExtractInvalidResponseError('Scrapling sidecar returned an invalid listing payload');
      }

      return {
        url: payload.url,
        entity_type: options.entity_type ?? 'generic',
        goal: options.goal,
        fields_requested: options.fields ?? [],
        item_selector: payload.item_selector,
        records: payload.records,
        item_count: payload.records.length,
        mode_used: payload.mode_used,
        duration: payload.duration,
      };
    } catch (error) {
      this.logger.warn('Scrapling listing scrape failed', {
        component: 'ScraplingProvider',
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      if (error instanceof ExtractInvalidResponseError) throw error;
      if (error instanceof TimeoutError) {
        throw new ExtractTimeoutError('Scrapling listing scrape timed out', { url, timeout: this.config.timeout });
      }
      if (error instanceof SyntaxError) {
        throw new ExtractInvalidResponseError('Scrapling sidecar returned malformed JSON', { url });
      }
      throw new ExtractUnavailableError(error instanceof Error ? error.message : 'Scrapling listing scrape failed', { url });
    }
  }

  async extract(url: string, options: ExtractOptions = {}): Promise<ExtractResult> {
    const page = await this.scrapePage(url, {
      goal: options.goal,
      selector: options.selector,
      mode: options.mode,
      content_mode: options.content_mode,
      targetWords: options.targetWords,
      maxRecords: options.maxRecords,
      entity_type: 'generic',
      fields: [],
      // forward auth/egress controls
      cookies: options.cookies,
      headers: options.headers,
      proxy: options.proxy,
      direct: options.direct,
    });

    return {
      url: page.url,
      title: page.title,
      mode_requested: options.mode ?? this.config.defaultMode,
      mode_used: page.mode_used,
      selector: options.selector,
      goal: options.goal,
      excerpt: page.excerpt,
      content: page.content,
      content_mode: page.content_mode,
      content_truncated: page.content_truncated,
      truncation: page.truncation,
      sections: page.sections,
      records: page.records,
      wordCount: page.wordCount,
      degraded: page.degraded,
      duration: page.duration,
    };
  }
}

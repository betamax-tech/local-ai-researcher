import type { ExtractOptions, ExtractResult, ScraplingConfig } from '../domain/types.js';
import type { ExtractProvider, ProviderHealth } from './interfaces.js';
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

interface SidecarExtractResponse {
  url: string;
  title?: string;
  mode_used: 'static' | 'dynamic';
  selector?: string;
  goal?: string;
  excerpt: string;
  content?: string;
  sections: Array<{ label: string; text: string }>;
  records: Array<{ index: number; text: string; attributes?: Record<string, string> }>;
  wordCount?: number;
  degraded?: boolean;
  duration?: number;
}

export class ScraplingProvider implements ExtractProvider {
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

  async checkHealth(): Promise<ProviderHealth> {
    if (this.config.enabled === 'disabled') {
      return {
        status: 'unavailable',
        latency_ms: 0,
        error: 'Scrapling extraction lane disabled',
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

  async extract(url: string, options: ExtractOptions = {}): Promise<ExtractResult> {
    await validateSsrf(url, this.targetAllowedNetworks);

    if (this.config.enabled === 'disabled') {
      throw new ExtractUnavailableError('Scrapling extraction lane is disabled');
    }

    const mode = options.mode ?? this.config.defaultMode;

    try {
      const response = await this.httpClient.post(
        `${this.config.endpoint}/extract`,
        {
          url,
          mode,
          selector: options.selector,
          goal: options.goal,
          maxRecords: options.maxRecords,
        },
        {
          timeout: this.config.timeout,
          retry: false,
          ssrfAllowedNetworks: this.sidecarAllowedNetworks,
        }
      );

      const payload = response.body as SidecarExtractResponse;
      if (!payload || typeof payload.excerpt !== 'string' || !Array.isArray(payload.sections) || !Array.isArray(payload.records)) {
        throw new ExtractInvalidResponseError('Scrapling sidecar returned an invalid payload');
      }

      const fullContent = payload.content ?? payload.excerpt;
      const wordCount = payload.wordCount ?? (fullContent.trim() ? fullContent.trim().split(/\s+/).length : 0);
      const contentMode = options.content_mode ?? 'full';

      if (contentMode === 'excerpt') {
        const words = fullContent.trim() ? fullContent.trim().split(/\s+/) : [];
        const appliedLimit = options.targetWords ?? 120;
        const excerptContent = words.length > appliedLimit
          ? `${words.slice(0, appliedLimit).join(' ')}...`
          : fullContent;

        return {
          url: payload.url,
          title: payload.title,
          mode_requested: mode,
          mode_used: payload.mode_used,
          selector: payload.selector,
          goal: payload.goal,
          excerpt: excerptContent,
          content: excerptContent,
          content_mode: 'excerpt',
          content_truncated: words.length > appliedLimit,
          truncation: words.length > appliedLimit
            ? { applied_limit: appliedLimit, reason: 'explicit_excerpt' }
            : undefined,
          sections: payload.sections,
          records: payload.records,
          wordCount,
          degraded: payload.degraded ?? wordCount < 20,
          duration: payload.duration,
        };
      }

      return {
        url: payload.url,
        title: payload.title,
        mode_requested: mode,
        mode_used: payload.mode_used,
        selector: payload.selector,
        goal: payload.goal,
        excerpt: payload.excerpt,
        content: fullContent,
        content_mode: 'full',
        content_truncated: false,
        sections: payload.sections,
        records: payload.records,
        wordCount,
        degraded: payload.degraded ?? wordCount < 20,
        duration: payload.duration,
      };
    } catch (error) {
      this.logger.warn('Scrapling sidecar request failed', {
        component: 'ScraplingProvider',
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof ExtractInvalidResponseError) throw error;
      if (error instanceof TimeoutError) {
        throw new ExtractTimeoutError('Scrapling extraction timed out', {
          url,
          timeout: this.config.timeout,
        });
      }

      if (error instanceof SyntaxError) {
        throw new ExtractInvalidResponseError('Scrapling sidecar returned malformed JSON', { url });
      }

      throw new ExtractUnavailableError(
        error instanceof Error ? error.message : 'Scrapling extraction failed',
        { url }
      );
    }
  }
}

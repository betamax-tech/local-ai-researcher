import { execFile } from 'child_process';

import type { ExtractOptions, ExtractResult, ScraplingConfig } from '../domain/types.js';
import type { ExtractProvider, ProviderHealth } from './interfaces.js';
import {
  ExtractInvalidResponseError,
  ExtractTimeoutError,
  ExtractUnavailableError,
} from '../lib/errors.js';
import { ErrorCode, TimeoutError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import { validateSsrf } from '../lib/ssrf.js';

export interface ScraplingExecutorResult {
  stdout: string;
  stderr: string;
}

export type ScraplingExecutor = (params: {
  command: string;
  scriptPath: string;
  input: string;
  timeoutMs: number;
}) => Promise<ScraplingExecutorResult>;

function defaultExecutor(params: {
  command: string;
  scriptPath: string;
  input: string;
  timeoutMs: number;
}): Promise<ScraplingExecutorResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      params.command,
      [params.scriptPath],
      { timeout: params.timeoutMs, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }

        resolve({ stdout, stderr });
      }
    );

    if (child.stdin) {
      child.stdin.write(params.input);
      child.stdin.end();
    }
  });
}

interface BridgeHealthResponse {
  status: 'connected' | 'degraded' | 'unavailable' | 'error';
  detected_version?: string;
  runtime?: string;
  error?: string;
  error_code?: string;
}

interface BridgeExtractResponse {
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
  private logger: Logger;
  private executor: ScraplingExecutor;

  constructor(
    config: ScraplingConfig,
    logger: Logger,
    executor: ScraplingExecutor = defaultExecutor
  ) {
    this.config = config;
    this.logger = logger;
    this.executor = executor;
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

  async checkHealth(): Promise<ProviderHealth> {
    if (!this.config.enabled) {
      return {
        status: 'unavailable',
        latency_ms: 0,
        error: 'Scrapling extraction lane disabled',
        error_code: ErrorCode.ERR_EXTRACT_UNAVAILABLE,
      };
    }

    const startTime = Date.now();

    try {
      const { stdout } = await this.executor({
        command: this.config.command,
        scriptPath: this.config.scriptPath,
        input: JSON.stringify({ action: 'health' }),
        timeoutMs: Math.min(this.config.timeout, 10000),
      });

      const payload = JSON.parse(stdout) as BridgeHealthResponse;
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
      if (error instanceof TimeoutError || (error as { killed?: boolean }).killed) {
        return {
          status: 'unavailable',
          latency_ms,
          error: error instanceof Error ? error.message : 'Scrapling health timed out',
          error_code: ErrorCode.ERR_EXTRACT_TIMEOUT,
        };
      }

      return {
        status: 'unavailable',
        latency_ms,
        error: error instanceof Error ? error.message : 'Scrapling health failed',
        error_code: ErrorCode.ERR_EXTRACT_UNAVAILABLE,
      };
    }
  }

  async extract(url: string, options: ExtractOptions = {}): Promise<ExtractResult> {
    const allowedNetworks = this.config.allowPrivateNetworks
      ? ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
      : [];

    await validateSsrf(url, allowedNetworks);

    if (!this.config.enabled) {
      throw new ExtractUnavailableError('Scrapling extraction lane is disabled');
    }

    const mode = options.mode ?? this.config.defaultMode;

    try {
      const { stdout, stderr } = await this.executor({
        command: this.config.command,
        scriptPath: this.config.scriptPath,
        input: JSON.stringify({
          action: 'extract',
          url,
          mode,
          selector: options.selector,
          goal: options.goal,
          maxRecords: options.maxRecords,
        }),
        timeoutMs: this.config.timeout,
      });

      if (stderr.trim()) {
        this.logger.warn('Scrapling bridge stderr output', {
          component: 'ScraplingProvider',
          stderr,
        });
      }

      const payload = JSON.parse(stdout) as BridgeExtractResponse;
      if (!payload || typeof payload.excerpt !== 'string' || !Array.isArray(payload.sections) || !Array.isArray(payload.records)) {
        throw new ExtractInvalidResponseError('Scrapling bridge returned an invalid payload');
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
      if (error instanceof ExtractInvalidResponseError) {
        throw error;
      }

      if (error instanceof TimeoutError || (error as { killed?: boolean }).killed) {
        throw new ExtractTimeoutError('Scrapling extraction timed out', {
          url,
          timeout: this.config.timeout,
        });
      }

      if (error instanceof SyntaxError) {
        throw new ExtractInvalidResponseError('Scrapling bridge returned malformed JSON', { url });
      }

      throw new ExtractUnavailableError(
        error instanceof Error ? error.message : 'Scrapling extraction failed',
        { url }
      );
    }
  }
}

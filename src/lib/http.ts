/**
 * HTTP client with retry logic, SSRF protection, and safe redirect following.
 *
 * Safety properties:
 * - Every request URL is validated by validateSsrf() before fetch.
 * - Redirects are followed manually so each redirect URL is also SSRF-validated.
 * - Timeout is enforced via Promise.race so it fires even when the underlying
 *   fetch implementation does not respect AbortSignal (e.g. in unit tests).
 */

import type { HttpConfig } from '../domain/types.js';
import { HttpError, TimeoutError } from './errors.js';
import { validateSsrf } from './ssrf.js';

/** Maximum number of redirects to follow before throwing */
const MAX_REDIRECTS = 5;

/** HTTP response */
export interface HttpResponse {
  /** HTTP status code */
  status: number;

  /** Response headers */
  headers: Record<string, string>;

  /** Response body (parsed as JSON if possible) */
  body: unknown;

  /** Raw text body */
  text: string;

  /** Request duration in milliseconds */
  duration: number;
}

/** HTTP request options */
export interface RequestOptions {
  /** Request timeout in milliseconds (default: from config) */
  timeout?: number;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Enable/disable retries (default: true) */
  retry?: boolean;

  /** Max retry attempts (default: from config) */
  maxRetries?: number;

  /** Request ID for tracing (optional) */
  requestId?: string;

  /** SSRF allowed networks (default: from config) */
  ssrfAllowedNetworks?: string[];
}

/** HTTP client class */
export class HttpClient {
  private config: HttpConfig;

  constructor(config: HttpConfig) {
    this.config = config;
  }

  /**
   * Perform GET request
   * @param url - Target URL (must pass SSRF check)
   * @param options - Request options
   * @returns HTTP response
   */
  async get(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.request('GET', url, undefined, options);
  }

  /**
   * Perform POST request
   * @param url - Target URL (must pass SSRF check)
   * @param body - Request body
   * @param options - Request options
   * @returns HTTP response
   */
  async post(url: string, body: unknown, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.request('POST', url, body, options);
  }

  /**
   * Perform HTTP request with retry logic
   */
  private async request(
    method: string,
    url: string,
    body: unknown,
    options: RequestOptions
  ): Promise<HttpResponse> {
    const allowedNetworks = options.ssrfAllowedNetworks ?? this.config.ssrfAllowedNetworks;

    // Validate the initial URL for SSRF
    await validateSsrf(url, allowedNetworks);

    // Merge options with defaults
    const timeout = options.timeout ?? this.config.timeout;
    const shouldRetry = options.retry ?? true;
    const maxRetries = options.maxRetries ?? this.config.maxRetries;

    // Attempt request with retries
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeRequest(method, url, body, timeout, options.headers, allowedNetworks);
      } catch (error) {
        lastError = error as Error;

        // Don't retry if disabled or on last attempt
        if (!shouldRetry || attempt === maxRetries) {
          break;
        }

        // Calculate retry delay (exponential backoff)
        const delay = Math.min(
          this.config.retryDelay * Math.pow(2, attempt),
          this.config.maxRetryDelay
        );

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // All retries failed
    throw lastError;
  }

  /**
   * Execute a single HTTP request, following redirects manually so each
   * redirect URL is SSRF-validated before following.
   *
   * The entire operation (including redirect chain) is bounded by `timeout`.
   * We use Promise.race so the timeout fires even if the underlying fetch
   * mock does not respect the AbortSignal.
   */
  private async executeRequest(
    method: string,
    currentUrl: string,
    body: unknown,
    timeout: number,
    headers?: Record<string, string>,
    allowedNetworks: string[] = []
  ): Promise<HttpResponse> {
    const startTime = Date.now();

    // Build a timeout promise that rejects after `timeout` ms.
    // This is separate from the AbortController so that test mocks that ignore
    // AbortSignal still experience the timeout.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new TimeoutError(
          `Request to ${currentUrl} timed out after ${timeout}ms`,
          method,
          timeout
        ));
      }, timeout);
    });

    try {
      return await Promise.race([
        this._followRedirects(method, currentUrl, body, headers, allowedNetworks, startTime, timeout),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Internal: follow redirects manually, validating each redirect URL.
   */
  private async _followRedirects(
    method: string,
    startUrl: string,
    body: unknown,
    headers: Record<string, string> | undefined,
    allowedNetworks: string[],
    startTime: number,
    timeout: number
  ): Promise<HttpResponse> {
    let currentUrl = startUrl;
    let redirectCount = 0;
    const controller = new AbortController();

    // Schedule abort via the controller (for fetch implementations that respect it)
    const abortHandle = setTimeout(() => controller.abort(), timeout);

    try {
      while (true) {
        const response = await fetch(currentUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          redirect: 'manual', // We handle redirects ourselves
        });

        // Handle redirects
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('Location');
          if (!location) {
            throw new HttpError(
              `HTTP redirect with no Location header: ${response.status}`,
              response.status,
              currentUrl,
            );
          }

          // Resolve relative redirect URLs
          const redirectUrl = new URL(location, currentUrl).toString();

          // SSRF-validate the redirect target BEFORE following it
          await validateSsrf(redirectUrl, allowedNetworks);

          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            throw new HttpError(
              `Too many redirects (max ${MAX_REDIRECTS})`,
              response.status,
              currentUrl,
            );
          }

          // For redirects, switch to GET per HTTP spec (303) or preserve method (307/308)
          if (response.status === 303) {
            method = 'GET';
            body = undefined;
          }

          currentUrl = redirectUrl;
          continue;
        }

        const text = await response.text();
        let parsedBody: unknown = text;

        // Try to parse as JSON
        try {
          parsedBody = JSON.parse(text);
        } catch {
          // Not JSON, keep as text
        }

        const duration = Date.now() - startTime;

        // Check for HTTP errors
        if (!response.ok) {
          throw new HttpError(
            `HTTP request failed: ${response.status} ${response.statusText}`,
            response.status,
            currentUrl,
            { duration }
          );
        }

        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: parsedBody,
          text,
          duration,
        };
      }
    } catch (error) {
      // Translate AbortError to TimeoutError
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError(
          `Request to ${startUrl} timed out after ${timeout}ms`,
          method,
          timeout
        );
      }
      throw error;
    } finally {
      clearTimeout(abortHandle);
    }
  }
}

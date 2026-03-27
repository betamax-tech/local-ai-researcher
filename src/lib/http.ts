/**
 * HTTP client with retry logic and SSRF protection
 */

import type { HttpConfig } from '../domain/types.js';
import { HttpError, TimeoutError } from './errors.js';
import { validateSsrf } from './ssrf.js';

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
   * @param method - HTTP method
   * @param url - Target URL
   * @param body - Request body (optional)
   * @param options - Request options
   * @returns HTTP response
   */
  private async request(
    method: string,
    url: string,
    body: unknown,
    options: RequestOptions
  ): Promise<HttpResponse> {
    // Validate SSRF
    await validateSsrf(url, options.ssrfAllowedNetworks ?? this.config.ssrfAllowedNetworks);

    // Merge options with defaults
    const timeout = options.timeout ?? this.config.timeout;
    const shouldRetry = options.retry ?? true;
    const maxRetries = options.maxRetries ?? this.config.maxRetries;

    // Attempt request with retries
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeRequest(method, url, body, timeout, options.headers);
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
   * Execute single HTTP request
   * @param method - HTTP method
   * @param url - Target URL
   * @param body - Request body
   * @param timeout - Request timeout
   * @param headers - Custom headers
   * @returns HTTP response
   */
  private async executeRequest(
    method: string,
    url: string,
    body: unknown,
    timeout: number,
    headers?: Record<string, string>
  ): Promise<HttpResponse> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
          url,
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
    } catch (error) {
      clearTimeout(timeoutId);

      // Check for timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError(
          `Request to ${url} timed out after ${timeout}ms`,
          method,
          timeout
        );
      }

      throw error;
    }
  }
}

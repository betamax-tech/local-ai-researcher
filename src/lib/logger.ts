/**
 * Stderr-only logger for Local Researcher with secret redaction
 */

import type { LoggingConfig } from '../domain/types.js';

export interface LogMeta {
  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /** Request ID (for correlation) */
  requestId?: string;

  /** Component/module name */
  component?: string;

  /** Additional context */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Redaction constants
// ---------------------------------------------------------------------------

/** Header names (lowercase) whose values should be fully redacted */
const REDACTED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
  'proxy-authorization',
]);

/** Query-parameter names whose values should be fully redacted */
const REDACTED_QUERY_PARAMS: ReadonlyArray<string> = [
  'api_key',
  'apikey',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'password',
  'passwd',
];

/** Object-key patterns (case-insensitive substring) that trigger redaction */
const REDACTED_KEY_PATTERNS: ReadonlyArray<string> = [
  'apikey',
  'api_key',
  'apitoken',
  'token',
  'password',
  'passwd',
  'secret',
  'credential',
  'auth',
  'authorization',
  'access_token',
  'refresh_token',
];

/** Maximum number of characters for a logged string value before truncation */
const MAX_CONTENT_CHARS = 512;

const REDACTED = '[REDACTED]';

// ---------------------------------------------------------------------------
// Redaction helpers
// ---------------------------------------------------------------------------

/**
 * Decide whether an object key should have its value redacted.
 */
function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEY_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Scrub sensitive query parameters from a URL string, replacing their values
 * with the REDACTED placeholder.
 *
 * We use regex replacement rather than URL.searchParams to avoid
 * URL-encoding the `[REDACTED]` marker (which would produce `%5BREDACTED%5D`).
 */
function redactUrl(urlString: string): string {
  // Quick bailout — no query string at all
  if (!urlString.includes('?')) {
    return urlString;
  }

  let result = urlString;
  for (const param of REDACTED_QUERY_PARAMS) {
    // Match: param=<value> where value ends at & or end-of-string/fragment
    const pattern = new RegExp(
      `([?&]${param}=)[^&#]*`,
      'gi'
    );
    result = result.replace(pattern, `$1${REDACTED}`);
  }
  return result;
}

/**
 * Recursively walk a value, redacting secret keys and truncating long strings.
 */
function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 10) {
    return value; // Guard against pathological nesting
  }

  if (typeof value === 'string') {
    // Truncate long strings
    if (value.length > MAX_CONTENT_CHARS) {
      return `${value.slice(0, MAX_CONTENT_CHARS)}...[truncated ${value.length - MAX_CONTENT_CHARS} more chars]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        result[key] = REDACTED;
      } else if (key === 'headers' && val !== null && typeof val === 'object') {
        // Special-case headers: redact by header name
        result[key] = redactHeaders(val as Record<string, unknown>);
      } else if (key === 'url' && typeof val === 'string') {
        // Special-case URLs: redact sensitive query params
        result[key] = redactUrl(val);
      } else {
        result[key] = redactValue(val, depth + 1);
      }
    }
    return result;
  }

  return value;
}

/**
 * Redact known sensitive headers in a headers map.
 */
function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (REDACTED_HEADERS.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Deep-redact a LogMeta object before serialization.
 */
function redactMeta(meta: LogMeta): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isSecretKey(key)) {
      result[key] = REDACTED;
    } else if (key === 'headers' && value !== null && typeof value === 'object') {
      result[key] = redactHeaders(value as Record<string, unknown>);
    } else if (key === 'url' && typeof value === 'string') {
      result[key] = redactUrl(value);
    } else {
      result[key] = redactValue(value);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export class Logger {
  private config: LoggingConfig;

  constructor(config: LoggingConfig) {
    this.config = config;
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  private format(level: string, message: string, meta: LogMeta = {}): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Redact secrets before building the log entry
    const safeMetaEntries = redactMeta(meta);

    const entry: Record<string, unknown> = {
      level,
      message,
      ...safeMetaEntries,
    };

    if (this.config.timestamp) {
      entry.timestamp = new Date().toISOString();
    }

    if (meta.component) {
      entry.component = meta.component;
    }

    if (this.config.json) {
      // JSON format for structured logging
      console.error(JSON.stringify(entry));
    } else {
      // Human-readable format
      const parts: string[] = [level.toUpperCase(), message];
      if (meta.component) {
        parts.push(`[${meta.component}]`);
      }
      console.error(parts.join(' '));
    }
  }

  debug(message: string, meta?: LogMeta): void {
    this.format('debug', message, meta);
  }

  info(message: string, meta?: LogMeta): void {
    this.format('info', message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.format('warn', message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.format('error', message, meta);
  }
}

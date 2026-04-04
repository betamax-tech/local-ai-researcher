/**
 * Configuration loading and validation — locked v1 contract.
 *
 * Environment variable convention: LOCAL_RESEARCHER_* prefix for all settings.
 * Legacy bare names (SEARXNG_ENDPOINT, etc.) are also supported for migration.
 *
 * Logging: all validation errors go to stderr; config parsing must not write
 * to stdout (MCP stdio protocol uses stdout exclusively).
 */

import type { Config } from './domain/types.js';
import { ConfigError, ValidationError } from './lib/errors.js';

// ---------------------------------------------------------------------------
// Locked v1 defaults
// ---------------------------------------------------------------------------

/**
 * Locked v1 defaults — sourced from PRD "Configuration" section.
 * Changing these constitutes a breaking contract change.
 */
const DEFAULTS = {
  // SearxNG
  SEARXNG_ENDPOINT: 'http://localhost:8080',
  SEARXNG_TIMEOUT: '10000',
  SEARXNG_ALLOW_PRIVATE_NETWORKS: 'false',
  SEARXNG_API_KEY: '',

  // Jina Reader — locked v1: base URL without trailing path segment
  JINA_READER_ENDPOINT: 'https://r.jina.ai/',
  JINA_READER_TIMEOUT: '15000',
  JINA_READER_API_KEY: '',

  // HTTP layer
  HTTP_TIMEOUT: '30000',
  HTTP_MAX_RETRIES: '2',
  HTTP_RETRY_DELAY: '500',
  HTTP_MAX_RETRY_DELAY: '5000',

  // SSRF allowlist (comma-separated CIDR)
  SSRF_ALLOWED_NETWORKS: '',

  // Logging (stderr only — stdout reserved for MCP protocol)
  LOG_LEVEL: 'info',
  LOG_JSON: 'true',
  LOG_TIMESTAMP: 'true',

  // Search defaults (locked v1: limit=5)
  SEARCH_DEFAULT_LIMIT: '5',
  SEARCH_DEFAULT_SOURCES: 'web',

  // Gather defaults
  GATHER_STRATEGY: 'parallel',
  GATHER_DEDUP_ENABLED: 'true',
  GATHER_TIMEOUT: '10000',

  // Content policy defaults
  CONTENT_DEFAULT_MODE: 'full',

  // MCP defaults
  MCP_TIMEOUT: '5000',
  MCP_RETRIES: '2',

  // Cache defaults (opt-in, disabled by default)
  CACHE_ENABLED: 'false',
  CACHE_PATH: './cache.db',
  CACHE_TTL: '3600',

  // Fallback SearXNG (optional — empty string = disabled)
  // NOTE: Legacy single fallback is deprecated in favor of chained fallbacks
  SEARXNG_FALLBACK_ENDPOINT: '',
  SEARXNG_FALLBACK_API_KEY: '',

  // Chained fallback SearXNG instances (optional — empty string = disabled)
  SEARXNG_FALLBACK_1_ENDPOINT: 'https://searx.party/',
  SEARXNG_FALLBACK_1_API_KEY: '',
  SEARXNG_FALLBACK_2_ENDPOINT: 'https://search.sapti.me/',
  SEARXNG_FALLBACK_2_API_KEY: '',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve env variable — checks LOCAL_RESEARCHER_<KEY> first, then bare <KEY>,
 * then falls back to compiled default. This gives operators control without
 * requiring legacy env var names to change.
 */
function getEnv(key: keyof typeof DEFAULTS): string {
  const prefixed = process.env[`LOCAL_RESEARCHER_${key}`];
  if (prefixed !== undefined) return prefixed;
  const bare = process.env[key];
  if (bare !== undefined) return bare;
  return DEFAULTS[key];
}

function parseBool(value: string, key: string): boolean {
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  throw new ValidationError(`Expected boolean for ${key}, got: ${value}`, key, value);
}

function parsePositiveInt(value: string, key: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new ValidationError(`Expected positive integer for ${key}, got: ${value}`, key, value);
  }
  return num;
}

function parseNonNegativeInt(value: string, key: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    throw new ValidationError(`Expected non-negative integer for ${key}, got: ${value}`, key, value);
  }
  return num;
}

function parseLogLevel(value: string): 'debug' | 'info' | 'warn' | 'error' {
  const valid = ['debug', 'info', 'warn', 'error'] as const;
  if (valid.includes(value as 'debug')) {
    return value as 'debug' | 'info' | 'warn' | 'error';
  }
  throw new ValidationError(`Invalid LOG_LEVEL: ${value}. Must be one of: ${valid.join(', ')}`, 'LOG_LEVEL', value);
}

function parseGatherStrategy(value: string): 'parallel' | 'sequential' {
  if (value === 'parallel' || value === 'sequential') return value;
  throw new ValidationError(
    `Invalid GATHER_STRATEGY: ${value}. Must be 'parallel' or 'sequential'`,
    'GATHER_STRATEGY',
    value
  );
}

function parseSources(value: string): Array<'web' | 'local' | 'custom'> {
  if (!value.trim()) return ['web'];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      if (s === 'web' || s === 'local' || s === 'custom') return s;
      throw new ValidationError(`Invalid source type: ${s}. Must be web, local, or custom`, 'SEARCH_DEFAULT_SOURCES', s);
    });
}

function parseContentMode(value: string): 'full' | 'excerpt' {
  if (value === 'full' || value === 'excerpt') return value;
  throw new ValidationError(
    `Invalid CONTENT_DEFAULT_MODE: ${value}. Must be 'full' or 'excerpt'`,
    'CONTENT_DEFAULT_MODE',
    value
  );
}

function parseCidrList(value: string, key: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(cidr => {
      const parts = cidr.split('/');
      if (parts.length !== 2) {
        throw new ValidationError(`Invalid CIDR notation in ${key}: ${cidr}`, key, cidr);
      }
      const prefix = parseInt(parts[1] ?? '', 10);
      if (isNaN(prefix) || prefix < 0 || prefix > 128) {
        throw new ValidationError(`Invalid CIDR prefix in ${key}: ${prefix}`, key, cidr);
      }
      return cidr;
    });
}

function validateUrl(value: string, key: string): void {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new ConfigError(`${key} must use http or https, got: ${u.protocol}`, { key, value });
    }
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`${key} is not a valid URL: ${value}`, { key, value });
  }
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Load and validate application configuration from environment variables.
 *
 * All logging from this function must go to stderr.
 * Throws ConfigError or ValidationError on invalid configuration.
 *
 * @returns Validated Config object
 */
export function loadConfig(): Config {
  const searxngEndpoint = getEnv('SEARXNG_ENDPOINT');
  validateUrl(searxngEndpoint, 'SEARXNG_ENDPOINT');

  const jinaReaderEndpoint = getEnv('JINA_READER_ENDPOINT');
  validateUrl(jinaReaderEndpoint, 'JINA_READER_ENDPOINT');

  const searxngTimeout = parsePositiveInt(getEnv('SEARXNG_TIMEOUT'), 'SEARXNG_TIMEOUT');
  const jinaReaderTimeout = parsePositiveInt(getEnv('JINA_READER_TIMEOUT'), 'JINA_READER_TIMEOUT');
  const httpTimeout = parsePositiveInt(getEnv('HTTP_TIMEOUT'), 'HTTP_TIMEOUT');
  const httpMaxRetries = parseNonNegativeInt(getEnv('HTTP_MAX_RETRIES'), 'HTTP_MAX_RETRIES');
  const httpRetryDelay = parseNonNegativeInt(getEnv('HTTP_RETRY_DELAY'), 'HTTP_RETRY_DELAY');
  const httpMaxRetryDelay = parseNonNegativeInt(getEnv('HTTP_MAX_RETRY_DELAY'), 'HTTP_MAX_RETRY_DELAY');

  if (httpMaxRetryDelay < httpRetryDelay) {
    throw new ValidationError(
      'HTTP_MAX_RETRY_DELAY must be >= HTTP_RETRY_DELAY',
      'HTTP_MAX_RETRY_DELAY',
      httpMaxRetryDelay
    );
  }

  const mcpTimeout = parsePositiveInt(getEnv('MCP_TIMEOUT'), 'MCP_TIMEOUT');
  const mcpRetries = parseNonNegativeInt(getEnv('MCP_RETRIES'), 'MCP_RETRIES');
  const searchDefaultLimit = parsePositiveInt(getEnv('SEARCH_DEFAULT_LIMIT'), 'SEARCH_DEFAULT_LIMIT');
  const gatherTimeout = parsePositiveInt(getEnv('GATHER_TIMEOUT'), 'GATHER_TIMEOUT');
  const contentDefaultMode = parseContentMode(getEnv('CONTENT_DEFAULT_MODE'));

  // Build chained fallbacks array from FALLBACK_1 and FALLBACK_2 env vars
  const searxngFallbacks: Array<{ endpoint: string; timeout: number; allowPrivateNetworks: boolean; apiKey?: string }> = [];
  
  const fallback1Endpoint = getEnv('SEARXNG_FALLBACK_1_ENDPOINT');
  if (fallback1Endpoint) {
    validateUrl(fallback1Endpoint, 'SEARXNG_FALLBACK_1_ENDPOINT');
    searxngFallbacks.push({
      endpoint: fallback1Endpoint,
      timeout: searxngTimeout,
      allowPrivateNetworks: false, // Remote instances — no private network access
      apiKey: getEnv('SEARXNG_FALLBACK_1_API_KEY') || undefined,
    });
  }

  const fallback2Endpoint = getEnv('SEARXNG_FALLBACK_2_ENDPOINT');
  if (fallback2Endpoint) {
    validateUrl(fallback2Endpoint, 'SEARXNG_FALLBACK_2_ENDPOINT');
    searxngFallbacks.push({
      endpoint: fallback2Endpoint,
      timeout: searxngTimeout,
      allowPrivateNetworks: false, // Remote instances — no private network access
      apiKey: getEnv('SEARXNG_FALLBACK_2_API_KEY') || undefined,
    });
  }

  const config: Config = {
    providers: {
      searxng: {
        endpoint: searxngEndpoint,
        timeout: searxngTimeout,
        // Auto-enable private networks when endpoint is localhost — operator
        // configured a local SearXNG, so private access is intentional.
        // Explicit SEARXNG_ALLOW_PRIVATE_NETWORKS env var overrides this default.
        allowPrivateNetworks: process.env['SEARXNG_ALLOW_PRIVATE_NETWORKS'] !== undefined
          ? parseBool(getEnv('SEARXNG_ALLOW_PRIVATE_NETWORKS'), 'SEARXNG_ALLOW_PRIVATE_NETWORKS')
          : /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|::1)(:\d+)?/i.test(searxngEndpoint),
        apiKey: getEnv('SEARXNG_API_KEY') || undefined,
      },
      jinaReader: {
        endpoint: jinaReaderEndpoint,
        timeout: jinaReaderTimeout,
        apiKey: getEnv('JINA_READER_API_KEY') || undefined,
      },
      // Chained fallback SearXNG instances — only present when any FALLBACK_N_ENDPOINT is set
      ...(searxngFallbacks.length > 0
        ? {
            searxngFallbacks,
          }
        : {}),
    },
    http: {
      timeout: httpTimeout,
      maxRetries: httpMaxRetries,
      retryDelay: httpRetryDelay,
      maxRetryDelay: httpMaxRetryDelay,
      ssrfAllowedNetworks: parseCidrList(getEnv('SSRF_ALLOWED_NETWORKS'), 'SSRF_ALLOWED_NETWORKS'),
    },
    logging: {
      level: parseLogLevel(getEnv('LOG_LEVEL')),
      json: parseBool(getEnv('LOG_JSON'), 'LOG_JSON'),
      timestamp: parseBool(getEnv('LOG_TIMESTAMP'), 'LOG_TIMESTAMP'),
    },
    search: {
      defaultLimit: searchDefaultLimit,
      sources: parseSources(getEnv('SEARCH_DEFAULT_SOURCES')),
    },
    gather: {
      strategy: parseGatherStrategy(getEnv('GATHER_STRATEGY')),
      dedupEnabled: parseBool(getEnv('GATHER_DEDUP_ENABLED'), 'GATHER_DEDUP_ENABLED'),
      timeout: gatherTimeout,
    },
    contentPolicy: {
      defaultMode: contentDefaultMode,
    },
    mcp: {
      timeout: mcpTimeout,
      retries: mcpRetries,
    },
    cache: {
      enabled: parseBool(getEnv('CACHE_ENABLED'), 'CACHE_ENABLED'),
      path: getEnv('CACHE_PATH'),
      ttl: parsePositiveInt(getEnv('CACHE_TTL'), 'CACHE_TTL'),
    },
  };

  return config;
}

/**
 * Tests for error taxonomy — locked v1 contract.
 *
 * Tests verify:
 * 1. Error codes are defined and stable
 * 2. Error classes have correct codes
 * 3. Retryable flags are set correctly per PRD taxonomy
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  ResearcherError,
  SsrfError,
  SearxngTimeoutError,
  SearxngUnavailableError,
  SearxngInvalidResponseError,
  ReaderTimeoutError,
  ReaderUnavailableError,
  ReaderInvalidResponseError,
  SearchTimeoutError,
  SearchSourceUnavailableError,
  SearchMalformedQueryError,
  InvalidEnginesError,
  GatherNoSourcesError,
  GatherTimeoutError,
  GatherPartialError,
  ReadNotFoundError,
  ReadPermissionDeniedError,
  ReadEncodingError,
  HealthCheckFailedError,
  ValidationError,
  ConfigError,
  ProviderError,
  TimeoutError,
  HttpError,
} from './errors.js';

describe('ErrorCode constants', () => {
  it('defines all locked v1 error codes', () => {
    const expectedCodes = [
      'ERR_SEARXNG_TIMEOUT',
      'ERR_SEARXNG_UNAVAILABLE',
      'ERR_SEARXNG_INVALID_RESPONSE',
      'ERR_READER_TIMEOUT',
      'ERR_READER_UNAVAILABLE',
      'ERR_READER_INVALID_RESPONSE',
      'ERR_SSRF_BLOCKED',
      'ERR_INVALID_ENGINES',
      'ERR_SEARCH_MALFORMED_QUERY',
      'ERR_SEARCH_SOURCE_UNAVAILABLE',
      'ERR_SEARCH_TIMEOUT',
      'ERR_READ_NOT_FOUND',
      'ERR_READ_PERMISSION_DENIED',
      'ERR_READ_ENCODING_ERROR',
      'ERR_GATHER_NO_SOURCES',
      'ERR_GATHER_TIMEOUT',
      'ERR_GATHER_PARTIAL',
      'ERR_HEALTH_CHECK_FAILED',
      'ERR_VALIDATION',
      'ERR_CONFIG',
    ];

    for (const code of expectedCodes) {
      expect(ErrorCode).toHaveProperty(code);
      expect((ErrorCode as Record<string, string>)[code]).toBe(code);
    }
  });

  it('error codes are string literals matching their keys', () => {
    expect(ErrorCode.ERR_SEARXNG_TIMEOUT).toBe('ERR_SEARXNG_TIMEOUT');
    expect(ErrorCode.ERR_SSRF_BLOCKED).toBe('ERR_SSRF_BLOCKED');
    expect(ErrorCode.ERR_VALIDATION).toBe('ERR_VALIDATION');
  });
});

describe('ResearcherError (base class)', () => {
  it('sets code, message, and retryable flag', () => {
    const error = new ResearcherError('Test error', ErrorCode.ERR_VALIDATION, {
      retryable: true,
      details: { foo: 'bar' },
    });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('ERR_VALIDATION');
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ foo: 'bar' });
  });

  it('defaults retryable to false', () => {
    const error = new ResearcherError('Test', ErrorCode.ERR_VALIDATION);
    expect(error.retryable).toBe(false);
  });

  it('is an instance of Error', () => {
    const error = new ResearcherError('Test', ErrorCode.ERR_VALIDATION);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ResearcherError');
  });
});

// ---------------------------------------------------------------------------
// SSRF Errors
// ---------------------------------------------------------------------------

describe('SsrfError', () => {
  it('has code ERR_SSRF_BLOCKED and is not retryable', () => {
    const error = new SsrfError('Blocked', 'https://internal.local', 'private network');
    expect(error.code).toBe('ERR_SSRF_BLOCKED');
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ url: 'https://internal.local', reason: 'private network' });
  });
});

// ---------------------------------------------------------------------------
// SearxNG Provider Errors
// ---------------------------------------------------------------------------

describe('SearxngTimeoutError', () => {
  it('has code ERR_SEARXNG_TIMEOUT and is retryable', () => {
    const error = new SearxngTimeoutError('Timeout', { duration: 5000 });
    expect(error.code).toBe('ERR_SEARXNG_TIMEOUT');
    expect(error.retryable).toBe(true);
  });
});

describe('SearxngUnavailableError', () => {
  it('has code ERR_SEARXNG_UNAVAILABLE and is retryable', () => {
    const error = new SearxngUnavailableError('Unavailable');
    expect(error.code).toBe('ERR_SEARXNG_UNAVAILABLE');
    expect(error.retryable).toBe(true);
  });
});

describe('SearxngInvalidResponseError', () => {
  it('has code ERR_SEARXNG_INVALID_RESPONSE and is NOT retryable', () => {
    const error = new SearxngInvalidResponseError('Invalid JSON');
    expect(error.code).toBe('ERR_SEARXNG_INVALID_RESPONSE');
    expect(error.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Jina Reader Provider Errors
// ---------------------------------------------------------------------------

describe('ReaderTimeoutError', () => {
  it('has code ERR_READER_TIMEOUT and is retryable', () => {
    const error = new ReaderTimeoutError('Reader timeout');
    expect(error.code).toBe('ERR_READER_TIMEOUT');
    expect(error.retryable).toBe(true);
  });
});

describe('ReaderUnavailableError', () => {
  it('has code ERR_READER_UNAVAILABLE and is retryable', () => {
    const error = new ReaderUnavailableError('Reader unavailable');
    expect(error.code).toBe('ERR_READER_UNAVAILABLE');
    expect(error.retryable).toBe(true);
  });
});

describe('ReaderInvalidResponseError', () => {
  it('has code ERR_READER_INVALID_RESPONSE and is NOT retryable', () => {
    const error = new ReaderInvalidResponseError('Bad response');
    expect(error.code).toBe('ERR_READER_INVALID_RESPONSE');
    expect(error.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Search Tool Errors
// ---------------------------------------------------------------------------

describe('SearchTimeoutError', () => {
  it('has code ERR_SEARCH_TIMEOUT and is retryable', () => {
    const error = new SearchTimeoutError('Search timed out');
    expect(error.code).toBe('ERR_SEARCH_TIMEOUT');
    expect(error.retryable).toBe(true);
  });
});

describe('SearchSourceUnavailableError', () => {
  it('has code ERR_SEARCH_SOURCE_UNAVAILABLE and is retryable', () => {
    const error = new SearchSourceUnavailableError('Source down');
    expect(error.code).toBe('ERR_SEARCH_SOURCE_UNAVAILABLE');
    expect(error.retryable).toBe(true);
  });
});

describe('SearchMalformedQueryError', () => {
  it('has code ERR_SEARCH_MALFORMED_QUERY and is NOT retryable', () => {
    const error = new SearchMalformedQueryError('Bad query');
    expect(error.code).toBe('ERR_SEARCH_MALFORMED_QUERY');
    expect(error.retryable).toBe(false);
  });
});

describe('InvalidEnginesError', () => {
  it('has code ERR_INVALID_ENGINES and is NOT retryable', () => {
    const error = new InvalidEnginesError('Invalid engines', ['foo', 'bar']);
    expect(error.code).toBe('ERR_INVALID_ENGINES');
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ engines: ['foo', 'bar'] });
  });
});

// ---------------------------------------------------------------------------
// Gather Tool Errors
// ---------------------------------------------------------------------------

describe('GatherNoSourcesError', () => {
  it('has code ERR_GATHER_NO_SOURCES and is NOT retryable', () => {
    const error = new GatherNoSourcesError('No sources');
    expect(error.code).toBe('ERR_GATHER_NO_SOURCES');
    expect(error.retryable).toBe(false);
  });
});

describe('GatherTimeoutError', () => {
  it('has code ERR_GATHER_TIMEOUT and is retryable', () => {
    const error = new GatherTimeoutError('Gather timed out');
    expect(error.code).toBe('ERR_GATHER_TIMEOUT');
    expect(error.retryable).toBe(true);
  });
});

describe('GatherPartialError', () => {
  it('has code ERR_GATHER_PARTIAL and is retryable', () => {
    const error = new GatherPartialError('Partial results');
    expect(error.code).toBe('ERR_GATHER_PARTIAL');
    expect(error.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Read Tool Errors
// ---------------------------------------------------------------------------

describe('ReadNotFoundError', () => {
  it('has code ERR_READ_NOT_FOUND and is NOT retryable', () => {
    const error = new ReadNotFoundError('File not found', '/path/to/file');
    expect(error.code).toBe('ERR_READ_NOT_FOUND');
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ path: '/path/to/file' });
  });
});

describe('ReadPermissionDeniedError', () => {
  it('has code ERR_READ_PERMISSION_DENIED and is NOT retryable', () => {
    const error = new ReadPermissionDeniedError('Permission denied');
    expect(error.code).toBe('ERR_READ_PERMISSION_DENIED');
    expect(error.retryable).toBe(false);
  });
});

describe('ReadEncodingError', () => {
  it('has code ERR_READ_ENCODING_ERROR and is NOT retryable', () => {
    const error = new ReadEncodingError('Encoding error');
    expect(error.code).toBe('ERR_READ_ENCODING_ERROR');
    expect(error.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Health Check Errors
// ---------------------------------------------------------------------------

describe('HealthCheckFailedError', () => {
  it('has code ERR_HEALTH_CHECK_FAILED and is retryable', () => {
    const error = new HealthCheckFailedError('Health check failed');
    expect(error.code).toBe('ERR_HEALTH_CHECK_FAILED');
    expect(error.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// General / Config Errors
// ---------------------------------------------------------------------------

describe('ValidationError', () => {
  it('has code ERR_VALIDATION and is NOT retryable', () => {
    const error = new ValidationError('Invalid input', 'field', 'value');
    expect(error.code).toBe('ERR_VALIDATION');
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ field: 'field', value: 'value' });
  });
});

describe('ConfigError', () => {
  it('has code ERR_CONFIG and is NOT retryable', () => {
    const error = new ConfigError('Config error', { key: 'missing' });
    expect(error.code).toBe('ERR_CONFIG');
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ key: 'missing' });
  });
});

// ---------------------------------------------------------------------------
// Legacy Aliases (deprecated but tested for backward compat)
// ---------------------------------------------------------------------------

describe('ProviderError (deprecated)', () => {
  it('has code ERR_SEARXNG_UNAVAILABLE and is retryable', () => {
    const error = new ProviderError('Provider error', 'searxng');
    expect(error.code).toBe('ERR_SEARXNG_UNAVAILABLE');
    expect(error.retryable).toBe(true);
    expect(error.details?.provider).toBe('searxng');
  });
});

describe('TimeoutError (deprecated)', () => {
  it('has code ERR_SEARXNG_TIMEOUT and is retryable', () => {
    const error = new TimeoutError('Timeout', 'search', 5000);
    expect(error.code).toBe('ERR_SEARXNG_TIMEOUT');
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ operation: 'search', timeout: 5000 });
  });
});

describe('HttpError (deprecated)', () => {
  it('has code ERR_VALIDATION and is NOT retryable', () => {
    const error = new HttpError('HTTP error', 404, 'https://example.com');
    expect(error.code).toBe('ERR_VALIDATION');
    expect(error.retryable).toBe(false);
    expect(error.details?.status).toBe(404);
    expect(error.details?.url).toBe('https://example.com');
  });
});

// ---------------------------------------------------------------------------
// Retryable Taxonomy Summary Test
// ---------------------------------------------------------------------------

describe('Retryable taxonomy (PRD contract)', () => {
  it('TIMEOUT errors are retryable', () => {
    expect(new SearxngTimeoutError('').retryable).toBe(true);
    expect(new ReaderTimeoutError('').retryable).toBe(true);
    expect(new SearchTimeoutError('').retryable).toBe(true);
    expect(new GatherTimeoutError('').retryable).toBe(true);
  });

  it('UNAVAILABLE errors are retryable', () => {
    expect(new SearxngUnavailableError('').retryable).toBe(true);
    expect(new ReaderUnavailableError('').retryable).toBe(true);
    expect(new SearchSourceUnavailableError('').retryable).toBe(true);
  });

  it('INVALID_RESPONSE errors are NOT retryable', () => {
    expect(new SearxngInvalidResponseError('').retryable).toBe(false);
    expect(new ReaderInvalidResponseError('').retryable).toBe(false);
  });

  it('VALIDATION errors are NOT retryable', () => {
    expect(new ValidationError('').retryable).toBe(false);
    expect(new SearchMalformedQueryError('').retryable).toBe(false);
    expect(new InvalidEnginesError('').retryable).toBe(false);
  });

  it('SSRF errors are NOT retryable', () => {
    expect(new SsrfError('', '', '').retryable).toBe(false);
  });

  it('PARTIAL results are retryable (retry with fewer sources)', () => {
    expect(new GatherPartialError('').retryable).toBe(true);
  });

  it('NOT_FOUND errors are NOT retryable', () => {
    expect(new ReadNotFoundError('').retryable).toBe(false);
    expect(new GatherNoSourcesError('').retryable).toBe(false);
  });
});

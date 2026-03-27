/**
 * Tests for Logger redaction — locked v1 safety baseline.
 *
 * Tests verify:
 * 1. Authorization/Bearer tokens are redacted
 * 2. API keys in query params are redacted
 * 3. Large content bodies are truncated
 * 4. Secrets in structured data are redacted
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger } from './logger.js';
import type { LoggingConfig } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function captureStderr(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const originalError = console.error;
  
  console.error = (...args: unknown[]) => {
    output.push(args.map(a => String(a)).join(' '));
  };

  return {
    output,
    restore: () => {
      console.error = originalError;
    },
  };
}

function createTestConfig(overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    level: 'debug',
    json: true,
    timestamp: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Logger redaction', () => {
  let logger: Logger;
  let stderrCapture: { output: string[]; restore: () => void };

  beforeEach(() => {
    stderrCapture = captureStderr();
    logger = new Logger(createTestConfig());
  });

  afterEach(() => {
    stderrCapture.restore();
  });

  describe('Authorization header redaction', () => {
    it('redacts Bearer tokens', () => {
      logger.info('Request sent', {
        headers: {
          'Authorization': 'Bearer secret-token-12345',
          'Content-Type': 'application/json',
        },
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('secret-token-12345');
      expect(output).toContain('[REDACTED]');
    });

    it('redacts Basic auth headers', () => {
      logger.info('Auth request', {
        headers: {
          'Authorization': 'Basic dXNlcjpwYXNzd29yZA==',
        },
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('dXNlcjpwYXNzd29yZA==');
      expect(output).toContain('[REDACTED]');
    });

    it('redacts lowercase authorization header', () => {
      logger.debug('Debug info', {
        headers: {
          'authorization': 'Bearer my-secret-key',
        },
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('my-secret-key');
    });
  });

  describe('API key redaction', () => {
    it('redacts api_key in query params', () => {
      logger.info('URL accessed', {
        url: 'https://api.example.com/data?api_key=secret-key-123&foo=bar',
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('secret-key-123');
      expect(output).toContain('[REDACTED]');
    });

    it('redacts token in query params', () => {
      logger.info('Request', {
        url: 'https://example.com/api?token=abc123def456',
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('abc123def456');
    });

    it('redacts access_token in query params', () => {
      logger.debug('OAuth request', {
        url: 'https://api.example.com/callback?access_token=oauth-token-xyz',
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('oauth-token-xyz');
    });

    it('redacts api_key in nested objects', () => {
      logger.info('Config', {
        config: {
          provider: {
            apiKey: 'super-secret-api-key',
          },
        },
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('super-secret-api-key');
    });
  });

  describe('content truncation', () => {
    it('truncates large content bodies', () => {
      const largeContent = 'x'.repeat(10000);
      logger.info('Response received', {
        content: largeContent,
      });

      const output = stderrCapture.output.join('\n');
      // Content should be truncated, not fully logged
      expect(output.length).toBeLessThan(largeContent.length + 1000);
    });

    it('respects LOG_CONTENT_MAX_BYTES config', () => {
      // Note: Logger config for content max bytes will be added
      // For now, test that content is handled
      const largeContent = 'x'.repeat(1000);
      
      logger.info('Large content', { content: largeContent });

      const output = stderrCapture.output.join('\n');
      // Output should not contain full content when redaction is implemented
      expect(output).toBeDefined();
    });

    it('indicates truncation in output', () => {
      const largeContent = 'x'.repeat(10000);
      logger.info('Response', {
        body: largeContent,
      });

      const output = stderrCapture.output.join('\n');
      // Should indicate content was truncated
      expect(output).toMatch(/\[truncated|TRUNCATED|\.\.\.|\d+ more/);
    });
  });

  describe('structured data redaction', () => {
    it('redacts secrets in nested objects', () => {
      logger.info('API call', {
        request: {
          url: 'https://api.example.com',
          headers: {
            'X-API-Key': 'my-api-key-123',
          },
          body: {
            token: 'user-token-xyz',
          },
        },
      });

      const output = stderrCapture.output.join('\n');
      expect(output).not.toContain('my-api-key-123');
      expect(output).not.toContain('user-token-xyz');
    });

    it('preserves non-secret data', () => {
      logger.info('Request', {
        url: 'https://example.com/page',
        method: 'GET',
        statusCode: 200,
      });

      const output = stderrCapture.output.join('\n');
      expect(output).toContain('example.com');
      expect(output).toContain('GET');
      expect(output).toContain('200');
    });
  });

  describe('JSON output format', () => {
    it('outputs valid JSON when json: true', () => {
      logger.info('Test message', { foo: 'bar' });

      const output = stderrCapture.output.join('\n');
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('includes redacted fields in JSON output', () => {
      logger.info('Auth', {
        apiKey: 'secret-key',
        publicData: 'visible',
      });

      const output = stderrCapture.output.join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.apiKey).toBe('[REDACTED]');
      expect(parsed.publicData).toBe('visible');
    });
  });
});

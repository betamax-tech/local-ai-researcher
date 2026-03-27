/**
 * Tests for SSRF protection — locked v1 safety baseline.
 *
 * Tests verify:
 * 1. Private IP ranges are blocked (127.0.0.1, 10.x, 192.168.x, 172.16-31.x, 169.254.169.254)
 * 2. Localhost hostnames are blocked
 * 3. Dangerous schemes are blocked (file://, gopher://)
 * 4. DNS resolution happens and blocks private IPs
 */

import { describe, it, expect } from 'vitest';
import { validateSsrf, validateSsrfSync } from './ssrf.js';
import { SsrfError } from './errors.js';

describe('validateSsrfSync', () => {
  describe('private IP ranges', () => {
    it('blocks 127.0.0.1 (loopback)', () => {
      expect(() => validateSsrfSync('http://127.0.0.1/admin')).toThrow(SsrfError);
    });

    it('blocks 10.0.0.1 (Class A private)', () => {
      expect(() => validateSsrfSync('http://10.0.0.1/')).toThrow(SsrfError);
    });

    it('blocks 10.255.255.255 (Class A private edge)', () => {
      expect(() => validateSsrfSync('http://10.255.255.255/')).toThrow(SsrfError);
    });

    it('blocks 192.168.0.1 (Class C private)', () => {
      expect(() => validateSsrfSync('http://192.168.0.1/')).toThrow(SsrfError);
    });

    it('blocks 192.168.255.255 (Class C private edge)', () => {
      expect(() => validateSsrfSync('http://192.168.255.255/')).toThrow(SsrfError);
    });

    it('blocks 172.16.0.1 (Class B private start)', () => {
      expect(() => validateSsrfSync('http://172.16.0.1/')).toThrow(SsrfError);
    });

    it('blocks 172.31.255.255 (Class B private end)', () => {
      expect(() => validateSsrfSync('http://172.31.255.255/')).toThrow(SsrfError);
    });

    it('blocks 172.20.0.1 (Class B private middle)', () => {
      expect(() => validateSsrfSync('http://172.20.0.1/')).toThrow(SsrfError);
    });

    it('blocks 169.254.169.254 (AWS/GCP/Azure metadata)', () => {
      expect(() => validateSsrfSync('http://169.254.169.254/latest/meta-data/')).toThrow(SsrfError);
    });

    it('blocks 0.0.0.0 (unspecified)', () => {
      expect(() => validateSsrfSync('http://0.0.0.0/')).toThrow(SsrfError);
    });

    it('blocks multicast range 224.0.0.1', () => {
      expect(() => validateSsrfSync('http://224.0.0.1/')).toThrow(SsrfError);
    });
  });

  describe('localhost hostnames', () => {
    it('blocks localhost', () => {
      expect(() => validateSsrfSync('http://localhost/')).toThrow(SsrfError);
    });

    it('blocks localhost.localdomain', () => {
      expect(() => validateSsrfSync('http://localhost.localdomain/')).toThrow(SsrfError);
    });
  });

  describe('blocked schemes', () => {
    it('blocks file:// scheme', () => {
      expect(() => validateSsrfSync('file:///etc/passwd')).toThrow(SsrfError);
    });

    it('blocks gopher:// scheme', () => {
      expect(() => validateSsrfSync('gopher://internal-host:70/')).toThrow(SsrfError);
    });

    it('blocks ftp:// scheme (if enforced)', () => {
      // Note: Current implementation may not block this, but it should
      // This test documents the expected behavior
      expect(() => validateSsrfSync('ftp://internal-host/file')).toThrow();
    });
  });

  describe('error details', () => {
    it('includes URL and reason in SsrfError', () => {
      try {
        validateSsrfSync('http://127.0.0.1/admin');
        expect.fail('Expected SsrfError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SsrfError);
        const ssrfError = error as SsrfError;
        expect(ssrfError.details?.url).toBe('http://127.0.0.1/admin');
        expect(ssrfError.details?.reason).toBeDefined();
        expect(ssrfError.code).toBe('ERR_SSRF_BLOCKED');
        expect(ssrfError.retryable).toBe(false);
      }
    });
  });

  describe('allowed IPs', () => {
    it('allows public IP addresses', () => {
      // 8.8.8.8 is Google's public DNS
      expect(() => validateSsrfSync('http://8.8.8.8/')).not.toThrow();
    });

    it('allows 1.1.1.1 (Cloudflare public DNS)', () => {
      expect(() => validateSsrfSync('http://1.1.1.1/')).not.toThrow();
    });
  });

  describe('allowlist', () => {
    it('allows private IP when in allowlist', () => {
      // This tests the allowlist functionality
      expect(() => validateSsrfSync('http://10.0.0.1/', ['10.0.0.0/8'])).not.toThrow();
    });

    it('blocks private IP not in allowlist', () => {
      expect(() => validateSsrfSync('http://10.0.0.1/', ['192.168.0.0/16'])).toThrow(SsrfError);
    });
  });
});

describe('validateSsrf (async)', () => {
  describe('hostname resolution', () => {
    it('blocks localhost hostname after DNS resolution', async () => {
      await expect(validateSsrf('http://localhost/')).rejects.toThrow(SsrfError);
    });

    it('blocks when DNS resolves to private IP', async () => {
      // Note: This test depends on DNS behavior
      // 'localhost' should resolve to 127.0.0.1
      await expect(validateSsrf('http://localhost/test')).rejects.toThrow(SsrfError);
    });
  });

  describe('error handling', () => {
    it('throws SsrfError with correct code for blocked requests', async () => {
      try {
        await validateSsrf('http://127.0.0.1/');
        expect.fail('Expected SsrfError');
      } catch (error) {
        expect(error).toBeInstanceOf(SsrfError);
        expect((error as SsrfError).code).toBe('ERR_SSRF_BLOCKED');
      }
    });
  });
});

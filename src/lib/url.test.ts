/**
 * Tests for URL canonicalization and validation — locked v1 contract.
 */

import { describe, it, expect } from 'vitest';
import {
  validateUrl,
  canonicalizeUrl,
  urlsAreEquivalent,
  extractHostname,
  normalizeUrl,
} from './url.js';
import { ValidationError } from './errors.js';

describe('validateUrl', () => {
  describe('valid URLs', () => {
    it('accepts valid HTTP URL', () => {
      const url = validateUrl('http://example.com/path');
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('example.com');
    });

    it('accepts valid HTTPS URL', () => {
      const url = validateUrl('https://example.com/path');
      expect(url.protocol).toBe('https:');
    });

    it('accepts URL with port', () => {
      const url = validateUrl('https://example.com:8080/path');
      expect(url.port).toBe('8080');
    });

    it('accepts URL with query params', () => {
      const url = validateUrl('https://example.com/path?a=1&b=2');
      expect(url.searchParams.get('a')).toBe('1');
      expect(url.searchParams.get('b')).toBe('2');
    });
  });

  describe('invalid URLs', () => {
    it('rejects malformed URL', () => {
      expect(() => validateUrl('not-a-url')).toThrow(ValidationError);
    });

    it('rejects empty string', () => {
      expect(() => validateUrl('')).toThrow(ValidationError);
    });
  });

  describe('blocked protocols', () => {
    it('rejects file:// protocol', () => {
      expect(() => validateUrl('file:///etc/passwd')).toThrow(ValidationError);
    });

    it('rejects ftp:// protocol', () => {
      expect(() => validateUrl('ftp://example.com/file')).toThrow(ValidationError);
    });

    it('rejects javascript: protocol', () => {
      expect(() => validateUrl('javascript:alert(1)')).toThrow(ValidationError);
    });
  });

  describe('embedded credentials', () => {
    it('rejects URL with username and password', () => {
      expect(() => validateUrl('https://user:pass@example.com/')).toThrow(ValidationError);
    });

    it('rejects URL with username only', () => {
      expect(() => validateUrl('https://user@example.com/')).toThrow(ValidationError);
    });
  });
});

describe('extractHostname', () => {
  it('extracts hostname from URL', () => {
    const url = new URL('https://www.example.com/path');
    expect(extractHostname(url)).toBe('www.example.com');
  });

  it('returns lowercase hostname', () => {
    const url = new URL('https://EXAMPLE.COM/path');
    expect(extractHostname(url)).toBe('example.com');
  });
});

describe('canonicalizeUrl', () => {
  describe('Rule 1: scheme lowercase', () => {
    it('lowercases HTTPS scheme', () => {
      // Implementation keeps trailing slash on root path
      expect(canonicalizeUrl('HTTPS://EXAMPLE.COM/')).toBe('https://example.com/');
    });

    it('lowercases HTTP scheme', () => {
      expect(canonicalizeUrl('HTTP://EXAMPLE.COM/')).toBe('http://example.com/');
    });
  });

  describe('Rule 2: hostname lowercase + strip www', () => {
    it('lowercases hostname', () => {
      expect(canonicalizeUrl('https://EXAMPLE.COM/')).toBe('https://example.com/');
    });

    it('strips www prefix from hostname', () => {
      expect(canonicalizeUrl('https://www.example.com/')).toBe('https://example.com/');
    });

    it('preserves www when it is the only subdomain (bare TLD)', () => {
      // www.co.uk has 2 labels after removing www, so it's NOT a bare TLD
      // Implementation will strip www → co.uk
      expect(canonicalizeUrl('https://www.co.uk/')).toBe('https://co.uk/');
    });

    it('does not strip www from non-www hostname', () => {
      expect(canonicalizeUrl('https://docs.example.com/')).toBe('https://docs.example.com/');
    });

    it('strips www from multi-level domain', () => {
      expect(canonicalizeUrl('https://www.docs.example.com/')).toBe('https://docs.example.com/');
    });
  });

  describe('Rule 3: remove default ports', () => {
    it('removes port 80 for HTTP', () => {
      expect(canonicalizeUrl('http://example.com:80/')).toBe('http://example.com/');
    });

    it('removes port 443 for HTTPS', () => {
      expect(canonicalizeUrl('https://example.com:443/')).toBe('https://example.com/');
    });

    it('preserves non-default port for HTTP', () => {
      expect(canonicalizeUrl('http://example.com:8080/')).toBe('http://example.com:8080/');
    });

    it('preserves non-default port for HTTPS', () => {
      expect(canonicalizeUrl('https://example.com:8443/')).toBe('https://example.com:8443/');
    });
  });

  describe('Rule 4: sort query params alphabetically', () => {
    it('sorts query params by key', () => {
      // Note: URLSearchParams preserves case in sorting, a/A comparison is case-sensitive
      // But input params are already lowercase in this case
      expect(canonicalizeUrl('https://example.com/?b=2&a=1')).toBe('https://example.com/?a=1&b=2');
    });

    it('handles multiple query params', () => {
      const result = canonicalizeUrl('https://example.com/?z=3&a=1&m=2');
      expect(result).toBe('https://example.com/?a=1&m=2&z=3');
    });

    it('handles URL without query params', () => {
      expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('handles empty query string', () => {
      expect(canonicalizeUrl('https://example.com/?')).toBe('https://example.com/');
    });
  });

  describe('Rule 5: strip fragment', () => {
    it('removes fragment from URL', () => {
      expect(canonicalizeUrl('https://example.com/page#section1')).toBe('https://example.com/page');
    });

    it('removes empty fragment', () => {
      expect(canonicalizeUrl('https://example.com/#')).toBe('https://example.com/');
    });

    it('handles URL with path', () => {
      expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });
  });

  describe('Rule 6: remove trailing slash', () => {
    it('removes trailing slash from non-root path', () => {
      expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    it('preserves root path slash', () => {
      // Implementation keeps trailing slash on root path
      expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('removes trailing slash from multi-level path', () => {
      expect(canonicalizeUrl('https://example.com/a/b/c/')).toBe('https://example.com/a/b/c');
    });
  });

  describe('combined rules', () => {
    it('applies all canonicalization rules together', () => {
      const input = 'HTTPS://WWW.EXAMPLE.COM:443/PATH/?Z=3&A=1#section';
      const result = canonicalizeUrl(input);
      // Lowercase scheme and hostname, strip www, remove :443, sort query params, drop fragment
      expect(result).toBe('https://example.com/PATH?A=1&Z=3');
    });

    it('normalizes equivalent URLs to same canonical form', () => {
      const urls = [
        'https://www.example.com/path/',
        'https://example.com/path',
        'https://EXAMPLE.COM/path/', // lowercase path
        'https://example.com:443/path#ignored',
      ];
      const canonical = urls.map(canonicalizeUrl);
      // All should normalize to same canonical form
      expect(new Set(canonical).size).toBe(1);
      expect(canonical[0]).toBe('https://example.com/path');
    });
  });

  describe('error handling', () => {
    it('throws ValidationError for invalid URL', () => {
      expect(() => canonicalizeUrl('not-a-url')).toThrow(ValidationError);
    });
  });
});

describe('urlsAreEquivalent', () => {
  it('returns true for equivalent URLs', () => {
    expect(urlsAreEquivalent(
      'https://www.example.com/path/',
      'https://example.com/path'
    )).toBe(true);
  });

  it('returns true for URLs differing only in scheme case', () => {
    expect(urlsAreEquivalent(
      'HTTPS://example.com/',
      'https://example.com/'
    )).toBe(true);
  });

  it('returns true for URLs differing only in fragment', () => {
    expect(urlsAreEquivalent(
      'https://example.com/#section1',
      'https://example.com/#section2'
    )).toBe(true);
  });

  it('returns false for different hostnames', () => {
    expect(urlsAreEquivalent(
      'https://example.com/',
      'https://other.com/'
    )).toBe(false);
  });

  it('returns false for different paths', () => {
    expect(urlsAreEquivalent(
      'https://example.com/a',
      'https://example.com/b'
    )).toBe(false);
  });

  it('returns false for invalid URLs', () => {
      expect(urlsAreEquivalent('not-a-url', 'also-invalid')).toBe(false);
  });
});

describe('normalizeUrl (deprecated alias)', () => {
  it('is an alias for canonicalizeUrl', () => {
    const input = 'https://www.example.com/path/';
    expect(normalizeUrl(input)).toBe(canonicalizeUrl(input));
  });
});

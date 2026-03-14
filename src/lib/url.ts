/**
 * URL canonicalization and validation — locked v1 contract.
 *
 * Canonicalization rules (from PRD):
 * 1. Scheme: always lowercase.
 * 2. Hostname: always lowercase; strip `www.` unless it's the only subdomain.
 * 3. Trailing slash: remove for comparison.
 * 4. Query params: sort alphabetically by key for consistent deduplication.
 * 5. Fragments: strip for deduplication (preserved if user-provided in results).
 */

import { ValidationError } from './errors.js';

/** Allowed URL protocols */
const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and parse a URL.
 * @param urlString - URL string to validate
 * @returns Validated URL object
 * @throws ValidationError if URL is invalid or uses a blocked protocol
 */
export function validateUrl(urlString: string): URL {
  let url: URL;

  try {
    url = new URL(urlString);
  } catch {
    throw new ValidationError('Invalid URL format', 'url', urlString);
  }

  // Protocol allowlist
  if (!ALLOWED_PROTOCOLS.includes(url.protocol as (typeof ALLOWED_PROTOCOLS)[number])) {
    throw new ValidationError(
      `URL protocol '${url.protocol}' is not allowed`,
      'url',
      urlString
    );
  }

  // Reject credentials embedded in URL (security)
  if (url.username || url.password) {
    throw new ValidationError(
      'URL must not contain credentials',
      'url',
      urlString
    );
  }

  return url;
}

/**
 * Extract hostname from a validated URL object.
 */
export function extractHostname(url: URL): string {
  return url.hostname;
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

/**
 * Strip `www.` from a hostname, unless `www` is the only subdomain
 * (i.e., removing it would leave a bare TLD).
 *
 * Examples:
 *   www.example.com → example.com
 *   www.co.uk       → www.co.uk  (only subdomain is www, leave it)
 *   docs.example.com → docs.example.com (no www prefix)
 */
function stripWww(hostname: string): string {
  if (!hostname.startsWith('www.')) return hostname;
  const withoutWww = hostname.slice(4); // remove "www."
  // A bare hostname (no dots) or a single-label domain is a TLD — preserve www
  if (!withoutWww.includes('.')) return hostname;
  return withoutWww;
}

/**
 * Canonicalize a URL for deduplication per locked v1 rules:
 * 1. Scheme lowercase
 * 2. Hostname lowercase + strip www.
 * 3. Remove default ports (80/443)
 * 4. Sort query params alphabetically
 * 5. Strip fragment
 * 6. Remove trailing slash on path
 *
 * @param urlString - URL string to canonicalize
 * @returns Canonical URL string
 * @throws ValidationError if URL is invalid
 */
export function canonicalizeUrl(urlString: string): string {
  const url = validateUrl(urlString);

  // Rule 1 + 2: scheme and hostname lowercase, strip www.
  const scheme = url.protocol.toLowerCase(); // already lowercase from URL parser
  const hostname = stripWww(url.hostname.toLowerCase());

  // Rule 3: remove default ports
  let port = url.port;
  if ((scheme === 'http:' && port === '80') || (scheme === 'https:' && port === '443')) {
    port = '';
  }

  // Rule 4: sort query params alphabetically by key
  const sortedParams = new URLSearchParams(
    [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
  );
  const query = sortedParams.toString();

  // Rule 6: strip trailing slash from path (but keep root "/" as empty for joining)
  let path = url.pathname;
  if (path.endsWith('/') && path.length > 1) {
    path = path.slice(0, -1);
  }

  // Reassemble (Rule 5: no fragment)
  const authority = port ? `${hostname}:${port}` : hostname;
  const base = `${scheme}//${authority}${path}`;
  return query ? `${base}?${query}` : base;
}

/**
 * @deprecated Use canonicalizeUrl() — this alias exists for backward compat.
 */
export function normalizeUrl(urlString: string): string {
  return canonicalizeUrl(urlString);
}

// ---------------------------------------------------------------------------
// Deduplication helpers
// ---------------------------------------------------------------------------

/**
 * Check whether two URLs are equivalent after canonicalization.
 */
export function urlsAreEquivalent(url1: string, url2: string): boolean {
  try {
    return canonicalizeUrl(url1) === canonicalizeUrl(url2);
  } catch {
    return false;
  }
}

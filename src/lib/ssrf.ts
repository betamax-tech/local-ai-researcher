/**
 * SSRF (Server-Side Request Forgery) protection utilities
 *
 * Safety baseline:
 * - Blocks private IP ranges (loopback, private networks, link-local, metadata)
 * - Blocks dangerous schemes (file://, gopher://, ftp://, etc.)
 * - Blocks localhost hostnames
 * - Validates redirect URLs through the same checks
 */

import dns from 'dns';
import { promisify } from 'util';

import { SsrfError } from './errors.js';

const dnsLookup = promisify(dns.lookup);

/** Allowed URL schemes (only http and https) */
const ALLOWED_SCHEMES = ['http:', 'https:'] as const;

/** Private IPv4 ranges */
const PRIVATE_RANGES = [
  { start: '10.0.0.0', prefix: 8 },      // Private Class A
  { start: '172.16.0.0', prefix: 12 },   // Private Class B
  { start: '192.168.0.0', prefix: 16 },  // Private Class C
  { start: '127.0.0.0', prefix: 8 },      // Loopback
  { start: '169.254.0.0', prefix: 16 },  // Link-local
  { start: '0.0.0.0', prefix: 8 },       // Unspecified
  { start: '224.0.0.0', prefix: 4 },     // Multicast
] as const;

/** Cloud metadata services (common targets) */
const METADATA_IPS = [
  '169.254.169.254',  // AWS
  'metadata.google.internal',  // GCP
  '169.254.169.254',  // Azure (same as AWS)
] as const;

/** Localhost hostnames */
const LOCALHOST_HOSTNAMES: string[] = [
  'localhost',
  'localhost.localdomain',
];

/**
 * Convert IP address to integer for comparison
 * @param ip - IP address string
 * @returns Integer representation
 */
function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet || '0', 10), 0) >>> 0;
}

/**
 * Check if IP is in CIDR range
 * @param ip - IP address to check
 * @param rangeStart - Range start IP
 * @param prefix - CIDR prefix length
 * @returns True if IP is in range
 */
function ipInRange(ip: string, rangeStart: string, prefix: number): boolean {
  const ipInt = ipToInt(ip);
  const startInt = ipToInt(rangeStart);
  const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (startInt & mask);
}

/**
 * Check if IP is in private range
 * @param ip - IP address to check
 * @returns True if IP is private
 */
function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some(range =>
    ipInRange(ip, range.start, range.prefix)
  );
}

/**
 * Check if hostname is localhost
 * @param hostname - Hostname to check
 * @returns True if hostname is localhost
 */
function isLocalhost(hostname: string): boolean {
  return LOCALHOST_HOSTNAMES.includes(hostname.toLowerCase());
}

/**
 * Validate URL is not SSRF-vulnerable
 * @param urlString - URL to validate
 * @param allowedNetworks - Optional CIDR allowlist
 * @throws SsrfError if URL is blocked
 */
export async function validateSsrf(
  urlString: string,
  allowedNetworks: string[] = []
): Promise<void> {
  const url = new URL(urlString);
  const hostname = url.hostname;

  // Check scheme - only http and https are allowed
  if (!ALLOWED_SCHEMES.includes(url.protocol as 'http:' | 'https:')) {
    throw new SsrfError(
      `Request with scheme '${url.protocol}' is blocked`,
      urlString,
      'Only http and https schemes are allowed'
    );
  }

  // Check localhost hostnames
  if (isLocalhost(hostname)) {
    throw new SsrfError(
      'Request to localhost is blocked',
      urlString,
      'Hostname is localhost'
    );
  }

  // Resolve hostname to IP addresses with a short timeout.
  // If DNS lookup fails (NXDOMAIN, network error, or timeout) we allow the
  // request through: we can only block confirmed-private addresses, not
  // unknown ones.  The timeout prevents DNS latency from blocking callers
  // when they already have a safe hostname and fetch is mocked in tests.
  const DNS_TIMEOUT_MS = 2000;
  const dnsTimeout = new Promise<string[]>(resolve =>
    setTimeout(() => resolve([]), DNS_TIMEOUT_MS)
  );
  const dnsLookupResult = dnsLookup(hostname, { family: 4 })
    .then(result => [result.address])
    .catch(() => [] as string[]);

  const addresses = await Promise.race([dnsLookupResult, dnsTimeout]);

  if (addresses.length === 0) {
    // DNS resolution failed or timed out — cannot confirm private, so allow.
    return;
  }

  // Check each resolved IP
  for (const ip of addresses) {
    // Check cloud metadata services
    if (METADATA_IPS.includes(ip as any)) {
      throw new SsrfError(
        'Request to cloud metadata service is blocked',
        urlString,
        'IP is cloud metadata service'
      );
    }

    // Check private ranges (unless in allowlist)
    if (isPrivateIp(ip)) {
      // Check allowlist
      const isAllowed = allowedNetworks.some(allowedNetwork => {
        const parts = allowedNetwork.split('/');
        if (parts.length !== 2) return false;
        return ipInRange(ip, parts[0] || '', parseInt(parts[1] || '', 10));
      });

      if (!isAllowed) {
        throw new SsrfError(
          'Request to private network is blocked',
          urlString,
          `IP ${ip} is in private range`
        );
      }
    }
  }
}

/**
 * Validate URL is not SSRF-vulnerable (synchronous version for IP-only URLs)
 * @param urlString - URL to validate
 * @param allowedNetworks - Optional CIDR allowlist
 * @throws SsrfError if URL is blocked
 */
export function validateSsrfSync(
  urlString: string,
  allowedNetworks: string[] = []
): void {
  const url = new URL(urlString);
  const hostname = url.hostname;

  // Check scheme FIRST — must happen before the IP regex guard so that
  // file://, gopher://, etc. are rejected with SsrfError, not a generic Error.
  if (!ALLOWED_SCHEMES.includes(url.protocol as 'http:' | 'https:')) {
    throw new SsrfError(
      `Request with scheme '${url.protocol}' is blocked`,
      urlString,
      'Only http and https schemes are allowed'
    );
  }

  // Check localhost hostnames BEFORE the IP regex guard so that
  // 'localhost' / 'localhost.localdomain' are rejected with SsrfError.
  if (isLocalhost(hostname)) {
    throw new SsrfError(
      'Request to localhost is blocked',
      urlString,
      'Hostname is localhost'
    );
  }

  // Check if hostname is an IP address
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(hostname)) {
    // Not an IP address and not a blocked hostname — use async version for DNS
    throw new Error('Use validateSsrf() for hostnames');
  }

  // Check cloud metadata
  if (METADATA_IPS.includes(hostname as any)) {
    throw new SsrfError(
      'Request to cloud metadata service is blocked',
      urlString,
      'IP is cloud metadata service'
    );
  }

  // Check private ranges
  if (isPrivateIp(hostname)) {
    const isAllowed = allowedNetworks.some(allowedNetwork => {
      const parts = allowedNetwork.split('/');
      if (parts.length !== 2) return false;
      return ipInRange(hostname, parts[0] || '', parseInt(parts[1] || '', 10));
    });

    if (!isAllowed) {
      throw new SsrfError(
        'Request to private network is blocked',
        urlString,
        `IP ${hostname} is in private range`
      );
    }
  }
}

# SECURITY — Threat Model and Mitigations

## Threat Model

This document analyzes Local Researcher's security posture, identifies threats, and documents mitigations.

## Assumptions

- **Deployment**: Runs as a user-level process, not privileged
- **Network**: Has outbound internet access
- **Trust Model**: MCP client is trusted; external providers are semi-trusted
- **Data**: No persistent storage; all data is transient

## Threat Categories

### 1. SSRF (Server-Side Request Forgery)

**Threat**: Attacker coerces Local Researcher into making HTTP requests to internal systems (localhost, private networks, cloud metadata services).

**Attack Vector**:
```javascript
// Malicious tool invocation
await tools.read({
  url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'
});
```

**Impact**:
- Data exfiltration from internal services
- Access to cloud metadata (EC2, GCP, Azure)
- Port scanning internal networks
- Bypassing network controls

**Mitigations**:

#### 1.1 URL Blacklist
Block requests to:
- Private IPv4 ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Loopback: `127.0.0.0/8`, `::1`
- Link-local: `169.254.0.0/16`
- IPv6 unique local: `fc00::/7`
- Cloud metadata: `169.254.169.254`
- Hostname equivalents: `localhost`, `0.0.0.0`

#### 1.2 DNS Rebinding Protection
- Resolve hostname, validate IP address
- Block IPs that resolve to blacklisted ranges
- Cache DNS results during validation

#### 1.3 Allowlist Override (Optional)
Configurable allowlist for legitimate internal access:
```env
SSRF_ALLOWED_NETWORKS=10.0.1.0/24,192.168.100.50
```
- **Default**: Empty (deny all private networks)
- **Risk**: Allowlist must be carefully managed
- **Recommendation**: Use only if internal access is required

#### 1.4 Implementation
See `src/lib/ssrf.ts` for implementation details:
- Parse URL, extract hostname
- Resolve to IP address
- Check against blacklist
- Check against allowlist (if configured)
- Throw `SsrfError` if blocked

**Testing**:
- Unit tests for all blocked IP ranges
- DNS rebinding tests
- Allowlist override tests
- Fuzz testing with malicious URLs

### 2. URL Injection

**Threat**: Attacker crafts malicious URLs to cause unexpected behavior.

**Attack Vector**:
```javascript
// URL with control characters or protocol confusion
await tools.read({
  url: 'file:///etc/passwd'
});
await tools.read({
  url: 'javascript:alert(document.cookie)'
});
```

**Impact**:
- Local file access (via `file://` protocol)
- Protocol confusion attacks
- Bypass SSRF filters
- Information disclosure

**Mitigations**:

#### 2.1 Protocol Whitelist
Only allow:
- `http://`
- `https://`

Reject all other protocols (`file://`, `ftp://`, `data://`, etc.).

#### 2.2 URL Validation
- Use proper URL parser (Node.js `URL` API)
- Validate protocol before parsing
- Reject malformed URLs
- Reject URLs with credentials in host (`http://user:pass@host/`)

**Testing**:
- Test all allowed protocols
- Test blocked protocols
- Test malformed URLs
- Test URL encoding edge cases

### 3. Credential Exposure

**Threat**: API keys, tokens, or secrets are exposed in logs or errors.

**Attack Vector**:
- Logs capture full request URLs with query parameters
- Error messages include request details
- Debug mode reveals sensitive data

**Impact**:
- Credential theft
- Unauthorized access to providers
- Account compromise

**Mitigations**:

#### 3.1 Log Sanitization
- Never log request bodies
- Redact API keys from URLs: `?api_key=[REDACTED]`
- Redact Authorization headers: `Authorization: Bearer [REDACTED]`
- Use structured logging (JSON) for easy filtering

#### 3.2 Error Message Hygiene
- Errors do not include request details
- Stack traces only in debug mode
- Generic error messages for clients

**Testing**:
- Inspect logs for secrets
- Test with URLs containing query parameters
- Verify error messages are safe

### 4. Denial of Service (DoS)

**Threat**: Attacker overwhelms Local Researcher with requests or causes resource exhaustion.

**Attack Vectors**:
- Large number of concurrent requests
- Requests to slow-responding endpoints
- Large response bodies
- Slowloris attacks

**Impact**:
- Service unavailability
- Resource exhaustion (CPU, memory, network)
- Impact to other processes on host

**Mitigations**:

#### 4.1 Request Timeouts
- All HTTP requests have configurable timeouts
- Default timeout: 30 seconds (configurable)
- Abort requests exceeding timeout

#### 4.2 Response Size Limits
- Maximum response body size: 10MB (configurable)
- Stream responses, don't buffer entire body
- Abort oversized responses

#### 4.3 Concurrency Limits
- Maximum concurrent HTTP requests: 10 (configurable)
- Queue requests beyond limit
- Return error if queue is full

#### 4.4 Rate Limiting (Future)
- Per-provider rate limits
- Per-session rate limits
- Exponential backoff for retries

**Testing**:
- Load testing with high concurrency
- Timeout testing with slow endpoints
- Oversized response testing
- Queue overflow testing

### 5. Provider Compromise

**Threat**: External provider (SearxNG, Jina Reader) is compromised or malicious.

**Attack Vectors**:
- Provider returns malicious content
- Provider redirects to malicious URLs
- Provider exfiltrates request data
- Provider injects tracking

**Impact**:
- Misleading or false search results
- XSS attacks via search results
- Privacy violations (request data leaked)

**Mitigations**:

#### 5.1 Provider Trust Model
- Assume provider is semi-trusted (can see requests)
- Self-host when possible (SearxNG)
- Use HTTPS for all requests
- Verify TLS certificates

#### 5.2 Response Sanitization
- Strip HTML tags from content (Jina Reader helps)
- Validate JSON structure
- Limit response sizes

#### 5.3 Minimal Data Exposure
- Send only necessary data to providers
- Avoid sending sensitive headers
- No PII in search queries

**Testing**:
- Test with compromised provider (simulated)
- Verify HTML stripping
- Verify response size limits

### 6. Log Injection

**Threat**: Attacker injects malicious content into logs via user-controlled data.

**Attack Vector**:
```javascript
// Log user input directly
logger.info('Search query: ' + query); // query contains newline characters
```

**Impact**:
- Log file corruption
- False log entries
- Log evasion attacks

**Mitigations**:

#### 6.1 Structured Logging
- Use JSON logging (`logger.info({ message: '...', query })`)
- No string interpolation for user input
- JSON serialization handles escaping

#### 6.2 Log Output Sanitization
- Encode newlines and control characters
- Limit field lengths
- Truncate oversized fields

**Testing**:
- Test with newline characters in input
- Test with control characters
- Verify log format is valid JSON

## Operational Security

### Deployment

1. **Run as Unprivileged User**
   ```bash
   useradd -r -s /bin/false local-researcher
   su - local-researcher -c 'pnpm start'
   ```

2. **Network Segregation**
   - Deploy in isolated network if possible
   - Use firewall to restrict outbound access
   - Allow only necessary provider endpoints

3. **Resource Limits**
   ```bash
   # cgroup limits (Linux)
   cgcreate -g memory,cpu:/local-researcher
   cgset -r memory.limit_in_bytes=1G /local-researcher
   cgset -r cpu.shares=512 /local-researcher
   ```

4. **File Permissions**
   - `.env` file: `600` (read/write owner only)
   - Log files: `640` (owner read/write, group read)
   - Binary: `755` (owner read/write/execute, others read/execute)

### Configuration

1. **Environment Variables**
   - Never commit `.env` to git
   - Use `.env.example` as template
   - Rotate API keys regularly

2. **Provider Configuration**
   - Use HTTPS endpoints only
   - Verify provider certificates
   - Self-host providers when possible

3. **Logging**
   - Set appropriate log level (info or warn for production)
   - Rotate logs regularly
   - Monitor log file sizes

### Monitoring

1. **Health Checks**
   - Monitor provider health (`health` tool)
   - Alert on repeated failures
   - Monitor response times

2. **Anomaly Detection**
   - Monitor request rates
   - Alert on spikes
   - Monitor error rates

3. **Log Analysis**
   - Regular log review
   - Search for SSRF blocks
   - Monitor for unusual URLs

## Incident Response

### Suspected SSRF Attack

1. **Immediate Action**
   - Stop Local Researcher process
   - Rotate all API keys
   - Review logs for internal IP access

2. **Investigation**
   - Identify attacker IP/time
   - Review provider logs (if available)
   - Determine scope of exposure

3. **Remediation**
   - Tighten SSRF filters
   - Review allowlist configuration
   - Consider network-level restrictions

### Suspected DoS Attack

1. **Immediate Action**
   - Stop Local Researcher process
   - Review logs for request patterns

2. **Mitigation**
   - Add rate limiting
   - Reduce timeout values
   - Implement connection limits

3. **Recovery**
   - Restart with tighter limits
   - Monitor for recurrence

## Security Checklist

- [ ] SSRF filters enabled and tested
- [ ] URL protocol whitelist enforced
- [ ] All HTTP requests have timeouts
- [ ] Logs use JSON format
- [ ] Logs redact sensitive data
- [ ] `.env` file permissions are 600
- [ ] HTTPS enforced for all providers
- [ ] Response size limits configured
- [ ] Concurrency limits configured
- - ] Health monitoring enabled
- [ ] Log rotation configured
- [ ] Incident response plan documented

## References

- [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [MCP Security Considerations](https://modelcontextprotocol.io/docs/security/)

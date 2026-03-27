---
id: "07.03"
title: "Lock safety and privacy baseline"
type: feat
priority: high
complexity: M
difficulty: complex
sprint: 2
depends_on: ["06.01"]
blocks: ["08.01", "09.01"]
parent: "07"
branch: "feat/task-07-contract-reset"
assignee: dev
enriched: true
rmcp_id: "RMCP-01-C"
---

# Task 07.03: Lock Safety And Privacy Baseline

## Business Requirements

### Problem
The canonical direction treats SSRF protection, bounded resource use, redirect safety, and redacted logging as mandatory baseline behavior. These rules must be locked before provider completion work so later agents do not treat them as optional hardening.

### User Story
As an operator running the server locally, I want outbound work to stay within strict safety and privacy limits so that research requests do not leak secrets or overrun local resources.

### Acceptance Criteria
- [ ] Every outbound request path enforces SSRF protection, including redirect flows that could otherwise bypass the initial check.
- [ ] Every v1 tool path applies bounded work rules for timeouts, concurrency, and response-size limits.
- [ ] Logs redact secrets and do not emit full extracted page content by default.
- [ ] Error handling communicates safety-triggered failures without exposing protected data.
- [ ] The baseline is documented as required v1 behavior rather than optional future hardening.

### Business Rules
- Safety checks apply equally to direct reads and to reads triggered through `gather`.
- Resource bounds are part of the user-visible contract because they define what a request can return.
- Redaction must protect secrets and high-volume extracted content in all normal logging paths.

### Out of Scope
- Adding authentication or user accounts.
- Defining post-v1 tenancy or cloud security posture.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Security** — Safety baseline protects against SSRF, resource exhaustion, and information leakage.

**Pattern: Defense-in-depth with explicit bounds** — SSRF checks, timeouts, concurrency limits, and redacted logging are non-optional runtime enforcement, not configuration conveniences.

**Rationale:** Local-first does not mean trust-all. Outbound requests to arbitrary URLs require guardrails.

**Constraints this creates:**
- Every outbound HTTP request passes through SSRF guard
- Redirect chains cannot bypass SSRF (follow-redirect must re-check)
- Timeouts, max response size, and concurrency limits have enforced defaults
- Logger never emits secrets or full page content

## Affected Areas

- `src/lib/ssrf.ts` — implement/verify SSRF guard for: private IP ranges, localhost, metadata endpoints, blocked schemes
- `src/lib/http.ts` — enforce timeouts, max response bytes, redirect limits; integrate SSRF check on initial and redirect URLs
- `src/lib/logger.ts` — redact secrets (API keys, tokens), truncate large content bodies, structured output to stderr
- `src/config.ts` — define and validate safety-related config with sane defaults
- `src/providers/searxng.ts` — use safe HTTP client for all outbound calls
- `src/providers/jinaReader.ts` — use safe HTTP client for all outbound calls
- `src/tools/gather.ts` — apply bounded concurrency for parallel reads

## Quality Gates

- SSRF test cases cover: 127.0.0.1, 10.x.x.x, 192.168.x.x, 172.16-31.x.x, 169.254.169.254, file://, gopher://
- Redirect through SSRF-blocked URL is caught (e.g., HTTP 302 to 169.254.169.254)
- Request exceeding timeout returns structured error, not hanging
- Request exceeding max bytes returns structured error with partial content discarded
- Log output contains no API keys or full page content (verify with fixture test)
- Concurrency limit enforced when gather performs parallel reads

## Gotchas

- DNS rebinding attacks: hostname resolution happens at request time; consider IP validation after resolution
- Provider SDKs may have their own HTTP clients — ensure they use the guarded client
- Log redaction must handle multiple secret formats (Bearer, api_key, ?token=, etc.)

---
<!-- COMPLETION — appended by Orchestrator after verification -->

## Changes
- `src/lib/ssrf.ts` — scheme + localhost checks before IP-regex guard; scheme blocking (`file://`, `gopher://`); DNS timeout
- `src/lib/http.ts` — manual redirect following with per-hop SSRF validation; reliable AbortController timeout via Promise.race
- `src/lib/logger.ts` — secret redaction (Authorization headers, api_key/token/access_token query params, nested keys); content truncation at 512 chars
- `src/lib/ssrf.test.ts` — new: SSRF blocking tests (private IPs, localhost, schemes, redirect bypass)
- `src/lib/http.test.ts` — new: redirect SSRF bypass and timeout tests
- `src/lib/logger.test.ts` — new: redaction and truncation tests

# Investigation: 20 Failing Tests — Safety/Privacy Baseline (task-07)
Started: 2026-03-27
Status: DIAGNOSING

## Symptom
20 tests failing across 3 files on branch `feat/task-07-contract-reset`.
Tests are correct; implementations need fixing.

## Environment
- Branch: feat/task-07-contract-reset
- Working dir: /home/cmark/Projects/local-ai-researcher
- Node: v24.14.1

## Fingerprint
- **Error signature**: Multiple — logger redaction missing, SsrfError not thrown, HTTP redirect/timeout handling broken
- **Component**: src/lib/logger.ts, src/lib/ssrf.ts, src/lib/http.ts
- **Tags**: redaction, ssrf, http-timeout, redirect-follow

## Hypothesis Stack

### H1 (top): Logger has no redaction logic at all
**Confidence**: high
**Rationale**: Test group 1 (10 failures) all relate to redaction — headers, query params, nested objects, body truncation

### H2: ssrf.ts validateSsrfSync doesn't block localhost/file/gopher
**Confidence**: high
**Rationale**: Test group 2 (4 failures) explicitly mentions these cases throw generic Error not SsrfError

### H3: HTTP client doesn't follow redirects or respect timeout
**Confidence**: high
**Rationale**: Test group 3 (6 failures) — redirect SSRF, safe redirect, and 3 timeout tests all failing

## Root Cause
TBD

## Fix
TBD

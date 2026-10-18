# Dev sidecar + host browser unlock — local verification

Date: 2026-10-18. Base: betamax-tech `main` at `faa5e82`.
Branch: `feat/dev-sidecar-and-browser-unlock`. No push or remote deployment.

## Git state

- `origin`: `git@github.com:betamax-tech/local-ai-researcher.git`.
- Former origin preserved as `mark-cervantes`.
- Local `main` tracks `origin/main`, both `faa5e82`.
- Old local main preserved at `archive/mark-cervantes-main` (`cc4d32e`).
- Superseded `feat/scrapling-stealth` remains unchanged at `41f0f21`; not merged.
- GitHub identity switched to `mark-cervantes`.

## Code verification

Independent review read the complete implementation/test/documentation diffs.
The project does not expose `dev:up/status/errors` verbs; verification uses the
actual local Compose sidecar and MCP stdio process instead.

- `pnpm typecheck`: no errors.
- `pnpm build`: rebuilt ignored `dist/`, no errors.
- `pnpm lint`: exits 0, but **the existing command is a placeholder**.
- `pnpm test`: 36 files, 817 passing tests.
- `uv run --with pytest --with-requirements scripts/browser-cookies-requirements.txt pytest tests/sidecar -q`:
  123 passing tests after live-discovered regressions were fixed.

Host-cookie dependencies are separately pinned: cryptography 46.0.3,
SecretStorage 3.4.0, tldextract 5.3.1. The feature defaults off and needs no host
Python dependencies until opted in. Cookie DB snapshots use SQLite read-only
backup into **memory**, not credential-bearing disk copies.

## Local runtime

Ran `docker compose --profile scrapling up -d --build scrapling` and waited for
first-run Node repair / Chromium setup. Health returned:

```json
{"status":"connected","detected_version":"0.4.10","runtime":"docker+python 3.12.15"}
```

Container publication: `127.0.0.1:8090->8090/tcp`. Docker warned the host kernel
cannot enforce the configured container memory limit. No public bind was added.
Container fetch logs contain status/URL/referrer only, no cookie values.

### Real provider → MCP-tool handler, cookie-only probe

Used `LOCAL_RESEARCHER_BROWSER_COOKIES=auto` and constructed the real
`ScraplingProvider` with `{allowOpen:false}` plus an open dependency that throws.
The probe called the real `scrape_page` tool handler, forced static mode to avoid
unnecessary headless loads, and inspected only safe summary fields.

- `https://example.com`: HTTP 200, `access.outcome=ok`, title `Example Domain`,
  25 words, `json_ld=[]`, final run 358 ms.
- Indeed `https://ph.indeed.com/viewjob?jk=efc64076cc7ebc9f`:
  initial 401 `Authenticating...` → `bot_challenge`; one cookie retry using
  `chrome131`, configured Chrome/152 UA, direct egress → HTTP 403
  `Security Check - Indeed.com`, still `bot_challenge`. Final run timings:
  initial 150 ms, retry 156 ms (excluding helper time).
- Cookie retry alone **did not succeed**. The current browser contained an
  unexpired first-party-partitioned `cf_clearance` and `_cfuvid` for `.indeed.com`.
  A direct host `curl_cffi` check with that pair and the verified profile/UA also
  returned 403. No Indeed JobPosting JSON-LD was accessible in this session.
- No browser tab was opened. Open/poll/fresh-retry, timeout, per-domain lock,
  and no-open-on-rate-limit paths were verified only with fakes.

Live testing exposed and fixed two misses before delivery: explicit bot checks
using 401 must not be mistaken for login walls; first-party CHIPS clearance must
not be dropped with unrelated third-party partitions.

### Actual MCP stdio cold start

Started rebuilt `dist/index.js` through the SDK stdio client with cookies off:

- Listed 13 tools, including `browser_unlock`.
- `browser_unlock(https://example.com)` returned `captured=false`,
  `status=disabled`, no browser/helper action.
- `scrape_page(https://schema.org/JobPosting, mode=static)` returned HTTP 200,
  `access.outcome=ok`, 5,494 words, and one JSON-LD block through MCP.
- A real Scrapling `Selector` inside the rebuilt container extracted a synthetic
  JobPosting with its `@type` and `title` intact. This is parser smoke evidence,
  **not** a retrieved Indeed job posting.

## Bootstrap behavior

`start.sh` launches local Scrapling only when bootstrap is `true`, scraping is
not disabled, and the configured endpoint parses as loopback. Remote tailnet or
DNS endpoints never start a local Scrapling container, including required mode;
`SCRAPLING_BOOTSTRAP_WITH_DOCKER=false` disables it even for loopback. Canonical
prefixed variables take precedence over bare names. Existing SearXNG bootstrap
behavior is unchanged. Tests execute the actual script with isolated fake
Docker/curl/server commands, including no-Docker remote clients.

## Safety boundaries

No cookie values in reports, logs, git, or temporary files. No real browser-open
test. No SSH, ban-hserver changes, OpenCode config changes, push, or hook bypass.
Bind changes are documented development settings, not changes to tailnet/DNS.

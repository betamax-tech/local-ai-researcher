# local-ai-researcher

**Privacy-first research for AI agents.** Self-hosted web search and content extraction via MCP — no cloud dependencies, no API keys required for default operation.

local-ai-researcher gives your AI agent the ability to search the web and extract content from URLs using local infrastructure you control. It's designed to be a sensible default research baseline for [OpenCode](https://github.com/opencode-ai/opencode) and other MCP-compatible AI tools.

**Why use this?**
- **Privacy-focused**: All search and extraction happens through your own infrastructure
- **No required API keys**: Default operation uses self-hosted SearXNG and Jina Reader
- **Free and unlimited**: No rate limits or quotas when using local providers
- **MCP-native**: Built specifically for AI agent integration via stdio transport
- **Convenient**: The `gather` tool combines search + parallel reads in one call

**Tradeoffs to know:**
- Local search quality may differ from premium search engines (Google, Bing, etc.)
- Requires running SearXNG (Docker included) and optionally Jina Reader
- First-time setup takes ~2 minutes

---

## Quick Start

Get running in under 5 minutes with Docker (recommended).

### Prerequisites

- **Docker** (Compose V2 — `docker compose`, not `docker-compose`)
- **Node.js** >= 18
- **pnpm** >= 8 (or npm/yarn)

### Install and Run

```bash
# 1. Clone and install
git clone <your-repo-url>
cd local-ai-researcher
pnpm install

# 2. Build
pnpm build

# 3. Start (launches SearXNG automatically, then the MCP server)
pnpm start:docker
```

That's it. The server is now listening on stdio for MCP commands.

**What just happened:**
- SearXNG Docker container started (web search provider)
- MCP server started and connected to SearXNG
- Server is ready to receive tool calls via MCP stdio

**To stop SearXNG:**
```bash
bash scripts/stop.sh
```

**Using your own SearXNG instance?** See [Bring Your Own SearXNG](#bring-your-own-searxng).

---

## OpenCode Integration

Add local-ai-researcher to your `opencode.json`:

```json
{
  "mcpServers": {
    "local-researcher": {
      "command": ["bash", "/absolute/path/to/local-ai-researcher/scripts/start.sh"],
      "env": {
        "LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS": "true",
        "LOCAL_RESEARCHER_SEARXNG_ENDPOINT": "http://localhost:8080"
      }
    }
  }
}
```

**Important:** Replace `/absolute/path/to/local-ai-researcher` with the actual path on your machine.

Restart OpenCode. Your AI agent now has access to:
- `local-researcher_search` — web search
- `local-researcher_search_dork` — operator-heavy discovery with Google forced through local SearXNG
- `local-researcher_read` — content extraction
- `local-researcher_scrape_page` — scrape one known page for data-oriented extraction
- `local-researcher_scrape_listing` — scrape listing/category/search-result pages into repeated records
- `local-researcher_scrape_many` — scrape many known URLs in parallel
- `local-researcher_browser_unlock` — opt-in local-browser bot-check clearance (never returns cookies)
- `local-researcher_crawl_start` / `crawl_status` / `crawl_control` / `crawl_results` — background crawls that run in the sidecar
- `local-researcher_gather` — search + read in one call
- `local-researcher_health` — verify connectivity

### Using a custom Jina Reader endpoint

If you're running your own Jina Reader instance:

```json
{
  "mcpServers": {
    "local-researcher": {
      "command": ["bash", "/absolute/path/to/local-ai-researcher/scripts/start.sh"],
      "env": {
        "LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS": "true",
        "LOCAL_RESEARCHER_SEARXNG_ENDPOINT": "http://localhost:8080",
        "LOCAL_RESEARCHER_JINA_READER_ENDPOINT": "http://localhost:3000/"
      }
    }
  }
}
```

---

## Tools Overview

Tools for research workflows:

### `search` — Web search via SearXNG

**When to use:** You need to discover relevant URLs or source pages.

```json
{
  "query": "privacy-focused search engines",
  "limit": 5,
  "content_mode": "full"
}
```

Returns URLs, titles, excerpts, and metadata. This is the discovery step, not the best final tool for collecting marketplace/listing records.

### `search_dork` — Operator-heavy discovery with Google forced

**When to use:** You want site-restricted or dork-style discovery such as `site:`, quoted phrases, `inurl:`, or `intitle:` and your local SearXNG instance has Google enabled.

```json
{
  "query": "site:facebook.com/marketplace \"ASUS Zenbook Duo UX8406\" Philippines",
  "limit": 10
}
```

Returns candidate URLs and snippets for discovery. This is for finding pages, not for scraping listing records directly.

### `read` — Content extraction from URLs

**When to use:** You have a URL and want to understand the page as prose: summarize it, explain it, or read article/docs content.

```json
{
  "url": "https://example.com/article",
  "content_mode": "full"
}
```

Extracts clean text via Jina Reader. If you mainly want fields, prices, or repeated items rather than prose understanding, use one of the scraping tools instead.

### `scrape_page` — Scrape one known page for data

**When to use:** You already have one page URL and want facts from that page rather than a prose summary.

```json
{
  "url": "https://example.com/product/widget-1",
  "entity_type": "product",
  "fields": ["title", "price", "availability", "rating"],
  "goal": "collect the core product facts"
}
```

Returns structured page data, sections, records, and field candidates. This is for one detail page at a time. In the preferred distribution path, this lane comes online automatically when Docker is available and the optional Scrapling sidecar starts successfully.

#### Fetching hard pages (auth, stealth, egress) — all Scrapling tools

`extract`, `scrape_page`, `scrape_listing`, and `scrape_many` share these
optional controls for pages that block normal fetches:

| Field | Purpose |
|-------|---------|
| `cookies` | Fetch **behind a sign-in wall** as a logged-in user. Accepts a `{name: value}` map, a raw `"k=v; k2=v2"` Cookie-header string, or a list of cookie objects. |
| `mode` | Leave `auto`: the server escalates static → browser → stealth browser by itself and reports what happened in `access`. Forcing `"stealth"` etc. is a debugging override (no escalation). |
| `max_tier` | Highest tier the server may escalate to (default `stealth`). |
| `headers` | Extra request headers (e.g. custom User-Agent/Referer). |
| `proxy` | Route this fetch through an egress proxy (`http://host:port`). |
| `direct: true` | Force **direct egress (no proxy)** so a cookie'd session stays on one consistent IP — avoids multi-IP fraud flags / re-login prompts. |

```json
{
  "url": "https://site.example/members/dashboard",
  "cookies": "session=abc123; auth_token=xyz",
  "direct": true,
  "goal": "read the member-only content"
}
```

### `scrape_listing` — Scrape repeated records from one listing page

**When to use:** You have one page that shows many similar items and you want the visible cards/rows as records.

```json
{
  "url": "https://example.com/jobs",
  "entity_type": "job",
  "fields": ["title", "company", "location", "url"],
  "goal": "collect the visible job cards from this page"
}
```

Returns repeated records with URLs, titles, text, and field candidates. This is the right default for marketplaces, job boards, directories, and browse pages.

### `scrape_many` — Scrape many known URLs in parallel

**When to use:** You already have multiple candidate URLs and want to enrich them consistently.

```json
{
  "urls": [
    "https://example.com/jobs/1",
    "https://example.com/jobs/2"
  ],
  "entity_type": "job",
  "fields": ["title", "company", "location", "compensation"],
  "goal": "capture the key job details from each page"
}
```

Returns per-URL page results plus success/failure summary metadata.

### `crawl_start` / `crawl_status` / `crawl_control` / `crawl_results` — Background crawls

**When to use:** tens to thousands of pages on one site. The crawl runs inside
the Scrapling sidecar container — not in the MCP process — so it continues after
the agent session ends and resumes after a restart.

```json
{
  "start_urls": ["https://docs.example.com/"],
  "allow": "docs\\.example\\.com/guide/",
  "max_pages": 500,
  "max_depth": 4,
  "extract": "text"
}
```

`crawl_start` returns a job id at once. `crawl_status` reports `state`
(queued · running · rate_limited · paused · done · failed · cancelled) and counts;
`crawl_results` pages through items (`cursor` / `next_cursor`); `crawl_control`
pauses, resumes, or cancels. Crawls obey robots.txt, stay on the start site
unless `allow` is given, refuse private-network hosts, go through the same
escalation and host holds as single scrapes, and wait out rate limits by
themselves. One browser-capable crawl runs at a time (plus two `max_tier:
"static"` crawls); others queue. Results are deleted 14 days after a crawl ends.

### `browser_unlock` — Local browser bot-check clearance (opt-in)

```json
{ "url": "https://example.com/challenged-page" }
```

With `LOCAL_RESEARCHER_BROWSER_COOKIES=auto`, opens the URL in your local Brave
profile and waits for a **new** `cf_clearance` cookie. Complete the check in the
opened tab. Returns only `{captured, status, domain, hint}` inside the normal
envelope — never cookies. `captured` means fresh clearance was observed, **not**
that the site accepted a subsequent fetch. Retry scraping once; if refused, use
another source. A host cooldown prevents opening or reading cookies, even for
this explicit tool. Off means no action, including explicit calls.

The automatic path is shared by `extract`, `scrape_page`, `scrape_listing`, and
each page of `scrape_many`: **only a final `bot_challenge`** triggers one static,
direct-egress retry with existing local clearance cookies and the configured UA
and TLS impersonation. If still challenged, it opens one tab per registrable
domain concurrently within this MCP provider, polls for a clearance created
after opening, then retries once with fresh cookies. There is no retry loop.
Other outcomes (especially `rate_limited`, `forbidden`, `auth_required`) never
trigger this flow, including when they arrive on the first cookie retry.
Background crawl jobs do not use host-browser unlock.

### `gather` — Search + parallel reads (recommended)

**When to use:** You want a research query answered with full context from multiple sources. This is the signature convenience path.

```json
{
  "query": "benefits of local-first AI",
  "maxResults": 5,
  "content_mode": "full",
  "dedup": true
}
```

**What it does:**
1. Searches SearXNG
2. Deduplicates URLs
3. Reads all results in parallel
4. Returns a normalized envelope with a pre-formatted synthesis block ready for LLM insertion

**Why use it:** One call instead of `search` + multiple `read` calls. Built-in dedup, parallel execution, and structured output.

### `health` — Verify provider connectivity

**When to use:** Troubleshooting or verifying the server is ready.

```json
{
  "provider": "all"
}
```

Returns status for SearXNG, Jina Reader, and optional Docker-backed Scrapling, plus provider governance/version visibility.

## AI Routing Rule Of Thumb

- use `search` to **discover candidate pages**
- use `read` when the expected output is **understanding prose**
- use `scrape_page` when the expected output is **facts from one known detail page**
- use `scrape_listing` when the expected output is **repeated records from one page**
- use `scrape_many` when the expected output is **the same enrichment across many known URLs**
- use `crawl_start` when you need **a whole site section** (more pages than you can list), and come back for results

Example pattern:

- broad topic research → `search` + `read` or `gather`
- cheapest used ThinkPad in the Philippines → `search` to find marketplace pages, then `scrape_listing`, then `scrape_many` for the cheapest candidates

---

## Verification & Troubleshooting

### Verify the server is ready

After starting, call the `health` tool:

```json
{ "tool": "health", "params": { "provider": "all" } }
```

**Healthy response:**
```json
{
  "ok": true,
  "result": {
    "status": "healthy",
    "mcp": {
      "servers": [
        { "name": "SearXNG", "status": "connected", "latency_ms": 12 },
        { "name": "Jina Reader", "status": "connected", "latency_ms": 45 },
        { "name": "Scrapling", "status": "connected", "latency_ms": 91, "optional": true }
      ]
    },
    "provider_governance": {
      "manifest_loaded": true,
      "tracked_providers": 3
    }
  }
}
```

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| SearXNG `status: "unavailable"` | SearXNG not running | Run `pnpm start:docker` or `bash scripts/start.sh` |
| SearXNG `status: "degraded"`, `error_code: "ERR_SEARXNG_JSON_UNSUPPORTED"` | Instance answers `/healthz` but `format=json` returns non-JSON (common on public fallback instances) | Expected for `fallback1`/`fallback2` if the public instance has disabled its JSON API that day; not usable as a JSON search source right now |
| SearXNG `status: "degraded"`, `error_code: "ERR_SEARXNG_LOW_QUALITY"` | Canary search returned zero results (engine CAPTCHA/rate-limited) or a junk-domain hit | Check the router/instance's engine health; see "Bring Your Own SearXNG" below |
| SearXNG `error_code: "ERR_SSRF_BLOCKED"` | SSRF protection blocking localhost | Set `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true` |
| Jina Reader `status: "unavailable"` | Reader endpoint unreachable | Check `LOCAL_RESEARCHER_JINA_READER_ENDPOINT` (default: `https://r.jina.ai/`) |
| Scrapling `status: "unavailable"` | Optional Scrapling sidecar not running | Ensure Docker is available or set `LOCAL_RESEARCHER_SCRAPLING_ENABLED=required` to fail fast |
| Server exits with `ConfigError` | Invalid environment variable | Check stderr for the flagged variable |

### Logs

All logs go to **stderr** (stdout is reserved for MCP protocol). To see logs:

```bash
# If running directly
node dist/index.js 2>&1 | less

# In OpenCode, check the MCP server logs panel
```

Set `LOCAL_RESEARCHER_LOG_LEVEL=debug` for verbose output.

---

## Bring Your Own SearXNG

If you already run SearXNG (or want to use a remote instance):

### Recommended: point at a resilient router, not raw SearXNG

A bare SearXNG on a datacenter/VPS IP will periodically return **HTTP 200 with
zero results** when a search engine CAPTCHA/rate-limit-blocks its IP — which
surfaces here as *"No search results found."* To avoid silent failures, point
`SEARXNG_ENDPOINT` at a front-door **resilient router** that adds:

- rotating free-proxy fallback (round-robin over health-checked proxies),
- direct-tier rate limiting to protect your real IP,
- tiered failover with `0 results = failure` detection,
- a bounded in-request retry ladder (direct → direct, all engines → proxied).

The router rotates engines per query. Don't put `engines=` on the endpoint URL:
any caller-specified engine list makes it skip rotation. (This server only
sends `engines=` when a tool forces one, e.g. `search_dork`.)

```bash
export LOCAL_RESEARCHER_SEARXNG_ENDPOINT="http://localhost:8899"  # the router
```

Reference implementation (two-instance SearXNG + Go router + proxy rotation):
**https://github.com/betamax-tech/searxng-resilient-router**

### Prerequisites

- Node.js >= 18
- Running SearXNG instance with JSON API enabled
- Jina Reader endpoint (self-hosted or `https://r.jina.ai/`)

### Configure and run

```bash
# 1. Install and build
pnpm install
pnpm build

# 2. Configure environment
export LOCAL_RESEARCHER_SEARXNG_ENDPOINT="http://your-searxng-host:8080"
export LOCAL_RESEARCHER_JINA_READER_ENDPOINT="https://r.jina.ai/"
export LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS="true"  # if SearXNG is on localhost/private network

# 3. Run
node --no-warnings dist/index.js
```

---

## Configuration

### Provider governance manifest

`provider-manifest.json` is the canonical repo-tracked record of expected provider/runtime versions for SearXNG, Jina Reader, and Scrapling.

- update it when you upgrade a provider runtime
- use `health` to compare detected vs expected versions where available
- keep operator-managed Jina deployment details current even if the endpoint itself does not expose a machine-readable version

### Environment variables

All variables accept the `LOCAL_RESEARCHER_` prefix (canonical) or bare names (legacy).

#### SearXNG Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SEARXNG_ENDPOINT` | `http://localhost:8080` | SearXNG base URL |
| `LOCAL_RESEARCHER_SEARXNG_TIMEOUT` | `10000` | Request timeout (ms) |
| `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS` | `false` | **Set `true` for localhost/private SearXNG** (bypasses SSRF protection) |
| `LOCAL_RESEARCHER_SEARXNG_API_KEY` | _(empty)_ | API key if required |
| `LOCAL_RESEARCHER_SEARXNG_FALLBACK_1_ENDPOINT` | `https://searx.party/` | First public fallback (`provider: "fallback1"`) |
| `LOCAL_RESEARCHER_SEARXNG_FALLBACK_2_ENDPOINT` | `https://search.sapti.me/` | Second public fallback (`provider: "fallback2"`) |

**How `provider: "auto"` (the default) picks an instance.** It searches the
local endpoint first and moves to the next instance only when that search
*fails* (connection error, timeout, 5xx, bad response). A failed instance is
skipped for 30 s. If every instance fails, the error lists each one's own
error (`#0 SearxNG: … | #1 SearxNG: …`). 4xx answers are not retried — public
instances answer automated clients with 429, and an immediate retry only
extends the limit. Public fallbacks see your queries: set the two fallback
endpoints to empty strings to keep searches local-only.

**Health (`health` tool) is quality-aware, not just reachability-aware.**
`GET /healthz` only proves an instance answers below 500; it says nothing
about whether `format=json` actually works or whether the results are junk.
Every live SearXNG instance (local + both public fallbacks) also runs a
canary search and only reports `connected` when that canary (a) returns
valid JSON, (b) returns at least one result, and (c) none of the results
match a known junk domain. A reachable instance that fails any of those
checks reports `status: "degraded"` with `error_code` set to
`ERR_SEARXNG_JSON_UNSUPPORTED` (format=json unsupported — common on public
instances) or `ERR_SEARXNG_LOW_QUALITY` (zero results or a junk-domain hit).
This does not change search routing (`auto` already fails over on a real
search error, not a health pre-probe) — it only makes the `health` tool's
report, and the legacy `FallbackSearchProvider`'s fallback guard, reflect
actual usability instead of bare reachability.

#### Jina Reader Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_JINA_READER_ENDPOINT` | `https://r.jina.ai/` | Jina Reader base URL |
| `LOCAL_RESEARCHER_JINA_READER_TIMEOUT` | `15000` | Request timeout (ms) |
| `LOCAL_RESEARCHER_JINA_READER_API_KEY` | _(empty)_ | API key if required |

#### Scrapling Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SCRAPLING_ENABLED` | `auto` | `disabled` \| `auto` \| `required` for the optional Scrapling lane |
| `LOCAL_RESEARCHER_SCRAPLING_ENDPOINT` | `http://127.0.0.1:8090` | Scrapling sidecar endpoint (local or trusted tailnet host) |
| `LOCAL_RESEARCHER_SCRAPLING_BOOTSTRAP_WITH_DOCKER` | `true` | Launch a local sidecar only for a loopback endpoint and when Docker is available |
| `LOCAL_RESEARCHER_SCRAPLING_TIMEOUT` | `120000` | Extraction timeout (ms). The sidecar gets this minus 5 s as its escalation budget |
| `LOCAL_RESEARCHER_SCRAPLING_ALLOW_PRIVATE_NETWORKS` | `false` | Allow private-network extraction targets |
| `LOCAL_RESEARCHER_SCRAPLING_DEFAULT_MODE` | `auto` | Default extraction mode: `auto` \| `static` \| `dynamic` \| `stealth` |
| `LOCAL_RESEARCHER_SCRAPLING_PROXY` | _(empty)_ | Default egress proxy for Scrapling fetches (per-request `direct: true` overrides) |

#### Host browser clearance (optional)

All actions are **off by default**. When enabled, the MCP process runs
`python3 scripts/browser_cookies.py --url URL` on the host. Install
`scripts/browser-cookies-requirements.txt` in the Python environment whose
`python3` is on the MCP process PATH (a virtual environment is recommended).
Brave, its selected local profile, and Linux Secret Service must be available
in that host session; nothing is mounted into Docker. Missing dependencies or
locked/unavailable profile/keyring produce sanitized failure guidance. Cold
start with the feature off does not run Python or require these dependencies.

| Variable | Default | Description |
|---|---|---|
| `LOCAL_RESEARCHER_BROWSER_COOKIES` | `off` | `off` or `auto`; explicit consent to read clearance cookies and potentially open tabs |
| `LOCAL_RESEARCHER_BROWSER_USER_DATA_DIR` | helper: `~/.config/BraveSoftware/Brave-Origin` | Optional browser user-data root, used for helper reads and browser launch |
| `LOCAL_RESEARCHER_BROWSER_PROFILE` | `Profile 1` | Single profile directory name, not a path |
| `LOCAL_RESEARCHER_BROWSER_CMD` | `brave-origin-stable` | One executable name/path, never shell text or extra flags |
| `LOCAL_RESEARCHER_BROWSER_UA` | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36` | UA sent on cookie retries; configure to match the browser |
| `LOCAL_RESEARCHER_BROWSER_UNLOCK_WAIT` | `120` | Poll window in seconds (1–3600); an in-flight bounded helper read can finish after it |
| `LOCAL_RESEARCHER_BROWSER_IMPERSONATE` | `chrome131` | Static Fetcher TLS impersonation for cookie retries |

Only the helper's default Cloudflare cookie subset is read, not full authenticated
domain sessions. Cookies and helper stdout stay in memory; child stderr and raw
credential-request exceptions are never forwarded to logs or MCP errors. Cookie
retries remove the configured/request proxy: use a trusted sidecar with the same
public egress IP as the host browser, or clearance may fail. The sidecar receives
these credentials — do not point it at an untrusted service.

Browser targets must be public HTTP(S), without URL credentials. Browser checks
fail closed on DNS failure and private/mixed answers; public dual-stack DNS is
supported (IPv6 must be global unicast, excluding special-use ranges). Sidecar redirect behavior is unchanged;
the host browser follows its normal navigation policy after initial validation.

For **cookie-only live testing without ever opening a tab**, construct
`ScraplingProvider(config, httpClient, logger, { allowOpen: false })` in the internal
test/probe harness. This is not a public environment variable: it permits the
existing-cookie retry but returns `open_disabled` at the unlock stage. Normal MCP
startup does not set this override. Automated tests inject all browser/helper
dependencies and never read live cookies or open tabs.

**Distribution behavior:**

```bash
# Default / preferred distribution path
# - no host Python install required
# - startup script will launch the optional sidecar when Docker is available
LOCAL_RESEARCHER_SCRAPLING_ENABLED=auto \
bash scripts/start.sh
```

### Sharing a development sidecar over Tailscale

On the sidecar host, set `SCRAPLING_BIND_ADDR` to **that host's Tailscale IPv4**
(for example `100.100.10.20`) and optionally `SCRAPLING_HOST_PORT=8091`, then
start the `scrapling` Compose profile using your normal operator workflow.
These two variables are Compose-only (no `LOCAL_RESEARCHER_` prefix); they
default to `127.0.0.1` and `8090`. The container still listens on port 8090.
Changing the published binding requires recreating the container.

**Never bind to `0.0.0.0` or a public interface. The sidecar has no authentication**
and exposes scraping, host-memory, and crawl-job controls. Limit tailnet ACLs to
trusted development clients; do not publish it through a public proxy or tunnel.

On a client, configure:

```bash
export LOCAL_RESEARCHER_SCRAPLING_ENDPOINT=http://100.100.10.20:8091
export LOCAL_RESEARCHER_SCRAPLING_BOOTSTRAP_WITH_DOCKER=false
bash scripts/start.sh
```

Bare legacy `SCRAPLING_ENDPOINT` and `SCRAPLING_BOOTSTRAP_WITH_DOCKER` work too;
canonical prefixed variables take precedence. Startup never launches local
Scrapling for a non-loopback endpoint, or when bootstrap is `false`. SearXNG's
existing startup behavior is unchanged. Required mode reports health errors for
the configured provider rather than demanding local Docker for a remote sidecar.
The `100.64.0.0/10` allowance is **sidecar transport only**: scrape targets in
that range remain blocked, including with `SCRAPLING_ALLOW_PRIVATE_NETWORKS=true`.

**Access outcomes and automatic escalation.** Every Scrapling result (MCP tools
and sidecar alike) carries an `access` block:

```jsonc
"access": {
  "outcome": "rate_limited",   // ok | js_required | bot_challenge | rate_limited | forbidden
                               // | auth_required | not_found | server_error | network
  "upstream_status": 429,      // the site's own HTTP status (null: no request was made)
  "tier": "static",            // static | dynamic | stealth — tier that produced the result
  "tried": ["static"],
  "retry_after_s": 3600,       // rate_limited only
  "from_memory": false,        // true: refused from the host hold, no request sent
  "next": "Rate limited. Do not request example.com again for 3600s — with any tool or mode. …"
}
```

With `mode: "auto"` (the default) the sidecar escalates by itself: static →
dynamic when a 2xx page is near-empty (needs JavaScript), → stealth on a bot
challenge or an unmarked 403, never past `max_tier` (default `stealth`) and
never past the request's time budget. It remembers per host the lowest tier
that worked and starts there next time. A forced `mode` (`static` / `dynamic` /
`stealth`) fetches exactly that tier.

Rate limits (HTTP 429, Cloudflare 1015) are never retried or escalated. The host
goes on a hold — `Retry-After` if sent, else 1 h (12 h for a Cloudflare 1015),
doubling on repeats within 7 days, max 48 h — persisted in the `scrapling-state`
volume. Until it ends, every request for that host, from any tool or caller,
returns `rate_limited` without touching the network. Challenge markers only
count in the page title or on near-empty pages, so an article that quotes
"Just a moment" is not misread as a challenge.

Stealth is light by default: `disable_resources: true` (no images, fonts,
media, stylesheets) and `network_idle: false`. A full browser load pulls dozens
of same-host assets and rate-limit rules count each one.

**Sidecar HTTP API (for direct callers, e.g. background crawlers).** The MCP
tools wrap these; other programs may call them directly on `127.0.0.1:8090`.

| Endpoint | Body (JSON) | Notes |
|---|---|---|
| `GET /health` | — | `status`, `detected_version` |
| `POST /scrape-page` (alias `/extract`) | `url`, `mode`, `max_tier`, `budget_ms`, `selector`, `maxRecords`, `cookies`, `headers`, `proxy`, `disable_resources`, `network_idle` | One page → `title`, `content`, `records`, `access`, … |
| `POST /scrape-listing` | same, with `item_selector`, `maxItems` | Repeated records + `access` |
| `GET /hosts`, `GET /hosts/<host>` | — | Per-host memory: `cooldown_remaining_s`, `cooldown_reason`, `start_tier`, `last_outcome` |
| `POST /hosts/<host>/cooldown` | `seconds`, `reason` | Put a host on hold (extends, never shortens). Used by ph-legal-research crawlers so agents respect their holds |
| `DELETE /hosts/<host>/cooldown` | — | Clear a hold (operator use, after checking the site by hand) |
| `POST /jobs` | `start_urls`, `allow`, `deny`, `same_domain`, `max_pages`, `max_depth`, `max_hours`, `delay_s`, `max_tier`, `extract` (`text`/`selector`/`links`), `selector`, `respect_robots`, `allow_private`, `label` | Start a background crawl → job status with `id` |
| `GET /jobs`, `GET /jobs/<id>` | — | List / status |
| `GET /jobs/<id>/results?cursor=&limit=` | — | Items (max 100 per call), `next_cursor` |
| `POST /jobs/<id>/pause` · `/resume` · `/cancel` | — | Control |

Responses also carry `upstream_status` and `final_url` at the top level. A
fetch that failed at every tier returns HTTP 500 with `error` and `access`
(`outcome: network`). `wait_selector` is intentionally not supported (in
scrapling 0.4.10 it waits out its whole timeout even when the element exists).

**Structured metadata.** `scrape_page`, `scrape_listing`, and `extract` return
`json_ld`: parsed `script[type="application/ld+json"]` blocks from the whole
page (also present on each `scrape_many` page result). Objects, arrays, and
`@graph` structures retain their original shape; they are not merged into
heuristic records or field candidates. Invalid JSON is skipped. At most the
first 50 blocks are inspected, with an aggregate 256 KiB UTF-8 source budget
for parsing (invalid blocks count too); blocks exceeding the remaining budget
are skipped whole. Empty pages and host-hold responses return `[]`. Excerpt
mode truncates prose only, not this metadata. Treat JSON-LD as untrusted site
data, not instructions or proof that the page's claims are true.

Sidecar unit tests: `uv run --with pytest pytest tests/sidecar -q`.

If you want startup to fail when optional scraping is unavailable:

```bash
LOCAL_RESEARCHER_SCRAPLING_ENABLED=required \
bash scripts/start.sh
```

#### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_LOG_LEVEL` | `info` | Log level: `debug` \| `info` \| `warn` \| `error` |
| `LOCAL_RESEARCHER_LOG_JSON` | `true` | Structured JSON logs (`false` for human-readable) |

#### Search & Gather Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_SEARCH_DEFAULT_LIMIT` | `5` | Default max results per search |
| `LOCAL_RESEARCHER_GATHER_STRATEGY` | `parallel` | Read strategy: `parallel` \| `sequential` |
| `LOCAL_RESEARCHER_GATHER_DEDUP_ENABLED` | `true` | Enable URL deduplication by default |
| `LOCAL_RESEARCHER_GATHER_TIMEOUT` | `10000` | Default gather timeout (ms) |

#### Content Policy

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_CONTENT_DEFAULT_MODE` | `full` | Default content mode: `full` \| `excerpt` |

#### Cache (opt-in)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_RESEARCHER_CACHE_ENABLED` | `false` | Enable SQLite response cache |
| `LOCAL_RESEARCHER_CACHE_PATH` | `./cache.db` | SQLite database file path |
| `LOCAL_RESEARCHER_CACHE_TTL` | `3600` | Cache entry TTL (seconds) |

**Cache behavior:**
- Disabled by default
- Keyed per tool + query + options
- `bypass_cache: true` skips lookup and doesn't update cache
- `meta.cache_status` reports: `hit` \| `miss` \| `bypass` \| `disabled`

To enable:

```bash
LOCAL_RESEARCHER_CACHE_ENABLED=true \
LOCAL_RESEARCHER_CACHE_PATH=./cache.db \
LOCAL_RESEARCHER_CACHE_TTL=3600 \
node --no-warnings dist/index.js
```

---

## Security & Privacy

**Built-in protections (always active):**

| Protection | Description |
|-----------|-------------|
| **SSRF protection** | Blocks private network addresses by default. Allow with `LOCAL_RESEARCHER_SEARXNG_ALLOW_PRIVATE_NETWORKS=true` or `LOCAL_RESEARCHER_SSRF_ALLOWED_NETWORKS` (CIDR) |
| **stdout isolation** | All logs to stderr. stdout reserved for MCP protocol only. |
| **Redacted logs** | Sensitive fields (API keys, credentials) never logged |
| **Bounded timeouts** | Hard timeouts: SearXNG 10s, Jina Reader 15s, gather 10s total |
| **Bounded retries** | Max 2 retries with exponential backoff (max 5s) |
| **No telemetry** | Zero external analytics or tracking calls |

**Before production use:** Update `server.secret_key` in `searxng/settings.yml`:

```bash
openssl rand -hex 32
# Replace CHANGE_ME_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32
```

See [docs/SECURITY.md](docs/SECURITY.md) for full threat model.

---

## Tool Reference

### Response envelope

All tools return a normalized envelope:

```json
{
  "schema_version": "1",
  "ok": true,
  "meta": {
    "request_id": "<uuid>",
    "timestamp": "<ISO-8601>",
    "provider_id": "<string>",
    "provider_name": "<string>",
    "applied_limits": { "timeout_ms": 10000, "max_results": 5 },
    "cache_status": "disabled"
  },
  "result": { ... }
}
```

On error: `ok: false`, with `error: { code, message, retryable }`.

### `search`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` (1–500 chars) | required | Search query |
| `limit` | `integer` (1–50) | `5` | Max results |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Full page text or preview |
| `category` | `string` | — | SearXNG category (e.g., `'general'`, `'news'`) |
| `language` | `string` | — | Language code (e.g., `'en'`, `'de'`) |
| `timeRange` | `string` | — | Time filter (e.g., `'day'`, `'week'`, `'month'`) |
| `bypass_cache` | `boolean` | `false` | Skip cache lookup; cache not updated |

**Result (`result.results[]`):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Deterministic hash of source + URL + position |
| `url` | `string` | Canonical result URL |
| `title` | `string` | Page title |
| `excerpt` | `string` | Content preview or full text |
| `source` | `'web'` | Source type |
| `relevance` | `number` (0–1) | Relevance score (if available) |
| `date` | `string` | Publish date ISO string (if available) |

### `search_dork`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` (1–500 chars) | required | Operator-heavy discovery query, such as `site:` or quoted phrases |
| `limit` | `integer` (1–50) | `10` | Max results |
| `language` | `string` | — | Optional language code |

**Behavior:**

- forces the local SearXNG request to `engines=google`
- uses local SearXNG only; if local SearXNG is unavailable, returns a clear error
- intended for discovery, not for final record extraction

**Result:** same result envelope as `search`

### `read`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` (max 2000 chars) | required | URL to fetch and extract |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Full content or truncated preview |
| `targetWords` | `integer` (1–10000) | — | Target word count for excerpt |
| `language` | `string` | — | Language hint for Jina Reader |
| `bypass_cache` | `boolean` | `false` | Skip cache; cache not updated |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Source URL |
| `title` | `string` | Page title |
| `excerpt` | `string` | Content preview |
| `content` | `string` | Full text (default) |
| `content_mode` | `'full'` \| `'excerpt'` | Mode used |
| `content_truncated` | `boolean` | Whether content was truncated |
| `truncation` | `object` | Truncation details (if truncated) |
| `wordCount` | `integer` | Approximate word count |
| `duration` | `integer` | Extraction duration (ms) |

### `scrape_page`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` (max 2000 chars) | required | Known page URL to scrape |
| `entity_type` | `'generic'` \| `'product'` \| `'job'` \| `'company'` \| `'event'` \| `'property'` | `'generic'` | Entity-type hint derived from the task |
| `fields` | `string[]` | `[]` | Requested fields, such as price, company, location, rating, or date |
| `goal` | `string` | — | Natural-language scraping goal |
| `mode` | `'auto'` \| `'static'` \| `'dynamic'` | `'auto'` | Scrapling fetch mode |
| `selector` | `string` | — | Optional CSS selector for targeted extraction |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Full content or truncated preview |
| `targetWords` | `integer` (1–10000) | — | Target word count for excerpt mode |
| `maxRecords` | `integer` (1–200) | `25` | Max repeated records returned |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Source URL |
| `title` | `string` | Page title |
| `entity_type` | `string` | Entity-type hint used for extraction |
| `fields_requested` | `string[]` | Requested fields |
| `mode_used` | `'static'` \| `'dynamic'` | Actual fetch mode used |
| `goal` | `string` | Goal used (if any) |
| `excerpt` | `string` | Extracted preview |
| `content` | `string` | Full extracted text |
| `sections` | `array` | High-signal extracted sections |
| `records` | `array` | Repeated extracted records |
| `field_candidates` | `object` | Heuristic field candidates derived from the page |
| `content_truncated` | `boolean` | Whether excerpt mode truncated output |
| `wordCount` | `integer` | Approximate word count |
| `duration` | `integer` | Extraction duration (ms) |

### `scrape_listing`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` (max 2000 chars) | required | Listing/category/search-result page URL |
| `entity_type` | `'generic'` \| `'product'` \| `'job'` \| `'company'` \| `'event'` \| `'property'` | `'generic'` | Entity-type hint for repeated records |
| `fields` | `string[]` | `[]` | Requested fields for each record |
| `goal` | `string` | — | Natural-language scraping goal |
| `item_selector` | `string` | — | Optional CSS selector hint for item containers |
| `mode` | `'auto'` \| `'static'` \| `'dynamic'` | `'auto'` | Scrapling fetch mode |
| `maxItems` | `integer` (1–200) | `25` | Max records to return |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Source listing URL |
| `entity_type` | `string` | Entity-type hint used for extraction |
| `fields_requested` | `string[]` | Requested fields |
| `item_selector` | `string` | Item selector used or inferred |
| `records` | `array` | Repeated records with title/url/text/field candidates |
| `item_count` | `integer` | Number of returned records |
| `mode_used` | `'static'` \| `'dynamic'` | Actual fetch mode used |
| `duration` | `integer` | Extraction duration (ms) |

### `scrape_many`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `urls` | `string[]` (1–50) | required | Known detail-page URLs to scrape in parallel |
| `entity_type` | `'generic'` \| `'product'` \| `'job'` \| `'company'` \| `'event'` \| `'property'` | `'generic'` | Entity-type hint shared by the URLs |
| `fields` | `string[]` | `[]` | Requested fields for each page |
| `goal` | `string` | — | Shared scraping goal |
| `mode` | `'auto'` \| `'static'` \| `'dynamic'` | `'auto'` | Scrapling fetch mode |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Full content or preview per page |
| `targetWords` | `integer` (1–10000) | — | Target word count for excerpt mode |
| `maxRecords` | `integer` (1–200) | `10` | Max repeated records per page |
| `maxConcurrency` | `integer` (1–10) | `5` | Max parallel page scrapes |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `entity_type` | `string` | Shared entity-type hint |
| `fields_requested` | `string[]` | Requested fields |
| `results` | `array` | Per-URL page-scrape results |
| `failures` | `array` | URLs that failed with error messages |
| `summary.attempted` | `integer` | Total URLs attempted |
| `summary.succeeded` | `integer` | Successful page scrapes |
| `summary.failed` | `integer` | Failed page scrapes |
| `summary.totalDuration` | `integer` | Total elapsed time (ms) |

### `gather`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` (1–500 chars) | required | Research query |
| `maxResults` | `integer` (1–20) | `5` | Max search results |
| `dedup` | `boolean` | `true` | Enable URL deduplication |
| `content_mode` | `'full'` \| `'excerpt'` | `'full'` | Content mode for reads |
| `timeout` | `integer` (1000–60000) | `10000` | Total timeout (ms) |
| `bypass_cache` | `boolean` | `false` | Skip cache for all operations |

**Result:**

| Field | Description |
|-------|-------------|
| `id` | Request-scoped unique ID |
| `prompt` | Original query |
| `context.sources` | Source descriptors (type + URL) |
| `context.results` | Search results (same shape as `search`) |
| `context.reads` | Extracted content (same shape as `read`) |
| `context.dedupStats` | `{ total, deduped }` — dedup statistics |
| `synthesis` | Pre-formatted markdown block for LLM insertion |
| `summary.totalResults` | Total search results |
| `summary.attemptedReads` | URLs attempted (after dedup) |
| `summary.successfulReads` | Successful reads |
| `summary.failedReads` | Failed reads (non-fatal per-URL errors) |
| `summary.totalDuration` | Total elapsed time (ms) |

### `health`

**Input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `'searxng'` \| `'jinaReader'` \| `'scrapling'` \| `'all'` | `'all'` | Provider(s) to probe |

**Result:**

| Field | Description |
|-------|-------------|
| `status` | `'healthy'` \| `'degraded'` \| `'unhealthy'` |
| `mcp.stdio.ready` | Whether stdio transport is active |
| `mcp.stdio.version` | MCP server version |
| `mcp.servers[]` | Per-provider: `name`, `provider_id`, `status`, `latency_ms`, `error`, `error_code`, optional version/runtime metadata |
| `provider_governance` | Manifest load status and tracked provider count |
| `resources.memoryMB` | RSS memory (MB) |
| `resources.cwd` | Working directory |
| `timestamp` | ISO-8601 timestamp |

---

## Advanced Topics

### SearXNG Lifecycle Plugin (Optional)

Auto-manage SearXNG Docker lifecycle tied to OpenCode sessions:

```bash
# Install plugin
cp plugin/searxng-lifecycle.ts ~/.config/opencode/plugin/

# Set required env var
export LOCAL_RESEARCHER_COMPOSE_FILE="/absolute/path/to/local-ai-researcher/docker-compose.yml"

# Restart OpenCode
```

**Behavior:**
- First session opens → `docker compose up -d searxng`
- Last session closes → `docker compose down`

Without plugin: SearXNG stays running after OpenCode closes.

### Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript → dist/
pnpm typecheck        # Type check (no emit)
pnpm dev              # Watch mode
pnpm test             # Run tests
pnpm start            # Start MCP server (after build)
```

### Architecture

```
src/
├── index.ts              # MCP stdio entrypoint
├── config.ts             # Environment loading and validation
├── domain/types.ts       # Core domain types and schema
├── lib/                  # Utilities (logger, HTTP, SSRF, cache, errors)
├── providers/            # SearXNG and Jina Reader clients
├── tools/                # MCP tool implementations (search, read, extract, gather, health)
└── docker/               # Optional runtime sidecars (e.g. Scrapling)
```

**Reference docs:**
- [docs/FOUNDATION.md](docs/FOUNDATION.md) — System boundaries
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Technical design
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — Type definitions
- [docs/SECURITY.md](docs/SECURITY.md) — Threat model

---

## License

MIT

# Access escalation + background crawl jobs — design (PROPOSED)

Status: **PROPOSED — needs approval before any code** (SPEC: no provider/packaging
scope expansion without updating canonical vault docs first).
Date: 2026-10-10. Origin: ph-legal-research crawler incidents of 2026-10-09/10.

## 1. Why

Evidence from one night of real use:

| What happened | What it shows |
|---|---|
| Manual stealth probing (~60 page loads, seconds apart) tripped Cloudflare **1015** on officialgazette.gov.ph → 24 h block | A stealth fetch is a full fresh browser load (`network_idle`, no resource blocking, new profile each time): every same-host asset counts toward the site's rate limit. Nothing told the caller "stop". |
| A court decision quoting *"Just a moment, Mr. Sheriff"* was classified as a Cloudflare challenge | Block detection by body text alone is wrong; real status codes + structure are needed. |
| `scrape_*` returned a 1015 page as normal content | The sidecar hid the upstream HTTP status (fixed 2026-10-10: `upstream_status` is now returned by the sidecar, not yet by MCP tools). |
| The `mode` description tells agents to use `stealth` on "403/CAPTCHA" | A 403 can be a rate limit or a WAF rule; escalating to a browser makes a rate limit *worse*. |
| Long crawls had to be built outside this MCP (systemd + custom queue) | There is no way for an agent to start a crawl and check on it later. |

SPEC's AI Interface Rule already says callers should not pick static / dynamic /
stealth themselves. This design makes that true: **the server escalates; the
agent reads an explicit outcome and follows the next step it is given.**

## 2. Goals / non-goals

Goals
1. Every scraping response says **how access went** in a fixed vocabulary.
2. The server **escalates automatically** when (and only when) escalation can help.
3. The server **refuses to escalate or retry** into rate limits, auth walls, robots rules — and remembers it per host, across agents.
4. Agents can **start a long crawl, poll it, pause/resume it, and page through results**; the crawl survives restarts and never runs inside the MCP process.

Non-goals
- Proxy rotation to evade rate limits (explicitly out of scope).
- Replacing project-specific crawlers that need domain validators (e.g. ph-legal `ingest`).
- Crawlee. Evaluated 2026-10-10: Scrapling 0.4.10 already ships Spider / CrawlSpider / SitemapSpider, checkpoint pause-resume, per-domain delays, robots.txt, blocked-request retry and session routing; its stealth browser (Camoufox) solves Cloudflare natively, which Crawlee does not document. Revisit only if a bake-off on real hard sites shows Crawlee clearly ahead on pass rate and requests/page.

## 3. Part A — access outcome + automatic escalation

### 3.1 The `access` block (additive to every Scrapling-backed tool result)

```jsonc
"access": {
  "outcome": "ok",              // see table
  "upstream_status": 200,
  "tier": "static",             // static | dynamic | stealth — the tier that produced this result
  "tried": ["static"],          // tiers attempted, in order
  "retry_after_s": null,        // set for rate_limited
  "next": null                  // one imperative sentence for the agent, or null
}
```

| `outcome` | Detected by | Server action | `next` (given to the agent) |
|---|---|---|---|
| `ok` | 2xx, real content | return | — |
| `js_required` | 2xx but near-empty body / SPA shell | escalate static → dynamic | — (handled) |
| `bot_challenge` | Challenge page (title or near-empty page with CF markers, 403/503 + challenge) | escalate → stealth (light, session per host) | if still blocked after stealth: "Site blocks automated access even with a browser; use another source." |
| `rate_limited` | 429, CF 1015 page | **no escalation, no retry**; record host cool-down | "Rate limited. Do not call this host again for {retry_after_s}s, with any tool or mode." |
| `forbidden` | 403 / 1020 that a browser did not fix | stop | "Access refused by the site (not a bot check). Use another source." |
| `auth_required` | 401, login redirect | stop | "Login required. Retry only with `cookies` for a session you are allowed to use." |
| `robots_disallowed` | robots.txt | stop | "The site disallows automated access to this path." |
| `not_found` | 404 / 410 | stop | — |
| `network` | DNS / connect / timeout | one retry | "Network or site down; try later." |

Classification reuses the detector that is proven in ph-legal `ingest`: markers
count **only in the page title or on near-empty pages** (< 3,000 visible chars),
rate-limit markers (`error code: 1015`, "you are being rate limited") are a
separate class from challenges.

### 3.2 Escalation ladder (server-side)

`static` → `dynamic` → `stealth`, climbing only on `js_required` / `bot_challenge`.
Stealth runs **light by default**: `disable_resources=true`, `network_idle=false`,
and one persistent `StealthySession` per host (Cloudflare clearance cookie and
cache reused, challenge solved once instead of per page).

### 3.3 Per-host memory (sidecar, persisted in the `scrapling-state` volume)

```jsonc
{"host": "www.officialgazette.gov.ph",
 "start_tier": "stealth",          // lowest tier that last worked → next call starts there
 "cooldown_until": 1791629268,     // set by rate_limited; every tool honors it
 "last_outcome": "rate_limited", "updated_at": "…"}
```

While a host is cooling down, every tool returns `rate_limited` immediately
**without a network request**. This is the piece that would have prevented the
1015 incident.

### 3.4 Tool-surface changes

- `mode`: kept as an expert override; default becomes "leave unset". New description:
  *"Leave unset — the server escalates static → browser → stealth by itself when a page needs it. Set only to force a tier for debugging."*
- New optional `max_tier` (`static` | `dynamic` | `stealth`, default `stealth`) for callers that must stay fast/cheap.
- Every tool description gains one shared paragraph (in `_fetchAuthSchema.ts`):
  *"Check `access.outcome`. If it is `rate_limited`, stop calling that host until `retry_after_s` has passed — with any tool or mode; switching tools does not help and extends the block. If `forbidden` / `auth_required` / `robots_disallowed`, do not retry; follow `access.next`."*

### 3.5 Contract impact

`access` is additive under `result`, but SRS says v1 behavior is contract-stable
unless a versioned change is approved and `v1-schema-freeze.test.ts` pins the
shape → this needs an explicit **v2.1 contract bump** (approve here).

## 4. Part B — background crawl jobs

### 4.1 Where it runs

In the **Scrapling sidecar container**, never in the MCP process (MCP processes
live per opencode session). Jobs use Scrapling's `Spider` with
`crawldir=/app/state/jobs/<id>/` (checkpointed: pending queue + seen set). Results
append to `/app/state/jobs/<id>/items.jsonl`. On container start, jobs left
`running` are resumed from their checkpoint.

### 4.2 Sidecar endpoints

| Endpoint | Purpose |
|---|---|
| `POST /jobs` | start: `start_urls`, `allow` (URL regex / same-domain default), `max_pages` (default 200, hard cap 5,000), `max_hours`, `delay_s` (min 1.0; default 2.0, 30.0 for stealth), `tier_cap`, `extract` (`text` \| `selector` + fields) → `{id}` |
| `GET /jobs/{id}` | status: `state` (queued/running/paused/rate_limited/done/failed), pages done / queued / blocked, items, last outcome, `retry_after_s`, started/updated |
| `POST /jobs/{id}/pause` · `/resume` · `/cancel` | pause writes a checkpoint |
| `GET /jobs/{id}/results?cursor=&limit=` | page through items |
| `GET /jobs` | list (most recent first) |

Rules: **one browser-tier job at a time** (1.5 GB container cap shared with
interactive scraping); static-tier jobs ≤ 2 concurrent; robots.txt obeyed;
`rate_limited` on any page → job state `rate_limited` until the host cool-down
ends, then resumes by itself; host cool-downs shared with Part A.

### 4.3 MCP tools

`crawl_start`, `crawl_status`, `crawl_pause`, `crawl_resume`, `crawl_results`
— thin wrappers over §4.2. `crawl_start` description: *"Starts a background
crawl and returns a job id immediately. Poll `crawl_status` (not more than
once a minute); fetch data with `crawl_results`. For one page use `scrape_page`;
for a handful of known URLs use `scrape_many`."*

## 5. Rollout

1. Part A sidecar: classification + `upstream_status` in tool results + host memory + light stealth session. (MCP v2.1 contract.)
2. Part A MCP: `access` block, description rewrite, `max_tier`.
3. Part B sidecar jobs + restart recovery.
4. Part B MCP tools.
Each step lands with tests and a live check against: example.com (ok), httpbin `/status/429` (rate_limited, no second request), a JS-only page (js_required → dynamic), a Cloudflare-fronted page (bot_challenge → stealth).

## 6. Open questions (for approval)

1. Approve the **v2.1 contract bump** (`access` block in results)?
2. ~~Default `max_tier`~~ — **DECIDED 2026-10-10: `stealth`.**
3. ~~Job results retention~~ — **DECIDED 2026-10-10: delete 14 days after a job finishes.**
4. Should ph-legal `ingest` later call sidecar host memory so its crawlers and agents share cool-downs? (Recommended: yes, read-only check before each og request.)

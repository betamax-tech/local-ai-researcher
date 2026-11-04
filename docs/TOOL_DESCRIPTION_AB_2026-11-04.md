# Tool-description A/B — 2026-11-04

**Question:** do the rewritten MCP tool descriptions make a model pick the right tool more often than the
previous ones, and do they avoid regressing any case?
**Answer:** yes. In the final round the old descriptions scored 57/63 (claude-haiku-5-5) and 58/63
(gpt-6-luna); the new ones scored **63/63 on both**. No probe got worse, and both held-out probes passed.

## Method

- The full 13-tool list (`name`, `description`, `inputSchema` exactly as `src/index.ts` serves it) went to
  the local auth2api proxy as `tools`, with `tool_choice` left on auto. We recorded the **first tool
  called**, or "no tool". Nothing was executed.
- The system prompt was a single neutral line ("research assistant with web tools; answer directly when no
  tool is needed"). Old and new arms ran interleaved in random order, with n=3 per (arm × model × probe).
- Models: `claude-haiku-5-5` (Anthropic Messages API) and `gpt-6-luna` (OpenAI Chat Completions). We picked
  smaller models on purpose because they lean more on descriptions.
- The harness and raw JSONL live in `tmp/tool-ab/`, which is gitignored and not committed (it reads the
  proxy key at runtime). To re-run it, dump the tool list from `dist/`, then run `ab.py old=… new=…`.

## Probes (user wording → expected first tool)

| ID | Prompt (abridged) | Expected |
|---|---|---|
| P01 | Find links to the Python 3.14 release notes and blog posts | `search` |
| P02 | Latest Philippine Senate headlines this week — just links | `search` |
| P03 | Research what experts say about intermittent fasting, with sources | `gather` |
| P04 | Overview with sources of how countries regulate e-scooters | `gather` |
| P05 | PDF annual reports on dof.gov.ph with "budget" in the title | `search_dork` |
| P06 | GitHub pages with "awesome-mcp" in the URL | `search_dork` |
| P07 | Summarize this article: <theverge URL> | `read` |
| P08 | What does this page say? <React SPA URL> "renders everything with JavaScript" | `read` |
| P09 | Price, star rating and stock status from <amazon URL> | `scrape_page` |
| P10 | Every job title, company and salary on <remoteok URL> | `scrape_listing` |
| P11 | Write a haiku about autumn leaves | no tool |
| P12 | What is 17 × 23? | no tool |
| P13 | Search failed with ERR_SEARXNG_UNAVAILABLE — are backends OK? | `health` |
| P14 | scrape_page got access.outcome 'bot_challenge'; I'm at my desk | `browser_unlock` |
| P15 | Collect every page under docs.example.org/guide/ (hundreds) | `crawl_start` |
| P16 | Who won the 2026 Australian Open men's final? | `search` |
| P17 | Find pages on gov.ph about solar net metering | `search` (site: alone ≠ dork) |
| P18 | Compare specs and prices of these 3 laptop URLs | `scrape_many` |
| P19 | Explain this doc page in plain terms: <react.dev URL> | `read` |
| P20 | *held out:* Excel spreadsheets about rice production on psa.gov.ph | `search_dork` |
| P21 | *held out:* pages on reddit.com discussing the Framework 16 | `search` |

P20 and P21 were written after round 3 and were never used to tune the wording.

## Final round (round 4: old vs shipped descriptions)

| Probe | Expected | old (haiku) | old (gpt) | new (haiku) | new (gpt) |
|---|---|---|---|---|---|
| P01–P04 | search / gather | 12/12 | 12/12 | 12/12 | 12/12 |
| P05 | search_dork | 2/3 (search×1) | 0/3 (search×3) | 3/3 | 3/3 |
| P06 | search_dork | 2/3 (search×1) | 3/3 | 3/3 | 3/3 |
| P07–P14 | read / scrape / none / ops | 24/24 | 24/24 | 24/24 | 24/24 |
| P15 | crawl_start | 2/3 (scrape_page×1) | 3/3 | 3/3 | 3/3 |
| P16–P19 | boundary | 12/12 | 12/12 | 12/12 | 12/12 |
| P20 | search_dork (held out) | 0/3 (search×3) | 1/3 (search×2) | 3/3 | 3/3 |
| P21 | search (held out) | 3/3 | 3/3 | 3/3 | 3/3 |
| **Total** | | **57/63** | **58/63** | **63/63** | **63/63** |

Parameter filling we observed with the new descriptions: P02 sets `category:"news"` and
`timeRange:"week"`, and P05 builds `site:dof.gov.ph filetype:pdf intitle:budget`.

## Iteration history (why the wording is what it is)

| Round | Arm | haiku | gpt | Finding |
|---|---|---|---|---|
| 1 | old vs v1 (P01–P15) | 39 → 45 /45 | 38 → 45 /45 | v1 fixed the dork tie-break and P08: old gpt sent the JS SPA to `scrape_page` 2/3 |
| 2 | old vs v1 (P16–P19) | 12 → **9** /12 | 11 → **9** /12 | **v1 regressed.** haiku sent a plain `site:` query to `search_dork` (v1's dork identity line named `site:`); gpt sent a 3-URL comparison to `read`/`scrape_page` |
| 3 | old vs v2 (P01–P19) | 52 → 57 /57 | 53 → **52** /57 | v2 fixed P17/P18 but gpt read "GitHub pages" as "pages on <site>" (P06 0/3) |
| 4 | old vs v3 (P01–P21) | 57 → 63 /63 | 58 → 63 /63 | Tie-break now keys on what the user asks for ("a file type, or a word in the URL/title → search_dork, even when a site is named"). Shipped. |

The confusion pair that mattered most was `search` vs `search_dork`. The old dork description
("operator-heavy… site-restricted or dork-style") gave no mechanical rule. Because `search` already
accepts operators, models defaulted to it. The rule that works lives in **both** descriptions and keys on
the user's request, not on the query syntax.

## Caveats

- n=3 per cell. Most probes hit the ceiling in both arms, so the evidence comes from the
  discriminating probes (P05, P06, P08, P15, P20). Treat this as a screening result, not a significance test.
- The wording went through three iterations against the same probes. P20 and P21 are the only held-out
  check against overfitting.
- The neutral system prompt does not reproduce any specific client (OpenCode, Open WebUI). A client
  prompt with its own routing rules can override these descriptions.

## Guard

`src/tools/tool-descriptions.test.ts` fails if a description loses its named tie-break, its trigger values
(`ERR_SEARXNG_UNAVAILABLE`, `'bot_challenge'`, …) or the 220-word budget. Re-run this A/B before
changing those.

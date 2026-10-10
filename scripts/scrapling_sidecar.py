#!/usr/bin/env python3
"""Scrapling HTTP sidecar for Local Researcher.

Endpoints:
- GET /health
- POST /extract           (compatibility alias)
- POST /scrape-page
- POST /scrape-listing
- GET  /hosts             per-host memory (cool-downs, remembered start tier)
- GET  /hosts/<host>
- POST /hosts/<host>/cooldown   {"seconds": n, "reason": "..."} — extend a hold
- DELETE /hosts/<host>/cooldown  clear a hold (operator use)
- POST /jobs                       start a background crawl (sidecar_jobs.py)
- GET  /jobs, GET /jobs/<id>, GET /jobs/<id>/results?cursor=&limit=
- POST /jobs/<id>/pause | /resume | /cancel

Every scrape response carries an ``access`` block (see sidecar_access.py).
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import platform
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import unquote, urljoin

import sidecar_access as access
import sidecar_jobs


PORT = int(os.environ.get("SCRAPLING_SIDECAR_PORT", "8090"))
HOST = os.environ.get("SCRAPLING_SIDECAR_HOST", "0.0.0.0")


def _word_count(text: str) -> int:
    stripped = text.strip()
    return len(stripped.split()) if stripped else 0


def _clean_text(text: str | None) -> str:
    if not text:
        return ""
    lines = [line.strip() for line in str(text).splitlines()]
    collapsed = [line for line in lines if line]
    return "\n".join(collapsed)


def _truncate_words(text: str, limit: int = 120) -> str:
    words = text.split()
    if len(words) <= limit:
        return text
    return " ".join(words[:limit]) + "..."


def _extract_attributes(element: Any) -> dict[str, str] | None:
    attrib = getattr(element, "attrib", None)
    if not attrib:
        return None
    try:
        data = {str(k): str(v) for k, v in dict(attrib).items()}
        return data or None
    except Exception:
        return None


def _node_text(node: Any) -> str:
    direct = _clean_text(getattr(node, "text", ""))
    if direct:
        return direct

    try:
        text_nodes = node.css("::text").getall()
        return _clean_text("\n".join(text_nodes))
    except Exception:
        return ""


def _pick_main_node(page: Any) -> Any:
    """<main> / role=main if present; a lone <article>; else <body>. Several
    <article>s are cards in a listing (e.g. product tiles), not the page."""
    for selector in ("main", "[role='main']"):
        try:
            matches = page.css(selector)
            if matches:
                return matches[0]
        except Exception:
            continue
    try:
        articles = page.css("article")
        if len(articles) == 1:
            return articles[0]
    except Exception:
        pass
    try:
        body = page.css("body")
        if body:
            return body[0]
    except Exception:
        pass
    return page


def _first_non_empty(node: Any, selectors: tuple[str, ...]) -> str | None:
    for selector in selectors:
        try:
            if selector.endswith("::text"):
                value = node.css(selector).get()
                if value and str(value).strip():
                    return _clean_text(str(value))
            else:
                matches = node.css(selector)
                if matches:
                    text = _node_text(matches[0])
                    if text:
                        return text
        except Exception:
            continue
    return None


def _first_href(node: Any, base_url: str) -> str | None:
    try:
        href = node.css("a::attr(href)").get()
        if not href:
            return None
        return str(urljoin(base_url, href))
    except Exception:
        return None


def _extract_price(text: str) -> str | None:
    match = re.search(r"(?:[$€£]|USD\s?|EUR\s?|GBP\s?)\s?\d[\d,]*(?:\.\d{2})?", text)
    return match.group(0) if match else None


def _extract_compensation(text: str) -> str | None:
    match = re.search(r"(?:[$€£]|USD\s?|EUR\s?|GBP\s?)\s?\d[\d,]*(?:\.\d{2})?(?:\s?(?:/hour|/hr|per hour|/year|per year|annually))?", text, re.I)
    return match.group(0) if match else None


def _field_candidates_from_text(text: str, entity_type: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    if entity_type in ("product", "property"):
        price = _extract_price(text)
        if price:
            fields["price"] = price
    if entity_type == "job":
        compensation = _extract_compensation(text)
        if compensation:
            fields["compensation"] = compensation
    return fields


def _field_candidates_from_node(node: Any, entity_type: str, base_url: str) -> dict[str, str]:
    text = _node_text(node)
    fields = _field_candidates_from_text(text, entity_type)

    title = _first_non_empty(node, ("h1::text", "h2::text", "h3::text", "a::text"))
    if title:
        fields["title"] = title

    url = _first_href(node, base_url)
    if url:
        fields["url"] = url

    if entity_type == "job":
        company = _first_non_empty(node, ("[class*='company']::text", "[data-testid*='company']::text"))
        location = _first_non_empty(node, ("[class*='location']::text", "[data-testid*='location']::text", "address::text"))
        if company:
            fields["company"] = company
        if location:
            fields["location"] = location
    elif entity_type == "event":
        date = _first_non_empty(node, ("time::text", "[class*='date']::text", "[data-testid*='date']::text"))
        location = _first_non_empty(node, ("[class*='location']::text", "address::text"))
        if date:
            fields["date"] = date
        if location:
            fields["location"] = location
    elif entity_type == "property":
        location = _first_non_empty(node, ("[class*='location']::text", "address::text"))
        if location:
            fields["location"] = location

    return fields


def _field_candidates_from_page(page: Any, entity_type: str, base_url: str, text: str) -> dict[str, str]:
    fields = _field_candidates_from_text(text, entity_type)
    title = _first_non_empty(page, ("h1::text", "title::text"))
    if title:
        fields["title"] = title
    fields["url"] = base_url

    if entity_type == "job":
        company = _first_non_empty(page, ("[class*='company']::text", "[data-testid*='company']::text"))
        location = _first_non_empty(page, ("[class*='location']::text", "address::text"))
        if company:
            fields["company"] = company
        if location:
            fields["location"] = location
    elif entity_type == "event":
        date = _first_non_empty(page, ("time::text", "[class*='date']::text"))
        location = _first_non_empty(page, ("[class*='location']::text", "address::text"))
        if date:
            fields["date"] = date
        if location:
            fields["location"] = location

    return fields


def _listing_selectors(entity_type: str) -> tuple[str, ...]:
    common = (
        "article",
        "[role='listitem']",
        "li",
        ".card",
        "[class*='card']",
    )
    if entity_type == "product":
        return ("[class*='product']", "[data-testid*='product']", ".product-card", *common)
    if entity_type == "job":
        return ("[class*='job']", "[data-testid*='job']", ".job-card", *common)
    if entity_type == "event":
        return ("[class*='event']", "[data-testid*='event']", ".event-card", *common)
    if entity_type == "property":
        return ("[class*='property']", "[data-testid*='property']", ".listing-card", *common)
    return common


def _best_listing_nodes(page: Any, entity_type: str, item_selector: str | None, max_items: int) -> tuple[str | None, list[Any]]:
    selectors = (item_selector,) if item_selector else _listing_selectors(entity_type)
    best_selector = None
    best_nodes: list[Any] = []

    for selector in selectors:
        if not selector:
            continue
        try:
            nodes = page.css(selector)
        except Exception:
            continue

        filtered = [node for node in nodes if _word_count(_node_text(node)) >= 3]
        if len(filtered) >= 2:
            best_selector = selector
            best_nodes = filtered[:max_items]
            break
        if len(filtered) > len(best_nodes):
            best_selector = selector
            best_nodes = filtered[:max_items]

    return best_selector, best_nodes


def _normalize_cookies(cookies: Any) -> Any:
    """Accept cookies as a dict {name: value}, a list of {name,value,domain?},
    or a raw 'k=v; k2=v2' header string. Return a form Scrapling accepts (dict)."""
    if not cookies:
        return None
    if isinstance(cookies, dict):
        return cookies
    if isinstance(cookies, str):
        out: dict[str, str] = {}
        for part in cookies.split(";"):
            part = part.strip()
            if not part or "=" not in part:
                continue
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
        return out or None
    if isinstance(cookies, list):
        # list of {name, value, ...} — keep as-is if items look like cookie objects,
        # otherwise coerce to a dict.
        if cookies and isinstance(cookies[0], dict) and "name" in cookies[0]:
            return cookies
        return None
    return None


def _browser_opts(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Opt-in per-request browser options (dynamic + stealth modes only).

    Defaults keep the historical behaviour. For long-running / polite crawls,
    callers should send ``disable_resources: true`` (no images, fonts, media,
    stylesheets) and ``network_idle: false`` — a full page load pulls dozens
    of same-host assets, and rate-limit rules count every one
    (officialgazette.gov.ph, Cloudflare 1015, 2026-10-09).

    ``wait_selector`` is deliberately not exposed: in scrapling 0.4.10 it waits
    out its full timeout even when the element exists (60 s on example.com's
    <h1>, dynamic and stealth alike; verified 2026-10-10).
    """
    payload = payload or {}
    opts: dict[str, Any] = {}
    if "disable_resources" in payload:
        opts["disable_resources"] = bool(payload["disable_resources"])
    if "network_idle" in payload:
        opts["network_idle"] = bool(payload["network_idle"])
    return opts


def _fetch_stealth(StealthyFetcher: Any, url: str, cookies, headers, proxy, browser_opts=None) -> Any:
    """Anti-detection fetch via Scrapling's StealthyFetcher (camoufox-based).
    Enables Cloudflare challenge solving + fingerprint hardening. This is the
    lane to use for bot-walled sites; it is heavier/slower than dynamic."""
    kwargs: dict[str, Any] = {
        "headless": True,
        # Light by default: no images/fonts/media/stylesheets, no wait for
        # network idle. Every asset of a full load counts toward the site's rate
        # limit. Callers may override both per request.
        "network_idle": False,
        "disable_resources": True,
        # anti-detection defaults
        "solve_cloudflare": True,   # auto-solve Cloudflare Turnstile/interstitials
        "block_webrtc": True,       # prevent WebRTC IP leak (esp. when using proxy)
        "block_ads": True,          # fewer 3rd-party trackers = smaller detection surface
        "google_search": True,      # arrive via a plausible Google referer
    }
    if cookies:
        kwargs["cookies"] = cookies
    if headers:
        kwargs["extra_headers"] = headers
    if proxy:
        kwargs["proxy"] = proxy
    kwargs.update(browser_opts or {})
    return StealthyFetcher.fetch(url, **kwargs)


class AccessStop(Exception):
    """No page could be produced (network error at every tier tried)."""

    def __init__(self, message: str, access_info: dict[str, Any]) -> None:
        super().__init__(message)
        self.access = access_info


HOSTS = access.HostMemory()


def _fetch_tier(tier: str, url: str, cookies: Any = None, headers: Any = None, proxy: Any = None,
                browser_opts: dict[str, Any] | None = None) -> Any:
    """One fetch at one tier: static (HTTP, no JS), dynamic (headless Chromium),
    stealth (Camoufox: anti-detection + Cloudflare solving, light by default)."""
    Fetcher, DynamicFetcher, StealthyFetcher = _load_fetchers()
    cookies = _normalize_cookies(cookies)
    if tier == "stealth":
        if StealthyFetcher is None:
            raise RuntimeError("StealthyFetcher unavailable; install scrapling[fetchers] browser extras")
        return _fetch_stealth(StealthyFetcher, url, cookies, headers, proxy, browser_opts)
    if tier == "dynamic":
        if DynamicFetcher is None:
            raise RuntimeError("DynamicFetcher is unavailable; install Scrapling fetcher/browser extras")
        kw: dict[str, Any] = {"headless": True, "network_idle": True}
        if cookies:
            kw["cookies"] = cookies
        if headers:
            kw["extra_headers"] = headers
        if proxy:
            kw["proxy"] = proxy
        kw.update(browser_opts or {})
        return DynamicFetcher.fetch(url, **kw)
    kw = {}
    if cookies:
        kw["cookies"] = cookies
    if headers:
        kw["headers"] = headers
    if proxy:
        kw["proxy"] = proxy
    return Fetcher.get(url, **kw)


def _page_signals(page: Any) -> dict[str, Any]:
    try:
        title = page.css("title::text").get() or ""
    except Exception:
        title = ""
    try:
        text = _clean_text("\n".join(page.css("body ::text").getall()))
    except Exception:
        text = ""
    # "Needs JS" is about the whole page, not the main-content guess.
    main_words = max(_word_count(_node_text(_pick_main_node(page))), _word_count(text))
    html = ""
    for attr in ("html_content", "body"):
        raw = getattr(page, attr, None)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", "replace")
        if isinstance(raw, str) and raw:
            html = raw
            break
    status = getattr(page, "status", None)
    return {"title": title, "main_words": main_words, "text": text, "html": html,
            "status": status if isinstance(status, int) else None,
            "final_url": getattr(page, "url", None) or "", "headers": getattr(page, "headers", None)}


def _fetch_with_access(url: str, mode: str, *, max_tier: str = "stealth", budget_s: float = 170.0,
                       cookies: Any = None, headers: Any = None, proxy: Any = None,
                       browser_opts: dict[str, Any] | None = None,
                       memory: access.HostMemory | None = None,
                       fetch=None) -> tuple[Any | None, str | None, dict[str, Any]]:
    """Fetch with server-side escalation and per-host memory.

    ``mode`` auto: start at the host's remembered tier (default static) and
    climb only on js_required / bot_challenge, never past ``max_tier``.
    ``mode`` static/dynamic/stealth: exactly that tier, no climb (expert override).
    Rate limits never retry and put the host on a shared cool-down; while it
    lasts, requests return ``rate_limited`` without touching the network.
    Returns (page or None, tier used, access block).
    """
    memory = memory or HOSTS
    fetch = fetch or _fetch_tier
    host = access.host_of(url)
    max_tier = max_tier if max_tier in access.TIERS else "stealth"

    remaining = memory.cooldown_remaining(host)
    if remaining > 0:
        why = memory.get(host).get("cooldown_reason")
        return None, None, access.access_block(
            "rate_limited", tier=None, tried=[], upstream_status=None, host=host,
            retry_after_s=remaining, from_memory=True, note=f"(Hold reason: {why})" if why else None)

    if mode in access.TIERS:
        tier, climb = mode, False
    else:
        remembered = memory.start_tier(host) or "static"
        cap = access.TIERS.index(max_tier)
        tier, climb = access.TIERS[min(access.TIERS.index(remembered), cap)], True

    start = time.time()
    tried: list[str] = []
    page = None
    best_page, best_tier = None, None
    outcome, sig, err = "network", {}, None
    note = None
    while True:
        tried.append(tier)
        try:
            page = fetch(tier, url, cookies=cookies, headers=headers, proxy=proxy, browser_opts=browser_opts)
            err = None
        except Exception as exc:  # network / TLS / browser crash
            page, err = None, exc
        if page is None:
            outcome, sig = "network", {}
        else:
            sig = _page_signals(page)
            outcome = access.classify(status=sig["status"], title=sig["title"], body_text=sig["text"],
                                      html=sig["html"], main_words=sig["main_words"], url=url,
                                      final_url=sig["final_url"])
            best_page, best_tier = page, tier
        if outcome == "rate_limited" or not climb:
            break
        nxt = "dynamic" if (outcome == "network" and tier == "static"
                            and access.TIERS.index(max_tier) >= 1) else access.next_tier(outcome, tier, max_tier)
        if nxt is None:
            break
        if time.time() - start + access.TIER_COST_S[nxt] > budget_s:
            note = f"Stopped before trying the {nxt} tier: time budget exhausted."
            break
        tier = nxt

    if best_page is None:
        info = access.access_block("network", tier=None, tried=tried, upstream_status=None, host=host, note=note)
        memory.record(host, "network", tier=None)
        raise AccessStop(f"fetch failed at every tier tried ({', '.join(tried)}): {err}", info)

    page, tier = best_page, best_tier
    if page is not None and outcome == "network":
        # Last tier crashed but an earlier one produced a page: report that one.
        sig = _page_signals(page)
        outcome = access.classify(status=sig["status"], title=sig["title"], body_text=sig["text"],
                                  html=sig["html"], main_words=sig["main_words"], url=url,
                                  final_url=sig["final_url"])
    climbed_for_nothing = outcome == "js_required"  # still thin after JS: a short page, not a JS page
    outcome = access.final_outcome_for(outcome, status=sig.get("status"), title=sig.get("title") or "",
                                       body_text=sig.get("text") or "", html=sig.get("html") or "")

    retry_after = None
    if outcome == "rate_limited":
        cf = "cloudflare" in ((sig.get("title") or "") + " " + (sig.get("text") or "")[:3000]).lower()
        retry_after = access.retry_after_seconds(sig.get("headers"), cloudflare=cf, strikes=memory.strikes(host))
        memory.record(host, outcome, tier=tier, cooldown_s=retry_after,
                      reason=f"HTTP {sig.get('status')} {sig.get('title') or ''}".strip()[:200])
    else:
        memory.record(host, outcome, tier=None if climbed_for_nothing else tier)
    info = access.access_block(outcome, tier=tier, tried=tried, upstream_status=sig.get("status"), host=host,
                               retry_after_s=retry_after, note=note)
    return page, tier, info


def _access_args(payload: dict[str, Any]) -> dict[str, Any]:
    budget_ms = payload.get("budget_ms")
    try:
        budget_s = max(10.0, float(budget_ms) / 1000.0) if budget_ms else 170.0
    except (TypeError, ValueError):
        budget_s = 170.0
    return {"max_tier": str(payload.get("max_tier") or "stealth"), "budget_s": budget_s}


def _blocked_payload(url: str, info: dict[str, Any], *, listing: bool) -> dict[str, Any]:
    """Response for a request refused from host memory (no network request)."""
    base: dict[str, Any] = {"url": url, "mode_used": "static", "records": [], "access": info, "duration": 0}
    if listing:
        base["item_selector"] = None
        return base
    base.update({"title": None, "excerpt": "", "content": "", "sections": [], "field_candidates": {},
                 "wordCount": 0, "degraded": True})
    return base


def _load_fetchers() -> tuple[Any, Any | None, Any | None]:
    fetchers = importlib.import_module("scrapling.fetchers")
    Fetcher = getattr(fetchers, "Fetcher")
    DynamicFetcher = getattr(fetchers, "DynamicFetcher", None)
    StealthyFetcher = getattr(fetchers, "StealthyFetcher", None)
    return Fetcher, DynamicFetcher, StealthyFetcher


def _health_payload() -> dict[str, Any]:
    runtime = f"docker+python {platform.python_version()}"
    if importlib.util.find_spec("scrapling") is None:
        return {
            "status": "unavailable",
            "runtime": runtime,
            "error": "scrapling package not installed",
            "error_code": "ERR_EXTRACT_UNAVAILABLE",
        }

    scrapling = importlib.import_module("scrapling")
    version = getattr(scrapling, "__version__", "unknown")

    try:
        _load_fetchers()
    except Exception as exc:  # pragma: no cover
        return {
            "status": "degraded",
            "detected_version": str(version),
            "runtime": runtime,
            "error": f"scrapling fetchers unavailable: {exc}",
            "error_code": "ERR_EXTRACT_UNAVAILABLE",
        }

    return {
        "status": "connected",
        "detected_version": str(version),
        "runtime": runtime,
    }


def _upstream(page: Any) -> dict[str, Any]:
    """The site's own HTTP status and final URL, so callers can tell a 429 /
    403 / Cloudflare 1015 page from content without pattern-matching text."""
    out: dict[str, Any] = {}
    status = getattr(page, "status", None)
    if isinstance(status, int):
        out["upstream_status"] = status
    final = getattr(page, "url", None)
    if isinstance(final, str) and final:
        out["final_url"] = final
    return out


def _scrape_page_payload(payload: dict[str, Any]) -> dict[str, Any]:
    url = str(payload["url"])
    mode = str(payload.get("mode") or "auto")
    selector = payload.get("selector")
    goal = payload.get("goal")
    entity_type = str(payload.get("entity_type") or "generic")
    max_records = int(payload.get("maxRecords") or 25)
    cookies = payload.get("cookies")
    headers = payload.get("headers")
    proxy = payload.get("proxy")

    start = time.time()
    page, mode_used, info = _fetch_with_access(url, mode, cookies=cookies, headers=headers, proxy=proxy,
                                               browser_opts=_browser_opts(payload), **_access_args(payload))
    if page is None:
        return _blocked_payload(url, info, listing=False)

    title = None
    try:
        title = page.css("title::text").get()
    except Exception:
        title = None

    records: list[dict[str, Any]] = []
    sections: list[dict[str, str]] = []
    content = ""

    if selector:
        elements = page.css(str(selector))
        for index, element in enumerate(elements[:max_records]):
            text = _node_text(element)
            if not text:
                continue
            field_candidates = _field_candidates_from_node(element, entity_type, url)
            record: dict[str, Any] = {
                "index": index,
                "text": text,
                "title": field_candidates.get("title"),
                "url": field_candidates.get("url"),
                "field_candidates": field_candidates,
            }
            attributes = _extract_attributes(element)
            if attributes:
                record["attributes"] = attributes
            records.append(record)
        content = "\n\n".join(record["text"] for record in records)
        if content:
            sections.append({"label": str(selector), "text": _truncate_words(content, 120)})
    else:
        node = _pick_main_node(page)
        content = _node_text(node)
        if not content:
            try:
                content = _clean_text("\n".join(page.css("body ::text").getall()))
            except Exception:
                content = ""
        if content:
            sections.append({"label": "main_content", "text": _truncate_words(content, 120)})

    field_candidates = _field_candidates_from_page(page, entity_type, url, content)

    return {
        "url": url,
        "title": title,
        "mode_used": mode_used,
        **_upstream(page),
        "access": info,
        "selector": selector,
        "goal": goal,
        "excerpt": _truncate_words(content or "", 120),
        "content": content,
        "sections": sections,
        "records": records,
        "field_candidates": field_candidates,
        "wordCount": _word_count(content),
        "degraded": _word_count(content) < 20,
        "duration": int((time.time() - start) * 1000),
    }


def _scrape_listing_payload(payload: dict[str, Any]) -> dict[str, Any]:
    url = str(payload["url"])
    mode = str(payload.get("mode") or "auto")
    goal = payload.get("goal")
    entity_type = str(payload.get("entity_type") or "generic")
    item_selector = payload.get("item_selector")
    max_items = int(payload.get("maxItems") or 25)
    cookies = payload.get("cookies")
    headers = payload.get("headers")
    proxy = payload.get("proxy")

    start = time.time()
    page, mode_used, info = _fetch_with_access(url, mode, cookies=cookies, headers=headers, proxy=proxy,
                                               browser_opts=_browser_opts(payload), **_access_args(payload))
    if page is None:
        return _blocked_payload(url, info, listing=True)
    selector_used, nodes = _best_listing_nodes(page, entity_type, item_selector, max_items)

    records: list[dict[str, Any]] = []
    for index, node in enumerate(nodes[:max_items]):
        text = _node_text(node)
        if not text:
            continue
        field_candidates = _field_candidates_from_node(node, entity_type, url)
        record: dict[str, Any] = {
            "index": index,
            "title": field_candidates.get("title"),
            "url": field_candidates.get("url"),
            "text": text,
            "field_candidates": field_candidates,
        }
        attributes = _extract_attributes(node)
        if attributes:
            record["attributes"] = attributes
        records.append(record)

    return {
        "url": url,
        "goal": goal,
        "mode_used": mode_used,
        **_upstream(page),
        "access": info,
        "item_selector": selector_used,
        "records": records,
        "duration": int((time.time() - start) * 1000),
    }


def _job_fetch(url: str, max_tier: str) -> tuple[Any, str | None, dict[str, Any]]:
    return _fetch_with_access(url, "auto", max_tier=max_tier, budget_s=150.0)


def _job_item(page: Any, spec: dict[str, Any]) -> dict[str, Any]:
    try:
        title = page.css("title::text").get()
    except Exception:
        title = None
    item: dict[str, Any] = {"title": title}
    if spec.get("extract") == "selector" and spec.get("selector"):
        recs = []
        for el in page.css(str(spec["selector"]))[:500]:
            text = _node_text(el)
            if text:
                rec: dict[str, Any] = {"text": text[:5000]}
                attrs = _extract_attributes(el)
                if attrs:
                    rec["attributes"] = attrs
                recs.append(rec)
        item["records"] = recs
    elif spec.get("extract") == "text":
        text = _node_text(_pick_main_node(page))
        item["text"] = text[: sidecar_jobs.TEXT_CAP]
        item["truncated"] = len(text) > sidecar_jobs.TEXT_CAP
        item["wordCount"] = _word_count(text)
    return item


def _job_links(page: Any, url: str) -> list[str]:
    out = []
    try:
        for el in page.css("a"):
            href = (getattr(el, "attrib", None) or {}).get("href")
            if href and not href.startswith(("javascript:", "mailto:", "tel:", "#")):
                out.append(href)
    except Exception:
        pass
    return out


JOBS = sidecar_jobs.JobManager(None, fetch=_job_fetch, to_item=_job_item, links=_job_links, memory=HOSTS)


def _hosts_view(data: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    now = time.time()
    out = {}
    for host, st in data.items():
        st = dict(st)
        st["cooldown_remaining_s"] = int(max(0.0, float(st.get("cooldown_until") or 0) - now))
        out[host] = st
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        return json.loads(raw)

    def _host_route(self) -> tuple[str, str] | None:
        m = re.fullmatch(r"/hosts/([^/]+)(/cooldown)?/?", self.path.split("?", 1)[0])
        if not m:
            return None
        return unquote(m.group(1)).lower(), m.group(2) or ""

    def do_GET(self) -> None:  # pragma: no cover - simple transport wrapper
        if self.path == "/health":
            self._send(200, _health_payload())
            return
        if self.path.rstrip("/") == "/hosts":
            self._send(200, {"hosts": _hosts_view(HOSTS.all())})
            return
        route = self._host_route()
        if route and not route[1]:
            self._send(200, _hosts_view({route[0]: HOSTS.get(route[0])})[route[0]])
            return
        if self._jobs_route("GET"):
            return
        self._send(404, {"error": "not_found"})

    def _jobs_route(self, method: str) -> bool:
        path, _, query = self.path.partition("?")
        path = path.rstrip("/")
        if path == "/jobs":
            if method == "GET":
                self._send(200, {"jobs": JOBS.list()})
            else:
                try:
                    self._send(200, JOBS.create(self._body()))
                except (sidecar_jobs.JobError, ValueError, TypeError) as exc:
                    self._send(400, {"error": str(exc)})
            return True
        m = re.fullmatch(r"/jobs/([A-Za-z0-9-]+)(?:/(results|pause|resume|cancel))?", path)
        if not m:
            return False
        job_id, action = m.group(1), m.group(2)
        try:
            if method == "GET" and action is None:
                self._send(200, JOBS.get(job_id).status())
            elif method == "GET" and action == "results":
                params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
                cursor = max(0, int(params.get("cursor") or 0))
                limit = max(1, min(100, int(params.get("limit") or 20)))
                self._send(200, JOBS.get(job_id).results(cursor, limit))
            elif method == "POST" and action in ("pause", "resume", "cancel"):
                self._send(200, getattr(JOBS, action)(job_id))
            else:
                self._send(405, {"error": "method_not_allowed"})
        except KeyError:
            self._send(404, {"error": f"no such job: {job_id}"})
        except ValueError as exc:
            self._send(400, {"error": str(exc)})
        return True

    def do_DELETE(self) -> None:  # pragma: no cover - simple transport wrapper
        route = self._host_route()
        if route and route[1]:
            HOSTS.clear_cooldown(route[0])
            self._send(200, _hosts_view({route[0]: HOSTS.get(route[0])})[route[0]])
            return
        self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:  # pragma: no cover - simple transport wrapper
        route = self._host_route()
        if route and route[1]:
            try:
                body = self._body()
                seconds = float(body.get("seconds") or 0)
                if seconds <= 0:
                    raise ValueError("seconds must be > 0")
                HOSTS.set_cooldown(route[0], seconds, str(body.get("reason") or "external hold")[:200])
                self._send(200, _hosts_view({route[0]: HOSTS.get(route[0])})[route[0]])
            except Exception as exc:
                self._send(400, {"error": str(exc)})
            return
        if self.path.startswith("/jobs") and self._jobs_route("POST"):
            return
        if self.path not in ("/extract", "/scrape-page", "/scrape-listing"):
            self._send(404, {"error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            payload = json.loads(raw)
            if self.path in ("/extract", "/scrape-page"):
                self._send(200, _scrape_page_payload(payload))
            else:
                self._send(200, _scrape_listing_payload(payload))
        except AccessStop as exc:
            self._send(500, {"error": str(exc), "error_code": "ERR_EXTRACT_UNAVAILABLE", "access": exc.access})
        except Exception as exc:
            self._send(500, {
                "error": str(exc),
                "error_code": "ERR_EXTRACT_UNAVAILABLE",
            })

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    JOBS.start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

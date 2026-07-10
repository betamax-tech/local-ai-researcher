#!/usr/bin/env python3
"""Scrapling HTTP sidecar for Local Researcher.

Endpoints:
- GET /health
- POST /extract           (compatibility alias)
- POST /scrape-page
- POST /scrape-listing
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
from urllib.parse import urljoin


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
    for selector in ("main", "article", "[role='main']", "body"):
        try:
            matches = page.css(selector)
            if matches:
                return matches[0]
        except Exception:
            continue
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


def _fetch_stealth(StealthyFetcher: Any, url: str, cookies, headers, proxy) -> Any:
    """Anti-detection fetch via Scrapling's StealthyFetcher (camoufox-based).
    Enables Cloudflare challenge solving + fingerprint hardening. This is the
    lane to use for bot-walled sites; it is heavier/slower than dynamic."""
    kwargs: dict[str, Any] = {
        "headless": True,
        "network_idle": True,
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
    return StealthyFetcher.fetch(url, **kwargs)


def _fetch_page(
    url: str,
    mode: str,
    cookies: Any = None,
    headers: Any = None,
    proxy: Any = None,
) -> tuple[Any, str]:
    """Fetch a page.

    Modes:
      static  — fast HTTP fetch (no JS).
      dynamic — headless Chromium (renders JS).
      stealth — StealthyFetcher: anti-detection + Cloudflare solving for
                bot-walled sites (slowest).
      auto    — static, escalating to dynamic when content is thin.

    Optional cookies/headers/proxy are injected so callers can fetch behind
    sign-in walls (cookies) or via a chosen egress (proxy). When proxy is None,
    the fetch uses the sidecar's direct network egress.
    """
    Fetcher, DynamicFetcher, StealthyFetcher = _load_fetchers()

    cookies = _normalize_cookies(cookies)

    # Build per-fetcher kwargs (parameter names differ between fetchers).
    static_kwargs: dict[str, Any] = {}
    dyn_kwargs: dict[str, Any] = {"headless": True, "network_idle": True}
    if cookies:
        static_kwargs["cookies"] = cookies
        dyn_kwargs["cookies"] = cookies
    if headers:
        static_kwargs["headers"] = headers
        dyn_kwargs["extra_headers"] = headers
    if proxy:
        static_kwargs["proxy"] = proxy
        dyn_kwargs["proxy"] = proxy

    # Explicit stealth mode — the anti-bot / anti-CAPTCHA lane.
    if mode == "stealth":
        if StealthyFetcher is None:
            raise RuntimeError("StealthyFetcher unavailable; install scrapling[fetchers] browser extras")
        return _fetch_stealth(StealthyFetcher, url, cookies, headers, proxy), "stealth"

    page = None
    mode_used = "static"
    static_error = None

    if mode in ("auto", "static"):
        try:
            page = Fetcher.get(url, **static_kwargs)
            mode_used = "static"
        except Exception as exc:
            static_error = exc
            if mode == "static":
                raise

    if page is None:
        if DynamicFetcher is None:
            raise RuntimeError("DynamicFetcher is unavailable; install Scrapling fetcher/browser extras")
        page = DynamicFetcher.fetch(url, **dyn_kwargs)
        mode_used = "dynamic"

    if mode == "auto" and DynamicFetcher is not None:
        candidate = _pick_main_node(page)
        candidate_text = _node_text(candidate)
        if _word_count(candidate_text) < 40:
            try:
                page = DynamicFetcher.fetch(url, **dyn_kwargs)
                mode_used = "dynamic"
            except Exception:
                if static_error is not None:
                    page = page

    return page, mode_used


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
    page, mode_used = _fetch_page(url, mode, cookies=cookies, headers=headers, proxy=proxy)

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
    page, mode_used = _fetch_page(url, mode, cookies=cookies, headers=headers, proxy=proxy)
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
        "item_selector": selector_used,
        "records": records,
        "duration": int((time.time() - start) * 1000),
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # pragma: no cover - simple transport wrapper
        if self.path == "/health":
            self._send(200, _health_payload())
            return
        self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:  # pragma: no cover - simple transport wrapper
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
        except Exception as exc:
            self._send(500, {
                "error": str(exc),
                "error_code": "ERR_EXTRACT_UNAVAILABLE",
            })

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

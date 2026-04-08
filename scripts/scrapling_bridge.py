#!/usr/bin/env python3
"""Minimal Scrapling bridge for Local Researcher v2.

Reads a JSON command from stdin and writes a JSON response to stdout.
Supported actions:
- health
- extract
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import platform
import sys
import time
from typing import Any


def _json_out(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


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


def _pick_main_node(page: Any) -> Any:
    for selector in ("main", "article", "[role='main']", "body"):
        try:
            matches = page.css(selector)
            if matches:
                return matches[0]
        except Exception:
            continue
    return page


def _load_fetchers() -> tuple[Any, Any | None]:
    fetchers = importlib.import_module("scrapling.fetchers")
    Fetcher = getattr(fetchers, "Fetcher")
    DynamicFetcher = getattr(fetchers, "DynamicFetcher", None)
    return Fetcher, DynamicFetcher


def _do_health() -> None:
    runtime = f"python {platform.python_version()}"
    if importlib.util.find_spec("scrapling") is None:
        _json_out(
            {
                "status": "unavailable",
                "runtime": runtime,
                "error": "scrapling package not installed",
                "error_code": "ERR_EXTRACT_UNAVAILABLE",
            }
        )
        return

    scrapling = importlib.import_module("scrapling")
    version = getattr(scrapling, "__version__", "unknown")

    try:
      _load_fetchers()
    except Exception as exc:  # pragma: no cover - defensive path
        _json_out(
            {
                "status": "degraded",
                "detected_version": str(version),
                "runtime": runtime,
                "error": f"scrapling fetchers unavailable: {exc}",
                "error_code": "ERR_EXTRACT_UNAVAILABLE",
            }
        )
        return

    _json_out(
        {
            "status": "connected",
            "detected_version": str(version),
            "runtime": runtime,
        }
    )


def _do_extract(payload: dict[str, Any]) -> None:
    url = str(payload["url"])
    mode = str(payload.get("mode") or "auto")
    selector = payload.get("selector")
    goal = payload.get("goal")
    max_records = int(payload.get("maxRecords") or 25)

    Fetcher, DynamicFetcher = _load_fetchers()

    start = time.time()
    page = None
    mode_used = "static"

    static_error = None
    if mode in ("auto", "static"):
        try:
            page = Fetcher.get(url)
            mode_used = "static"
        except Exception as exc:
            static_error = exc
            if mode == "static":
                raise

    if page is None:
        if DynamicFetcher is None:
            raise RuntimeError("DynamicFetcher is unavailable; install Scrapling fetcher/browser extras")
        page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
        mode_used = "dynamic"

    if mode == "auto" and DynamicFetcher is not None:
        try:
            candidate = _pick_main_node(page)
            candidate_text = _clean_text(getattr(candidate, "text", ""))
            if _word_count(candidate_text) < 40:
                page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
                mode_used = "dynamic"
        except Exception:
            if static_error and page is None:
                raise static_error

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
            text = _clean_text(getattr(element, "text", ""))
            if not text:
                continue
            record: dict[str, Any] = {"index": index, "text": text}
            attributes = _extract_attributes(element)
            if attributes:
                record["attributes"] = attributes
            records.append(record)
        content = "\n\n".join(record["text"] for record in records)
        if content:
            sections.append({"label": str(selector), "text": _truncate_words(content, 120)})
    else:
        node = _pick_main_node(page)
        content = _clean_text(getattr(node, "text", ""))
        if content:
            sections.append({"label": "main_content", "text": _truncate_words(content, 120)})

    excerpt = _truncate_words(content or "", 120)

    _json_out(
        {
            "url": url,
            "title": title,
            "mode_used": mode_used,
            "selector": selector,
            "goal": goal,
            "excerpt": excerpt,
            "content": content,
            "sections": sections,
            "records": records,
            "wordCount": _word_count(content),
            "degraded": _word_count(content) < 20,
            "duration": int((time.time() - start) * 1000),
        }
    )


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        action = payload.get("action")
        if action == "health":
            _do_health()
            return
        if action == "extract":
            _do_extract(payload)
            return
        _json_out(
            {
                "status": "error",
                "error": f"Unsupported action: {action}",
                "error_code": "ERR_EXTRACT_INVALID_RESPONSE",
            }
        )
    except Exception as exc:  # pragma: no cover - CLI bridge safety net
        _json_out(
            {
                "status": "error",
                "error": str(exc),
                "error_code": "ERR_EXTRACT_UNAVAILABLE",
            }
        )


if __name__ == "__main__":
    main()

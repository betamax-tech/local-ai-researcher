#!/usr/bin/env python3
"""Scrapling HTTP sidecar for Local Researcher.

Endpoints:
- GET /health
- POST /extract
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import platform
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


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


def _load_fetchers() -> tuple[Any, Any | None]:
    fetchers = importlib.import_module("scrapling.fetchers")
    Fetcher = getattr(fetchers, "Fetcher")
    DynamicFetcher = getattr(fetchers, "DynamicFetcher", None)
    return Fetcher, DynamicFetcher


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


def _extract_payload(payload: dict[str, Any]) -> dict[str, Any]:
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
        candidate = _pick_main_node(page)
        candidate_text = _clean_text(getattr(candidate, "text", ""))
        if _word_count(candidate_text) < 40:
            try:
                page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
                mode_used = "dynamic"
            except Exception:
                if static_error is not None:
                    page = page

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
        content = _node_text(node)
        if not content:
            try:
                content = _clean_text("\n".join(page.css("body ::text").getall()))
            except Exception:
                content = ""
        if content:
            sections.append({"label": "main_content", "text": _truncate_words(content, 120)})

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
        "wordCount": _word_count(content),
        "degraded": _word_count(content) < 20,
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
        if self.path != "/extract":
            self._send(404, {"error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            payload = json.loads(raw)
            self._send(200, _extract_payload(payload))
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

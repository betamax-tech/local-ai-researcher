"""Sidecar access outcomes, escalation ladder, and host memory.

Run: uv run --with pytest pytest tests/sidecar -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import scrapling_sidecar as sc  # noqa: E402
import sidecar_access as acc  # noqa: E402

ARTICLE = "word " * 400
CF_TITLE = "Just a moment..."
CF_1015_TITLE = "Access denied | example.test used Cloudflare to restrict access | Cloudflare"


class _Sel(list):
    def get(self):
        return self[0] if self else None

    def getall(self):
        return list(self)


class _Node:
    def __init__(self, text):
        self.text = text

    def css(self, _sel):
        return _Sel([self.text])


class FakePage:
    def __init__(self, status=200, title="Page", text=ARTICLE, html="", url="https://example.test/a",
                 headers=None):
        self.status, self._title, self._text = status, title, text
        self.html_content = html or f"<html><title>{title}</title><body>{text}</body></html>"
        self.url, self.headers = url, headers or {}

    def css(self, sel):
        if sel == "title::text":
            return _Sel([self._title])
        if sel == "body ::text":
            return _Sel([self._text])
        if sel in ("main", "article", "[role='main']", "body"):
            return _Sel([_Node(self._text)]) if sel == "body" else _Sel([])
        return _Sel([])


class Script:
    """fetch() stub: tier -> list of pages (or exceptions) returned in order."""

    def __init__(self, **by_tier):
        self.by_tier = {k: list(v) for k, v in by_tier.items()}
        self.calls: list[str] = []

    def __call__(self, tier, url, **_kw):
        self.calls.append(tier)
        item = self.by_tier[tier].pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def mem(tmp_path):
    return acc.HostMemory(tmp_path / "hosts.json", clock=Clock())


def run(script, mem, mode="auto", **kw):
    return sc._fetch_with_access("https://example.test/a", mode, memory=mem, fetch=script, **kw)


# --------------------------------------------------------------------- classify


@pytest.mark.parametrize("kw,expected", [
    ({"status": 200, "title": "Doc", "body_text": ARTICLE, "main_words": 400}, "ok"),
    ({"status": 200, "title": "App", "body_text": "Loading", "main_words": 1}, "js_required"),
    ({"status": 403, "title": CF_TITLE, "body_text": "", "main_words": 0}, "bot_challenge"),
    ({"status": 503, "title": "x", "body_text": "Ray ID: 1 enable JavaScript and cookies", "main_words": 3},
     "bot_challenge"),
    ({"status": 429, "title": "Too many", "body_text": "", "main_words": 0}, "rate_limited"),
    ({"status": 403, "title": CF_1015_TITLE, "body_text": "error-1015 Cloudflare", "main_words": 2}, "rate_limited"),
    ({"status": 403, "title": CF_1015_TITLE, "body_text": "Error 1020 Cloudflare", "main_words": 2}, "forbidden"),
    ({"status": 404, "title": "Not found", "body_text": "", "main_words": 0}, "not_found"),
    ({"status": 401, "title": "Login", "body_text": "", "main_words": 0}, "auth_required"),
    ({"status": 502, "title": "Bad gateway", "body_text": "", "main_words": 0}, "server_error"),
    ({"status": 403, "title": "Forbidden", "body_text": "", "main_words": 0}, "bot_challenge"),  # try a browser
])
def test_classify(kw, expected):
    assert acc.classify(**kw) == expected


def test_quoted_challenge_words_in_long_article_are_not_a_challenge():
    body = ARTICLE + ' the court said "Just a moment, Mr. Sheriff" and solved the captcha ' + ARTICLE
    assert acc.classify(status=200, title="People v. X", body_text=body, main_words=800) == "ok"


def test_login_redirect_is_auth_required():
    assert acc.classify(status=200, title="Sign in", body_text=ARTICLE, main_words=400,
                        url="https://x.test/report", final_url="https://x.test/login?next=/report") == "auth_required"


# --------------------------------------------------------------------- ladder


def test_ok_static_no_climb(mem):
    s = Script(static=[FakePage()])
    page, tier, info = run(s, mem)
    assert s.calls == ["static"] and info["outcome"] == "ok" and info["tier"] == "static" and info["next"] is None


def test_thin_page_climbs_to_dynamic_only(mem):
    s = Script(static=[FakePage(text="Loading")], dynamic=[FakePage(text="Loading")])
    _, tier, info = run(s, mem)
    assert s.calls == ["static", "dynamic"] and info["outcome"] == "ok" and tier == "dynamic"
    assert mem.start_tier("example.test") is None  # JS did not help: don't start there next time


def test_challenge_climbs_to_stealth_and_is_remembered(mem):
    s = Script(static=[FakePage(403, CF_TITLE, "")], stealth=[FakePage()])
    _, tier, info = run(s, mem)
    assert s.calls == ["static", "stealth"] and info["outcome"] == "ok" and info["tried"] == ["static", "stealth"]
    s2 = Script(stealth=[FakePage()])
    run(s2, mem)
    assert s2.calls == ["stealth"]  # next auto call starts at the remembered tier


def test_max_tier_caps_the_climb(mem):
    s = Script(static=[FakePage(403, CF_TITLE, "")], dynamic=[FakePage(403, CF_TITLE, "")])
    _, _, info = run(s, mem, max_tier="dynamic")
    assert s.calls == ["static", "dynamic"] and info["outcome"] == "bot_challenge" and info["next"]


def test_unmarked_403_that_no_tier_fixes_is_forbidden(mem):
    s = Script(static=[FakePage(403, "Forbidden", "")], stealth=[FakePage(403, "Forbidden", "")])
    _, _, info = run(s, mem)
    assert info["outcome"] == "forbidden"


def test_explicit_mode_is_one_tier_only(mem):
    s = Script(static=[FakePage(403, CF_TITLE, "")])
    _, _, info = run(s, mem, mode="static")
    assert s.calls == ["static"] and info["outcome"] == "bot_challenge"


def test_static_network_error_falls_through_to_browser(mem):
    s = Script(static=[ConnectionError("reset")], dynamic=[FakePage()])
    _, tier, info = run(s, mem)
    assert tier == "dynamic" and info["outcome"] == "ok"


def test_network_error_everywhere_raises_with_access(mem):
    s = Script(static=[ConnectionError("x")], dynamic=[ConnectionError("y")])
    with pytest.raises(sc.AccessStop) as ei:
        run(s, mem)
    assert ei.value.access["outcome"] == "network"


def test_time_budget_stops_the_climb(mem):
    s = Script(static=[FakePage(403, CF_TITLE, "")])
    _, _, info = run(s, mem, budget_s=10.0)
    assert s.calls == ["static"] and "time budget" in info["next"]


# --------------------------------------------------------------------- rate limits


def test_rate_limit_never_escalates_and_holds_host_without_network(mem):
    s = Script(static=[FakePage(429, "Too Many Requests", "", headers={"retry-after": "120"})])
    _, _, info = run(s, mem)
    assert s.calls == ["static"] and info["outcome"] == "rate_limited" and info["retry_after_s"] == 120
    assert "Do not request example.test" in info["next"]
    s2 = Script()
    page, tier, info2 = run(s2, mem)
    assert page is None and s2.calls == [] and info2["outcome"] == "rate_limited" and info2["from_memory"]


def test_cloudflare_1015_holds_twelve_hours(mem):
    s = Script(stealth=[FakePage(403, CF_1015_TITLE, "error-1015 Cloudflare")])
    _, _, info = run(s, mem, mode="stealth")
    assert info["outcome"] == "rate_limited" and info["retry_after_s"] == 12 * 3600


def test_repeat_rate_limit_doubles(mem):
    run(Script(static=[FakePage(429, "x", "")]), mem)
    mem.clock.t += 3601
    _, _, info = run(Script(static=[FakePage(429, "x", "")]), mem)
    assert info["retry_after_s"] == 7200


def test_external_hold_extends_never_shortens(mem):
    mem.set_cooldown("example.test", 3600, "ingest hold")
    mem.set_cooldown("example.test", 60, "shorter")
    assert mem.cooldown_remaining("example.test") == 3600
    mem.clear_cooldown("example.test")
    assert mem.cooldown_remaining("example.test") == 0


def test_memory_persists(tmp_path):
    a = acc.HostMemory(tmp_path / "h.json", clock=Clock())
    a.set_cooldown("x.test", 600, "r")
    b = acc.HostMemory(tmp_path / "h.json", clock=Clock())
    assert b.cooldown_remaining("x.test") == 600


# --------------------------------------------------------------------- payloads


def test_scrape_page_payload_carries_access(monkeypatch, tmp_path):
    mem = acc.HostMemory(tmp_path / "h.json", clock=Clock())
    monkeypatch.setattr(sc, "HOSTS", mem)
    monkeypatch.setattr(sc, "_fetch_tier", Script(static=[FakePage()]))
    out = sc._scrape_page_payload({"url": "https://example.test/a"})
    assert out["access"]["outcome"] == "ok" and out["upstream_status"] == 200 and out["wordCount"] >= 400
    mem.set_cooldown("example.test", 600, "r")
    blocked = sc._scrape_listing_payload({"url": "https://example.test/list"})
    assert blocked["records"] == [] and blocked["access"]["outcome"] == "rate_limited"

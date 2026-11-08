"""Access outcomes, the escalation ladder, and per-host memory for the sidecar.

Pure stdlib and free of scrapling imports so it can be unit-tested anywhere.

Vocabulary (``access.outcome``) — see vault/ai/docs/access-escalation-and-crawl-jobs.md:

  ok, js_required, bot_challenge, rate_limited, forbidden, auth_required,
  not_found, server_error, network

Only ``js_required`` and ``bot_challenge`` climb the ladder. ``rate_limited``
never retries or escalates and puts the host on a shared cool-down that every
later request honours *without touching the network* — retrying inside a
rate-limit window extends it (officialgazette.gov.ph, Cloudflare 1015,
2026-10-09).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

TIERS = ("static", "dynamic", "stealth")

# Rough wall-clock cost of one fetch per tier, used to skip a climb that would
# overrun the caller's time budget.
TIER_COST_S = {"static": 5.0, "dynamic": 20.0, "stealth": 30.0}

THIN_WORDS = 40          # main-content words below which a 2xx page "needs JS"
NEAR_EMPTY_CHARS = 3000  # body markers only count on pages this small

# Cool-downs. A server-sent Retry-After wins (clamped); repeats double.
RATE_LIMIT_DEFAULT_S = 3600.0           # plain 429
RATE_LIMIT_CLOUDFLARE_S = 12 * 3600.0   # Cloudflare 1015 page
RATE_LIMIT_MIN_S, RATE_LIMIT_MAX_S = 60.0, 48 * 3600.0
STRIKE_MEMORY_S = 7 * 86400.0           # a strike older than this is forgotten
START_TIER_MEMORY_S = 7 * 86400.0

_TITLE_CHALLENGE = re.compile(
    r"just a moment|attention required|checking your browser|verify you are (a )?human|"
    r"ddos-guard|security check|are you a robot|human verification|access denied.*cloudflare|"
    r"pardon our interruption|one more step",
    re.I,
)
_BODY_CHALLENGE = re.compile(
    r"cf-chl|challenge-platform|cf_chl_opt|turnstile|captcha|enable javascript and cookies|"
    r"ray id|ddos-guard|_incapsula_|perimeterx|px-captcha|datadome",
    re.I,
)
_RATE_LIMIT_TEXT = re.compile(r"error(?: code)?:?[\s-]*1015\b|you are being rate limited", re.I)
_FIREWALL_TEXT = re.compile(r"error(?: code)?:?[\s-]*1020\b|access denied.{0,80}firewall", re.I)
_LOGIN_PATH = re.compile(r"/(log-?in|sign-?in|auth|account/login|sso)(/|\?|$)", re.I)

NEXT = {
    "bot_challenge": "The site blocks automated access even with a stealth browser. Use another source.",
    "rate_limited": ("Rate limited. Do not request {host} again for {retry_after_s}s — with any tool or "
                     "mode. Switching tools does not help and extends the block."),
    "forbidden": "Access refused by the site (not a bot check). Do not retry; use another source.",
    "auth_required": "Login required. Retry only with `cookies` for a session you are allowed to use.",
    "not_found": None,
    "server_error": "The site returned a server error. Try later.",
    "network": "Network error or the site is down. Try later.",
    "js_required": "Page content is still unrendered or incomplete. Do not treat the shell as the requested content.",
    "ok": None,
}


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def has_challenge_markers(*, title: str, body_text: str, html: str = "") -> bool:
    """Challenge wording in the title, or challenge markup on a near-empty page."""
    if _TITLE_CHALLENGE.search(title or ""):
        return True
    near_empty = len((body_text or "").strip()) < NEAR_EMPTY_CHARS
    return near_empty and bool(_BODY_CHALLENGE.search((body_text or "")[:20000] + " " + (html or "")[:20000]))


def final_outcome_for(outcome: str, *, status: int | None, title: str, body_text: str, html: str = "") -> str:
    """Outcome once the ladder is exhausted: a still-thin page is just short
    (ok); an unmarked 403 that no allowed tier got past is a refusal."""
    if outcome == "js_required":
        return "ok"
    if outcome == "bot_challenge" and status == 403 and not has_challenge_markers(
            title=title, body_text=body_text, html=html):
        return "forbidden"
    return outcome


def is_shell(text: str) -> bool:
    text = text.strip()
    if len(text) >= 1500:
        return False
    return bool(re.search(r"get responses tailored to you|log in to get answers based on saved chats", text, re.I)
                or re.fullmatch(r"(?:loading(?:\.{3}|…)?|please enable javascript|you need to enable javascript|enable javascript to continue)[\s.!]*", text, re.I))


def classify(*, status: int | None, title: str, body_text: str, main_words: int,
             url: str = "", final_url: str = "", html: str = "") -> str:
    """Map one fetched page to an outcome. ``body_text`` is the page's visible
    text, ``html`` its markup. Body markers only count on near-empty pages, so
    an article that *quotes* "Just a moment" is not a challenge."""
    title = title or ""
    head = ((body_text or "")[:20000] + " " + (html or "")[:20000])
    near_empty = len((body_text or "").strip()) < NEAR_EMPTY_CHARS
    title_hit = bool(_TITLE_CHALLENGE.search(title))
    body_hit = near_empty and bool(_BODY_CHALLENGE.search(head))
    rate_text = (near_empty or title_hit) and bool(_RATE_LIMIT_TEXT.search(head + " " + title))

    if status == 429 or rate_text:
        return "rate_limited"
    if status in (404, 410):
        return "not_found"
    if status in (401, 407):
        # Some bot checks (e.g. Indeed's "Authenticating...") use 401.
        # Require explicit markers on a near-empty page, not the status/title
        # alone. Never reinterpret proxy authentication or a firewall refusal.
        if status == 401 and near_empty and (title_hit or body_hit):
            if _FIREWALL_TEXT.search(head + " " + title):
                return "forbidden"
            return "bot_challenge"
        return "auth_required"
    if (near_empty or title_hit) and _FIREWALL_TEXT.search(head + " " + title):
        return "forbidden"
    if title_hit or body_hit:
        return "bot_challenge"
    if status == 403:
        # Unmarked 403: often a UA / TLS-fingerprint block a browser gets past;
        # becomes "forbidden" if the top allowed tier still gets it.
        return "bot_challenge"
    if status is not None and status >= 500:
        return "server_error"
    if status is not None and 400 <= status < 500:
        return "forbidden"
    if final_url and url and _LOGIN_PATH.search(urlsplit(final_url).path or "") \
            and not _LOGIN_PATH.search(urlsplit(url).path or ""):
        return "auth_required"
    if main_words < THIN_WORDS or is_shell(body_text):
        return "js_required"
    return "ok"


def next_tier(outcome: str, tier: str, max_tier: str) -> str | None:
    """The tier to try after ``tier`` gave ``outcome``; None = stop here."""
    cap = TIERS.index(max_tier)
    i = TIERS.index(tier)
    if outcome == "js_required" and tier == "static" and cap >= 1:
        return "dynamic"
    if outcome == "bot_challenge" and i < cap:
        return "stealth" if cap >= 2 else TIERS[i + 1]
    return None


def retry_after_seconds(headers: Any, *, cloudflare: bool, strikes: int) -> float:
    base = RATE_LIMIT_CLOUDFLARE_S if cloudflare else RATE_LIMIT_DEFAULT_S
    raw = None
    try:
        raw = (headers or {}).get("retry-after") or (headers or {}).get("Retry-After")
    except Exception:
        raw = None
    if raw is not None:
        try:
            base = float(str(raw).strip())
        except ValueError:
            pass  # HTTP-date form: keep the default
    base *= 2 ** max(0, strikes)
    return max(RATE_LIMIT_MIN_S, min(RATE_LIMIT_MAX_S, base))


def access_block(outcome: str, *, tier: str | None, tried: list[str], upstream_status: int | None,
                 host: str, retry_after_s: float | None = None, from_memory: bool = False,
                 note: str | None = None) -> dict[str, Any]:
    nxt = NEXT.get(outcome)
    if nxt and "{" in nxt:
        nxt = nxt.format(host=host, retry_after_s=int(retry_after_s or 0))
    if note:
        nxt = f"{nxt} {note}" if nxt else note
    return {
        "outcome": outcome,
        "upstream_status": upstream_status,
        "tier": tier,
        "tried": list(tried),
        "retry_after_s": int(retry_after_s) if retry_after_s else None,
        "from_memory": from_memory,
        "next": nxt,
    }


class HostMemory:
    """Per-host state persisted as one JSON file in the sidecar's state volume.

    ``cooldown_until`` (epoch s): requests before it are refused locally.
    ``start_tier``: lowest tier that last produced ``ok`` — the next auto
    request starts there instead of re-climbing (each climb is extra load).
    """

    def __init__(self, path: str | os.PathLike | None = None, clock=time.time) -> None:
        default = Path(os.environ.get("SCRAPLING_STATE_DIR", "/app/state")) / "hosts.json"
        self.path = Path(path) if path else default
        self.clock = clock
        self._lock = threading.Lock()
        self._data: dict[str, dict[str, Any]] = {}
        try:
            self._data = json.loads(self.path.read_text())
        except (OSError, ValueError):
            self._data = {}

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._data, indent=1, sort_keys=True))
            tmp.replace(self.path)
        except OSError:
            pass  # memory still works in-process

    def get(self, host: str) -> dict[str, Any]:
        with self._lock:
            return dict(self._data.get(host) or {})

    def all(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            return {h: dict(v) for h, v in self._data.items()}

    def cooldown_remaining(self, host: str) -> float:
        until = float(self.get(host).get("cooldown_until") or 0)
        return max(0.0, until - self.clock())

    def start_tier(self, host: str) -> str | None:
        st = self.get(host)
        tier = st.get("start_tier")
        if tier in TIERS and self.clock() - float(st.get("start_tier_at") or 0) < START_TIER_MEMORY_S:
            return tier
        return None

    def strikes(self, host: str) -> int:
        st = self.get(host)
        if self.clock() - float(st.get("last_strike_at") or 0) > STRIKE_MEMORY_S:
            return 0
        return int(st.get("strikes") or 0)

    def record(self, host: str, outcome: str, *, tier: str | None, cooldown_s: float | None = None,
               reason: str | None = None) -> None:
        if not host:
            return
        now = self.clock()
        with self._lock:
            st = self._data.setdefault(host, {})
            st["last_outcome"] = outcome
            st["updated_at"] = now
            if outcome == "rate_limited" and cooldown_s:
                fresh = now - float(st.get("last_strike_at") or 0) <= STRIKE_MEMORY_S
                st["strikes"] = (int(st.get("strikes") or 0) if fresh else 0) + 1
                st["last_strike_at"] = now
                st["cooldown_until"] = max(float(st.get("cooldown_until") or 0), now + cooldown_s)
                st["cooldown_reason"] = reason or "rate limited"
            elif outcome == "ok" and tier in TIERS:
                if tier == "static":
                    st.pop("start_tier", None)
                    st.pop("start_tier_at", None)
                else:
                    st["start_tier"] = tier
                    st["start_tier_at"] = now
            self._save()

    def set_cooldown(self, host: str, seconds: float, reason: str) -> dict[str, Any]:
        """External hold (e.g. ph-legal ``ingest``): extends, never shortens."""
        now = self.clock()
        with self._lock:
            st = self._data.setdefault(host, {})
            st["cooldown_until"] = max(float(st.get("cooldown_until") or 0), now + max(0.0, seconds))
            st["cooldown_reason"] = reason
            st["updated_at"] = now
            self._save()
            return dict(st)

    def clear_cooldown(self, host: str) -> None:
        with self._lock:
            st = self._data.get(host)
            if st:
                st.pop("cooldown_until", None)
                st.pop("cooldown_reason", None)
                st["strikes"] = 0
                self._save()

"""Background crawl jobs for the Scrapling sidecar.

A job walks links from ``start_urls`` inside the sidecar process (never in an
MCP process, which lives only as long as one agent session). Every fetch goes
through the same access layer as single-page scrapes (sidecar_access): the
escalation ladder, per-host holds shared with every caller, and the light
stealth defaults. State lives on the ``scrapling-state`` volume:

  /app/state/jobs/<id>/job.json        spec + status (atomic rewrite)
  /app/state/jobs/<id>/frontier.sqlite urls: pending / done / failed
  /app/state/jobs/<id>/items.jsonl     one line per fetched page

A container restart re-queues running jobs; they resume from the frontier.
Finished jobs are deleted 14 days after they end.

Deliberately our own loop rather than scrapling's Spider: a Spider uses its
own fetch sessions and would bypass the access layer and host holds.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import shutil
import socket
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib import robotparser
from urllib.parse import urldefrag, urljoin, urlsplit

import sidecar_access as access

MAX_PAGES_CAP = 5000
DEFAULT_MAX_PAGES = 200
DEFAULT_MAX_DEPTH = 3
MIN_DELAY_S = 1.0
DEFAULT_DELAY_S = 2.0
STEALTH_DELAY_S = 30.0        # default gap after a page that needed the stealth browser
RETENTION_S = 14 * 86400.0
TEXT_CAP = 50_000             # chars of page text stored per item
BROWSER_JOBS_MAX = 1          # jobs that may use a browser tier, at once (1.5 GB container)
STATIC_JOBS_MAX = 2
ROBOTS_UA = "local-researcher-crawl"

ACTIVE = ("queued", "running", "rate_limited")
FINAL = ("done", "failed", "cancelled")


def _now() -> float:
    return time.time()


def _private_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False  # unresolvable: the fetch will fail on its own
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True
    return False


class JobError(ValueError):
    pass


def validate_spec(spec: dict[str, Any]) -> dict[str, Any]:
    urls = spec.get("start_urls")
    if isinstance(urls, str):
        urls = [urls]
    if not urls or not isinstance(urls, list) or len(urls) > 50:
        raise JobError("start_urls: 1-50 http(s) URLs required")
    clean = []
    for u in urls:
        u = str(u).strip()
        if urlsplit(u).scheme not in ("http", "https") or not urlsplit(u).hostname:
            raise JobError(f"start_urls: not an http(s) URL: {u}")
        clean.append(urldefrag(u)[0])
    allow = spec.get("allow")
    deny = spec.get("deny")
    for name, pat in (("allow", allow), ("deny", deny)):
        if pat:
            try:
                re.compile(str(pat))
            except re.error as exc:
                raise JobError(f"{name}: invalid regex: {exc}") from exc
    tier = str(spec.get("max_tier") or "stealth")
    if tier not in access.TIERS:
        raise JobError("max_tier: static | dynamic | stealth")
    extract = str(spec.get("extract") or "text")
    if extract not in ("text", "selector", "links"):
        raise JobError("extract: text | selector | links")
    if extract == "selector" and not spec.get("selector"):
        raise JobError("extract=selector needs a selector")
    delay = spec.get("delay_s")
    return {
        "start_urls": clean,
        "allow": str(allow) if allow else None,
        "deny": str(deny) if deny else None,
        "same_domain": bool(spec.get("same_domain", True)),
        "max_pages": max(1, min(MAX_PAGES_CAP, int(spec.get("max_pages") or DEFAULT_MAX_PAGES))),
        "max_depth": max(0, min(20, int(spec.get("max_depth") if spec.get("max_depth") is not None
                                        else DEFAULT_MAX_DEPTH))),
        "max_hours": max(0.05, min(72.0, float(spec.get("max_hours") or 24.0))),
        "delay_s": max(MIN_DELAY_S, float(delay)) if delay is not None else None,
        "max_tier": tier,
        "extract": extract,
        "selector": str(spec.get("selector")) if spec.get("selector") else None,
        "respect_robots": bool(spec.get("respect_robots", True)),
        "allow_private": bool(spec.get("allow_private", False)),
        "label": str(spec.get("label") or "")[:200],
    }


class Job:
    def __init__(self, root: Path, job_id: str) -> None:
        self.id = job_id
        self.dir = root / job_id
        self._lock = threading.Lock()
        self.data: dict[str, Any] = json.loads((self.dir / "job.json").read_text())
        self.stop_flag = threading.Event()

    # -- persistence ---------------------------------------------------------

    @classmethod
    def create(cls, root: Path, spec: dict[str, Any]) -> "Job":
        job_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        d = root / job_id
        d.mkdir(parents=True)
        now = _now()
        data = {"id": job_id, "spec": spec, "state": "queued", "created_at": now, "updated_at": now,
                "started_at": None, "finished_at": None, "error": None,
                "counts": {"done": 0, "failed": 0, "items": 0, "blocked": 0},
                "last_url": None, "last_access": None, "retry_after_s": None, "hold_until": None}
        (d / "job.json").write_text(json.dumps(data))
        job = cls(root, job_id)
        with job.db() as db:
            for u in spec["start_urls"]:
                db.execute("INSERT OR IGNORE INTO urls(url, depth, state) VALUES (?, 0, 'pending')", (u,))
        return job

    def db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.dir / "frontier.sqlite", timeout=30)
        db.execute("CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY, url TEXT UNIQUE, depth INT, "
                   "state TEXT, outcome TEXT, tier TEXT, at REAL)")
        db.execute("CREATE INDEX IF NOT EXISTS urls_state ON urls(state, depth, id)")
        return db

    def save(self, **changes: Any) -> None:
        with self._lock:
            self.data.update(changes)
            self.data["updated_at"] = _now()
            tmp = self.dir / "job.json.tmp"
            tmp.write_text(json.dumps(self.data))
            tmp.replace(self.dir / "job.json")

    @property
    def state(self) -> str:
        return self.data["state"]

    @property
    def uses_browser(self) -> bool:
        return self.data["spec"]["max_tier"] != "static"

    def status(self) -> dict[str, Any]:
        with self._lock:
            out = json.loads(json.dumps(self.data))
        try:
            with self.db() as db:
                out["counts"]["queued"] = db.execute("SELECT COUNT(*) FROM urls WHERE state='pending'").fetchone()[0]
        except sqlite3.Error:
            pass
        if out.get("hold_until"):
            out["retry_after_s"] = int(max(0, out["hold_until"] - _now()))
        return out

    def append_item(self, item: dict[str, Any]) -> None:
        with open(self.dir / "items.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")

    def results(self, cursor: int, limit: int) -> dict[str, Any]:
        items, n = [], 0
        path = self.dir / "items.jsonl"
        if path.exists():
            with open(path, encoding="utf-8") as fh:
                for n, line in enumerate(fh):
                    if n < cursor:
                        continue
                    if len(items) >= limit:
                        break
                    try:
                        items.append(json.loads(line))
                    except ValueError:
                        continue
        nxt = cursor + len(items)
        total = self.data["counts"].get("items", 0)
        return {"id": self.id, "state": self.state, "items": items, "cursor": cursor,
                "next_cursor": nxt if nxt < total else None, "total_items": total}


class JobManager:
    """Owns job threads. ``fetch(url, max_tier)`` -> (page|None, tier, access);
    ``to_item(page, spec)`` -> dict; ``links(page, url)`` -> list of hrefs."""

    def __init__(self, root: str | os.PathLike | None, *, fetch: Callable, to_item: Callable, links: Callable,
                 memory: access.HostMemory, sleep: Callable[[float], None] | None = None,
                 robots_fetch: Callable[[str], str | None] | None = None,
                 private_check: Callable[[str], bool] = _private_host) -> None:
        default = Path(os.environ.get("SCRAPLING_STATE_DIR", "/app/state")) / "jobs"
        self.root = Path(root) if root else default
        self.fetch, self.to_item, self.links, self.memory = fetch, to_item, links, memory
        self.robots_fetch = robots_fetch or _robots_fetch
        self.private_check = private_check
        self._sleep_fn = sleep
        self._jobs: dict[str, Job] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._lock = threading.RLock()
        self._started = False

    # -- lifecycle -------------------------------------------------------------

    def start(self) -> None:
        """Load jobs from disk, re-queue interrupted ones, start the scheduler."""
        self.root.mkdir(parents=True, exist_ok=True)
        self.purge_old()
        for d in sorted(self.root.iterdir()):
            if (d / "job.json").exists():
                try:
                    job = Job(self.root, d.name)
                except (OSError, ValueError):
                    continue
                if job.state in ("running", "rate_limited"):
                    job.save(state="queued")
                self._jobs[job.id] = job
        self._started = True
        threading.Thread(target=self._scheduler, daemon=True, name="jobs-scheduler").start()

    def purge_old(self, now: float | None = None) -> int:
        now = now or _now()
        n = 0
        if not self.root.exists():
            return 0
        for d in list(self.root.iterdir()):
            try:
                data = json.loads((d / "job.json").read_text())
            except (OSError, ValueError):
                continue
            if data.get("state") in FINAL and now - float(data.get("finished_at") or now) > RETENTION_S:
                shutil.rmtree(d, ignore_errors=True)
                with self._lock:
                    self._jobs.pop(d.name, None)
                n += 1
        return n

    def _scheduler(self) -> None:  # pragma: no cover - timing loop
        last_purge = _now()
        while True:
            try:
                self.schedule()
                if _now() - last_purge > 3600:
                    self.purge_old()
                    last_purge = _now()
            except Exception:
                pass
            time.sleep(1.0)

    def schedule(self) -> list[str]:
        """Start queued jobs within the concurrency limits. Returns started ids."""
        started = []
        with self._lock:
            running = [j for j in self._jobs.values() if j.id in self._threads and self._threads[j.id].is_alive()]
            browsers = sum(1 for j in running if j.uses_browser)
            statics = len(running) - browsers
            for job in sorted(self._jobs.values(), key=lambda j: j.data["created_at"]):
                if job.state != "queued" or (job.id in self._threads and self._threads[job.id].is_alive()):
                    continue
                if job.uses_browser and browsers >= BROWSER_JOBS_MAX:
                    continue
                if not job.uses_browser and statics >= STATIC_JOBS_MAX:
                    continue
                job.stop_flag.clear()
                t = threading.Thread(target=self.run_job, args=(job,), daemon=True, name=f"job-{job.id}")
                self._threads[job.id] = t
                t.start()
                started.append(job.id)
                if job.uses_browser:
                    browsers += 1
                else:
                    statics += 1
        return started

    # -- API -------------------------------------------------------------------

    def create(self, raw_spec: dict[str, Any]) -> dict[str, Any]:
        spec = validate_spec(raw_spec)
        if not spec["allow_private"]:
            for u in spec["start_urls"]:
                if self.private_check(urlsplit(u).hostname or ""):
                    raise JobError(f"start_urls: private-network host refused: {u}")
        self.root.mkdir(parents=True, exist_ok=True)
        job = Job.create(self.root, spec)
        with self._lock:
            self._jobs[job.id] = job
        if self._started:
            self.schedule()
        return job.status()

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs = sorted(self._jobs.values(), key=lambda j: j.data["created_at"], reverse=True)
        return [{k: j.status().get(k) for k in ("id", "state", "counts", "created_at", "updated_at", "spec")}
                for j in jobs]

    def pause(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        if job.state in ACTIVE:
            job.stop_flag.set()
            job.save(state="paused")
        return job.status()

    def resume(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        if job.state == "paused":
            job.save(state="queued", finished_at=None)
            if self._started:
                self.schedule()
        return job.status()

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        if job.state not in FINAL:
            job.stop_flag.set()
            job.save(state="cancelled", finished_at=_now())
        return job.status()

    # -- crawl loop ------------------------------------------------------------

    def _sleep(self, job: Job, seconds: float) -> bool:
        """Sleep unless the job is stopped. Returns False when stopped."""
        if self._sleep_fn is not None:
            self._sleep_fn(seconds)
            return not job.stop_flag.is_set()
        return not job.stop_flag.wait(max(0.0, seconds))

    def _allowed(self, spec: dict[str, Any], url: str, roots: set[str]) -> bool:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return False
        if spec["same_domain"] and not spec["allow"]:
            host = parts.hostname.lower()
            if not any(host == r or host.endswith("." + r) for r in roots):
                return False
        if spec["allow"] and not re.search(spec["allow"], url):
            return False
        if spec["deny"] and re.search(spec["deny"], url):
            return False
        return True

    def run_job(self, job: Job) -> None:
        spec = job.data["spec"]
        roots = {(urlsplit(u).hostname or "").lower().removeprefix("www.") for u in spec["start_urls"]}
        robots: dict[str, robotparser.RobotFileParser | None] = {}
        private: dict[str, bool] = {}
        started = job.data.get("started_at") or _now()
        job.save(state="running", started_at=started, error=None)
        deadline = started + spec["max_hours"] * 3600
        try:
            while not job.stop_flag.is_set():
                if job.data["counts"]["done"] >= spec["max_pages"]:
                    return self._finish(job, "done", "max_pages reached")
                if _now() > deadline:
                    return self._finish(job, "done", "max_hours reached")
                with job.db() as db:
                    row = db.execute("SELECT id, url, depth FROM urls WHERE state='pending' "
                                     "ORDER BY depth, id LIMIT 1").fetchone()
                if row is None:
                    return self._finish(job, "done", None)
                rid, url, depth = row
                host = access.host_of(url)

                hold = self.memory.cooldown_remaining(host)
                if hold > 0:
                    if job.stop_flag.is_set():
                        return
                    job.save(state="rate_limited", hold_until=_now() + hold)
                    if not self._sleep(job, min(hold, 300.0)):
                        return
                    job.save(state="running", hold_until=None)
                    continue

                if spec["respect_robots"]:
                    if host not in robots:
                        robots[host] = _parse_robots(self.robots_fetch, url)
                    rp = robots[host]
                    if rp is not None and not rp.can_fetch(ROBOTS_UA, url):
                        self._mark(job, rid, "failed", "robots_disallowed", None)
                        continue
                if not spec["allow_private"]:
                    if host not in private:
                        private[host] = self.private_check(host)
                    if private[host]:
                        self._mark(job, rid, "failed", "forbidden", None)
                        continue

                try:
                    page, tier, info = self.fetch(url, spec["max_tier"])
                except Exception as exc:  # network at every tier
                    info = getattr(exc, "access", None) or {"outcome": "network", "next": str(exc)[:300]}
                    page, tier = None, None
                outcome = info.get("outcome")
                job.save(last_url=url, last_access=info)

                if outcome == "rate_limited":
                    # Leave the URL pending; the hold check above waits it out.
                    job.data["counts"]["blocked"] += 1
                    job.save(counts=job.data["counts"])
                    continue

                if outcome == "ok" and page is not None:
                    item = self.to_item(page, spec)
                    item.update({"url": url, "depth": depth, "tier": tier, "fetched_at": _now()})
                    job.append_item(item)
                    job.data["counts"]["items"] += 1
                    if depth < spec["max_depth"]:
                        new = []
                        for href in self.links(page, url):
                            absu = urldefrag(urljoin(url, href))[0]
                            if self._allowed(spec, absu, roots):
                                new.append((absu, depth + 1))
                        if new:
                            with job.db() as db:
                                db.executemany("INSERT OR IGNORE INTO urls(url, depth, state) "
                                               "VALUES (?, ?, 'pending')", new)
                    self._mark(job, rid, "done", outcome, tier)
                else:
                    if outcome in ("bot_challenge", "forbidden", "auth_required"):
                        job.data["counts"]["blocked"] += 1
                    self._mark(job, rid, "failed", outcome, tier)

                delay = spec["delay_s"] if spec["delay_s"] is not None else (
                    STEALTH_DELAY_S if tier == "stealth" else DEFAULT_DELAY_S)
                if not self._sleep(job, delay):
                    return
        except Exception as exc:
            job.save(state="failed", error=str(exc)[:500], finished_at=_now())

    def _mark(self, job: Job, rid: int, state: str, outcome: str | None, tier: str | None) -> None:
        with job.db() as db:
            db.execute("UPDATE urls SET state=?, outcome=?, tier=?, at=? WHERE id=?",
                       (state, outcome, tier, _now(), rid))
        key = "done" if state == "done" else "failed"
        job.data["counts"][key] += 1
        job.save(counts=job.data["counts"])

    def _finish(self, job: Job, state: str, note: str | None) -> None:
        job.save(state=state, finished_at=_now(), error=None, note=note, hold_until=None)


def _robots_fetch(url: str) -> str | None:
    import urllib.request

    parts = urlsplit(url)
    robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
    try:
        req = urllib.request.Request(robots_url, headers={"User-Agent": ROBOTS_UA})
        with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 - http(s) only
            if r.status != 200:
                return None
            return r.read(512_000).decode("utf-8", "replace")
    except Exception:
        return None


def _parse_robots(fetch: Callable[[str], str | None], url: str) -> robotparser.RobotFileParser | None:
    text = fetch(url)
    if text is None:
        return None  # no robots.txt (or unreachable): allowed
    rp = robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    return rp


__all__ = ["JobManager", "JobError", "validate_spec"]

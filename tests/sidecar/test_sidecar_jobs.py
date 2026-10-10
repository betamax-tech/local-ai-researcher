"""Background crawl jobs. Run: uv run --with pytest pytest tests/sidecar -q"""
from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import sidecar_access as acc  # noqa: E402
import sidecar_jobs as sj  # noqa: E402


class Clock:
    def __init__(self):
        self.t = 2_000_000.0

    def __call__(self):
        return self.t


class Site:
    """url -> (outcome, links). fetch() mimics _fetch_with_access."""

    def __init__(self, pages, memory=None):
        self.pages, self.calls, self.memory = pages, [], memory

    def fetch(self, url, max_tier):
        self.calls.append(url)
        outcome, links = self.pages.get(url, ("not_found", []))
        if outcome == "rate_limited" and self.memory is not None:
            self.memory.record(acc.host_of(url), "rate_limited", tier="static", cooldown_s=600)
        page = {"url": url, "links": links} if outcome == "ok" else None
        return page, "static", {"outcome": outcome}


def manager(tmp_path, site, *, robots=None, private=lambda h: False, memory=None):
    memory = memory or acc.HostMemory(tmp_path / "hosts.json", clock=Clock())
    site.memory = site.memory or memory
    slept = []
    m = sj.JobManager(tmp_path / "jobs", fetch=site.fetch,
                      to_item=lambda page, spec: {"title": page["url"], "text": "t"},
                      links=lambda page, url: page["links"], memory=memory, sleep=slept.append,
                      robots_fetch=lambda url: robots, private_check=private)
    return m, slept, memory


def run(m, job_id):
    m.run_job(m.get(job_id))
    return m.get(job_id).status()


A = "https://ex.test/"


def test_crawl_follows_same_domain_links_to_max_depth(tmp_path):
    site = Site({A: ("ok", ["/a", "https://other.test/x", "/b#frag"]),
                 A + "a": ("ok", ["/c"]), A + "b": ("ok", []), A + "c": ("ok", ["/d"])})
    m, slept, _ = manager(tmp_path, site)
    job = m.create({"start_urls": [A], "max_depth": 2})
    st = run(m, job["id"])
    assert st["state"] == "done" and st["counts"]["items"] == 4
    assert "https://other.test/x" not in site.calls and A + "d" not in site.calls  # off-domain, too deep
    assert slept and all(s == sj.DEFAULT_DELAY_S for s in slept)
    res = m.get(job["id"]).results(0, 2)
    assert len(res["items"]) == 2 and res["next_cursor"] == 2
    assert m.get(job["id"]).results(2, 10)["next_cursor"] is None


def test_max_pages_and_allow_deny(tmp_path):
    site = Site({A: ("ok", ["/doc/1", "/doc/2", "/doc/3", "/tag/x"]), **{A + f"doc/{i}": ("ok", []) for i in (1, 2, 3)}})
    m, _, _ = manager(tmp_path, site)
    job = m.create({"start_urls": [A], "allow": r"ex\.test/($|doc/)", "deny": r"/doc/3", "max_pages": 3})
    st = run(m, job["id"])
    assert st["counts"]["done"] == 3 and A + "tag/x" not in site.calls and A + "doc/3" not in site.calls


def test_rate_limit_parks_the_job_without_refetching(tmp_path):
    site = Site({A: ("ok", ["/a"]), A + "a": ("rate_limited", [])})
    m, slept, mem = manager(tmp_path, site)
    job = m.create({"start_urls": [A]})
    j = m.get(job["id"])

    def stop_after_hold(seconds):
        if j.state == "rate_limited":
            j.stop_flag.set()
    m._sleep_fn = stop_after_hold
    m.run_job(j)
    st = j.status()
    assert st["state"] == "rate_limited" and st["retry_after_s"] > 0
    assert site.calls.count(A + "a") == 1  # waited out the hold, did not retry inside it


def test_robots_and_private_hosts_are_refused(tmp_path):
    site = Site({A: ("ok", ["/private/x", "/ok"]), A + "ok": ("ok", [])})
    m, _, _ = manager(tmp_path, site, robots="User-agent: *\nDisallow: /private/\n")
    st = run(m, m.create({"start_urls": [A]})["id"])
    assert A + "private/x" not in site.calls and st["counts"]["failed"] == 1
    m2, _, _ = manager(tmp_path / "2", Site({}), private=lambda h: True)
    with pytest.raises(sj.JobError, match="private"):
        m2.create({"start_urls": ["http://10.0.0.5/"]})


def test_pause_resume_cancel_and_restart_requeue(tmp_path):
    site = Site({A: ("ok", [])})
    m, _, mem = manager(tmp_path, site)
    jid = m.create({"start_urls": [A]})["id"]
    assert m.pause(jid)["state"] == "paused"
    assert m.resume(jid)["state"] == "queued"
    m.get(jid).save(state="running")  # simulate a crash mid-run
    m2 = sj.JobManager(tmp_path / "jobs", fetch=site.fetch, to_item=lambda p, s: {}, links=lambda p, u: [],
                       memory=mem, sleep=lambda s: None)
    m2._scheduler = lambda: None  # no background thread in tests
    m2.start()
    assert m2.get(jid).state == "queued"
    assert m2.cancel(jid)["state"] == "cancelled"


def test_scheduler_runs_one_browser_job_at_a_time(tmp_path):
    gate = threading.Event()

    def slow_fetch(url, tier):
        gate.wait(5)
        return {"links": []}, "static", {"outcome": "ok"}
    mem = acc.HostMemory(tmp_path / "h.json")
    m = sj.JobManager(tmp_path / "jobs", fetch=slow_fetch, to_item=lambda p, s: {}, links=lambda p, u: [],
                      memory=mem, sleep=lambda s: None, robots_fetch=lambda u: None, private_check=lambda h: False)
    a = m.create({"start_urls": ["https://a.test/"]})["id"]
    b = m.create({"start_urls": ["https://b.test/"]})["id"]
    c = m.create({"start_urls": ["https://c.test/"], "max_tier": "static"})["id"]
    started = m.schedule()
    assert a in started and b not in started and c in started
    gate.set()
    for t in list(m._threads.values()):
        t.join(5)
    assert m.get(a).state == "done" and m.get(b).state == "queued"


def test_finished_jobs_are_purged_after_14_days(tmp_path):
    m, _, _ = manager(tmp_path, Site({A: ("ok", [])}))
    jid = m.create({"start_urls": [A]})["id"]
    run(m, jid)
    fin = m.get(jid).data["finished_at"]
    assert m.purge_old(now=fin + 13 * 86400) == 0
    assert m.purge_old(now=fin + 15 * 86400) == 1 and not (tmp_path / "jobs" / jid).exists()


@pytest.mark.parametrize("spec,msg", [
    ({}, "start_urls"), ({"start_urls": ["ftp://x"]}, "http"), ({"start_urls": [A], "allow": "("}, "regex"),
    ({"start_urls": [A], "max_tier": "turbo"}, "max_tier"), ({"start_urls": [A], "extract": "selector"}, "selector"),
])
def test_spec_validation(spec, msg):
    with pytest.raises(sj.JobError, match=msg):
        sj.validate_spec(spec)


def test_spec_caps():
    s = sj.validate_spec({"start_urls": A, "max_pages": 10**6, "delay_s": 0.1})
    assert s["max_pages"] == sj.MAX_PAGES_CAP and s["delay_s"] == sj.MIN_DELAY_S and s["start_urls"] == [A]
    assert json.dumps(s)

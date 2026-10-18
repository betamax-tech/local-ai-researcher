"""Impersonation reaches the static fetcher, never browser-tier kwargs."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import scrapling_sidecar as sc


def test_static_impersonation_forwarding(monkeypatch):
    calls = []
    fetcher = SimpleNamespace(get=lambda url, **kw: calls.append((url, kw)))
    monkeypatch.setattr(sc, "_load_fetchers", lambda: (fetcher, None, None))
    sc._fetch_tier("static", "https://example.com", impersonate="chrome131", headers={"User-Agent": "browser UA"})
    assert calls == [("https://example.com", {"impersonate": "chrome131", "headers": {"User-Agent": "browser UA"}})]
    sc._fetch_tier("static", "https://example.com")
    assert calls[-1][1] == {}


@pytest.mark.parametrize("handler", [sc._scrape_page_payload, sc._scrape_listing_payload])
def test_payload_forwards_impersonation(monkeypatch, handler):
    calls = []
    def fetch(url, mode, **kw):
        calls.append(kw)
        return None, None, {"outcome": "rate_limited"}
    monkeypatch.setattr(sc, "_fetch_with_access", fetch)
    handler({"url": "https://example.com", "impersonate": "chrome131"})
    assert calls[0]["impersonate"] == "chrome131"


def test_access_layer_forwards_to_tier(monkeypatch, tmp_path):
    calls = []
    def fetch(tier, url, **kw):
        calls.append(kw)
        return None
    with pytest.raises(sc.AccessStop):
        sc._fetch_with_access("https://example.com", "static", impersonate="chrome131", fetch=fetch,
                              memory=sc.access.HostMemory(tmp_path / "hosts.sqlite"))
    assert calls[0]["impersonate"] == "chrome131"

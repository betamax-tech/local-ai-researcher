"""Bounded JSON-LD extraction and the existing sidecar payload paths (no network)."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import scrapling_sidecar as sc  # noqa: E402


class Selection(list):
    def get(self):
        return self[0] if self else None

    def getall(self):
        return list(self)


class Page:
    status = 200
    url = "https://example.test/product"
    text = "Product description with enough words"

    def __init__(self, blocks=()):
        self.blocks = [SimpleNamespace(text=text) for text in blocks]

    def css(self, selector):
        if selector == 'script[type="application/ld+json"]':
            return Selection(self.blocks)
        if selector in ("main", ".product"):
            return Selection([self])
        if selector == "title::text":
            return Selection(["Product"])
        return Selection()


def test_preserves_objects_arrays_graphs_and_json_values():
    values = [{"@type": "Product", "name": "Widget"},
              [{"@type": "Offer", "price": 12.5}],
              {"@context": "https://schema.org", "@graph": [{"@id": "x"}]},
              None, "a string", 42, False]
    assert sc._json_ld(Page(map(json.dumps, values))) == values


def test_empty_and_invalid_blocks_are_skipped_independently():
    blocks = ["", "{bad", "NaN", "Infinity", '{"price": NaN}', '{"name":"valid"}']
    assert sc._json_ld(Page(blocks)) == [{"name": "valid"}]
    assert sc._json_ld(Page()) == []


def test_only_first_fifty_blocks_are_inspected_even_if_invalid():
    assert len(sc._json_ld(Page(["{}"] * 51))) == 50
    assert sc._json_ld(Page(["invalid"] * 50 + ['{"late":true}'])) == []


def test_aggregate_utf8_budget_and_exact_boundary():
    # JSON string with multibyte content exactly fills the byte budget.
    large = '"' + "é" * ((sc.JSON_LD_MAX_BYTES - 2) // 2) + '"'
    assert len(large.encode("utf-8")) == sc.JSON_LD_MAX_BYTES
    assert sc._json_ld(Page([large, "{} "])) == [json.loads(large)]
    first = '"' + "x" * (sc.JSON_LD_MAX_BYTES - 4) + '"'
    assert sc._json_ld(Page([first, "{}", "{} "])) == [json.loads(first), {}]


def test_oversized_block_is_skipped_not_truncated_and_later_small_block_survives():
    oversized = json.dumps("x" * sc.JSON_LD_MAX_BYTES)
    assert sc._json_ld(Page([oversized, '{"small":true}'])) == [{"small": True}]


def test_invalid_input_also_consumes_aggregate_parse_budget():
    assert sc._json_ld(Page(["x" * sc.JSON_LD_MAX_BYTES, "{} "])) == []


def test_decoder_recursion_error_does_not_fail_extraction(monkeypatch):
    # C decoder nesting limits differ across Python versions; test the failure
    # contract without assuming a particular implementation's depth threshold.
    loads = json.loads

    def decode(text, **kwargs):
        if text == "deep":
            raise RecursionError("decoder nesting limit")
        return loads(text, **kwargs)

    monkeypatch.setattr(sc.json, "loads", decode)
    assert sc._json_ld(Page(["deep", "{}"])) == [{}]


def test_selector_failure_does_not_fail_extraction():
    class BrokenPage:
        def css(self, selector):
            raise ValueError("no selector support")
    assert sc._json_ld(BrokenPage()) == []


@pytest.mark.parametrize("listing,selector", [(False, None), (False, ".product"), (True, None)])
def test_metadata_is_page_level_and_does_not_change_records(monkeypatch, listing, selector):
    metadata = {"@graph": [{"@type": "Product", "offers": {"price": 5}}]}
    page = Page([json.dumps(metadata)])
    monkeypatch.setattr(sc, "_fetch_with_access", lambda *a, **kw: (page, "static", {"outcome": "ok"}))
    fn = sc._scrape_listing_payload if listing else sc._scrape_page_payload
    result = fn({"url": page.url, "selector": selector})
    assert result["json_ld"] == [metadata]
    assert "offers" not in result.get("field_candidates", {})
    assert all("json_ld" not in rec for rec in result["records"])
    assert result["access"] == {"outcome": "ok"}


@pytest.mark.parametrize("listing", [False, True])
def test_hold_response_has_empty_metadata_without_fetch(monkeypatch, listing):
    monkeypatch.setattr(sc, "_fetch_with_access", lambda *a, **kw: (None, None, {"outcome": "rate_limited"}))
    fn = sc._scrape_listing_payload if listing else sc._scrape_page_payload
    assert fn({"url": Page.url})["json_ld"] == []

"""Real parser regressions: scripts must not masquerade as rendered content."""
import sys
from pathlib import Path

from scrapling import Selector

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import scrapling_sidecar as sc


def test_nested_text_is_retained_and_noncontent_tags_are_ignored():
    page = Selector('<main>Prefix<p>Nested paragraph</p><pre>type Repository struct {}</pre>'
                    '<script>hydration secret</script><style>CSS words</style>'
                    '<noscript>Enable JavaScript</noscript><template>Hidden template</template></main>')
    text = sc._node_text(sc._pick_main_node(page))
    assert "Prefix" in text and "Nested paragraph" in text and "type Repository struct" in text
    for unwanted in ["hydration secret", "CSS words", "Enable JavaScript", "Hidden template"]:
        assert unwanted not in text


def test_script_heavy_shell_escalates_and_returns_only_rendered_prose(tmp_path):
    shell = Selector('<html><title>App</title><body><div id="root">Loading...</div>'
                     '<script>' + 'hydrationData ' * 4000 + '</script></body></html>')
    rendered = Selector('<html><title>App</title><body><main>' + 'Useful content ' * 50 +
                        '</main></body></html>')
    calls = []

    def fetch(tier, url, **kwargs):
        calls.append(tier)
        return shell if tier == "static" else rendered

    page, tier, info = sc._fetch_with_access('https://example.test/app', 'auto',
        memory=sc.access.HostMemory(tmp_path / 'hosts.json'), fetch=fetch)
    assert calls == ["static", "dynamic"]
    assert tier == 'dynamic' and info['outcome'] == 'ok'
    assert sc._node_text(sc._pick_main_node(page)).startswith('Useful content')


def test_body_script_does_not_inflate_main_content_word_count():
    page = Selector('<body><main>Loading...</main><script>' + 'word ' * 1000 + '</script></body>')
    signals = sc._page_signals(page)
    assert signals['main_words'] == 1
    assert 'word' not in signals['text']


def test_small_read_budget_reaches_browser_without_ten_second_floor(tmp_path):
    page = Selector('<main>' + 'Useful content ' * 50 + '</main>')
    calls = []

    def fetch(tier, url, **kwargs):
        calls.append((tier, kwargs['browser_opts']))
        return page

    args = sc._access_args({'budget_ms': 250, 'max_tier': 'dynamic'})
    assert args['budget_s'] == 0.25
    _, _, info = sc._fetch_with_access('https://example.test/bounded', 'dynamic',
        memory=sc.access.HostMemory(tmp_path / 'hosts.json'), fetch=fetch, **args)
    assert len(calls) == 1 and calls[0][0] == 'dynamic'
    assert 0 < calls[0][1]['timeout'] <= 250
    assert info['outcome'] == 'ok'

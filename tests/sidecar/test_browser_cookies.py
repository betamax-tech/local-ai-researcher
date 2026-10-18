"""Synthetic-only browser cookie tests. Never access the host browser/keyring."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import browser_cookies as bc  # noqa: E402

NOW = 1_800_000_000
PASSWORD = b"synthetic-test-password"


def chrome(seconds):
    return int((seconds + bc.CHROME_EPOCH) * 1_000_000)


def encrypt(host, value="synthetic-cookie", *, version=24, prefix=b"v11",
            password=PASSWORD, digest_host=None, raw=None):
    plain = value.encode()
    if version >= 24:
        plain = hashlib.sha256((digest_host or host).encode()).digest() + plain
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plain) + padder.finalize() if raw is None else raw
    key = hashlib.pbkdf2_hmac("sha1", password, b"saltysalt", 1, dklen=16)
    enc = Cipher(algorithms.AES(key), modes.CBC(b" " * 16)).encryptor()
    return prefix + enc.update(padded) + enc.finalize()


@pytest.fixture
def browser(tmp_path, monkeypatch):
    root = tmp_path / "Brave-Origin"
    profile = root / "Profile 1"
    profile.mkdir(parents=True)
    db = profile / "Cookies"
    con = sqlite3.connect(db)
    con.executescript("""
        CREATE TABLE meta (key TEXT, value TEXT);
        INSERT INTO meta VALUES ('version', '24');
        CREATE TABLE cookies (
            host_key TEXT, name TEXT, path TEXT, value TEXT, encrypted_value BLOB,
            is_secure INTEGER, is_httponly INTEGER, expires_utc INTEGER,
            creation_utc INTEGER, has_expires INTEGER, samesite INTEGER,
            top_frame_site_key TEXT, has_cross_site_ancestor INTEGER);
    """)
    con.commit()
    monkeypatch.setenv("LOCAL_RESEARCHER_BROWSER_USER_DATA_DIR", str(root))
    monkeypatch.setenv("LOCAL_RESEARCHER_BROWSER_PROFILE", "Profile 1")
    monkeypatch.setattr(bc.time, "time", lambda: NOW)
    monkeypatch.setattr(bc, "_safe_storage_passwords", lambda: [PASSWORD])

    def add(host=".example.co.uk", name="cf_clearance", value="synthetic-cookie",
            *, expires=NOW + 1000, created=NOW - 30, encrypted=None,
            session=False, partition="", path="/", same_site=1, ancestor=0):
        con.execute("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (host, name, path, value, encrypted or b"", 1, 1,
                     0 if expires is None else chrome(expires), chrome(created),
                     int(not session), same_site, partition, ancestor))
        con.commit()

    yield SimpleNamespace(add=add, con=con, db=db, root=root)
    con.close()


def test_default_names_expiry_flags_and_newest_clearance(browser):
    browser.add(created=NOW - 30)
    browser.add(host="login.example.co.uk", created=NOW - 10, path="/login")
    browser.add(name="_cfuvid", session=True, expires=None, same_site=0)
    browser.add(name="__cf_bm", same_site=2)
    browser.add(name="session-login")
    browser.add(created=NOW + 1, expires=NOW)  # newest but expired
    browser.add(expires=NOW - 1)
    browser.add(partition="https://other.com")
    result = bc.read_cookies("https://www.example.co.uk/path")
    assert result["domain"] == "example.co.uk"
    assert result["clearance_created_at"] == NOW - 10
    assert [c["name"] for c in result["cookies"]] == ["cf_clearance", "cf_clearance", "_cfuvid", "__cf_bm"]
    assert result["cookies"][0] == {
        "name": "cf_clearance", "value": "synthetic-cookie", "domain": ".example.co.uk",
        "path": "/", "secure": True, "httpOnly": True, "expires": NOW + 1000,
        "sameSite": "Lax"}
    assert result["cookies"][1]["path"] == "/login"
    assert "expires" not in result["cookies"][2]
    assert result["cookies"][2]["sameSite"] == "None"
    assert result["cookies"][3]["sameSite"] == "Strict"


@pytest.mark.parametrize("partition,ancestor,accepted", [
    ("https://indeed.com", 0, True),
    ("https://other.com", 0, False),
    ("http://indeed.com", 0, False),
    ("https://indeed.com", 1, False),
    ("https://indeed.com", None, False),
    ("https://ph.indeed.com", 0, False),
])
def test_partitioned_clearance_requires_exact_first_party_site(browser, partition, ancestor, accepted):
    browser.add(host=".indeed.com", partition=partition, ancestor=ancestor,
                encrypted=encrypt(".indeed.com"))
    result = bc.read_cookies("https://ph.indeed.com/jobs")
    assert len(result["cookies"]) == int(accepted)
    assert result["clearance_created_at"] == (NOW - 30 if accepted else None)
    if accepted:
        assert result["cookies"][0]["value"] == "synthetic-cookie"


@pytest.mark.parametrize("full_domain", [False, True])
def test_matching_partition_does_not_export_other_cookie_names(browser, full_domain):
    for name in ("_cfuvid", "__cf_bm", "login"):
        browser.add(host=".indeed.com", name=name, partition="https://indeed.com")
    assert bc.read_cookies("https://ph.indeed.com", full_domain=full_domain)["cookies"] == []


def test_partition_exception_preserves_default_name_allowlist(browser):
    browser.add(host=".indeed.com", name="login")
    browser.add(host=".indeed.com", partition="https://indeed.com")
    assert [c["name"] for c in bc.read_cookies("https://ph.indeed.com")["cookies"]] == ["cf_clearance"]


@pytest.mark.parametrize("url,good,bad", [
    ("https://www.example.co.uk", ".example.co.uk", [".other.co.uk", ".co.uk", ".evilexample.co.uk", ".example.co.uk.evil.com"]),
    ("https://alice.github.io", ".alice.github.io", [".bob.github.io", ".github.io", ".evilalice.github.io"]),
    ("https://shop.example.com", ".example.com", [".notexample.com", ".example.com.evil.org", ".com"]),
    ("https://bücher.de", ".xn--bcher-kva.de", [".other.de"]),
])
def test_full_domain_psl_boundaries_before_decryption(browser, url, good, bad):
    browser.add(host=good, name="login", value="only-authorized")
    browser.add(host="sub" + good, name="other-path", path="/private")
    for host in bad:
        browser.add(host=host, encrypted=b"v20unrelated-malformed")
    result = bc.read_cookies(url, full_domain=True)
    assert len(result["cookies"]) == 2
    assert {c["domain"] for c in result["cookies"]} == {good, "sub" + good}
    assert result["clearance_created_at"] is None


@pytest.mark.parametrize("version", [23, 24, 25])
@pytest.mark.parametrize("prefix", [b"v10", b"v11"])
def test_synthetic_encryption(browser, version, prefix):
    browser.con.execute("UPDATE meta SET value = ?", (str(version),))
    browser.con.commit()
    browser.add(encrypted=encrypt(".example.co.uk", "cookie-✓", version=version, prefix=prefix))
    assert bc.read_cookies("https://example.co.uk")["cookies"][0]["value"] == "cookie-✓"


def test_legacy_v10_password_and_empty_cookie(browser, monkeypatch):
    monkeypatch.setattr(bc, "_safe_storage_passwords", lambda: [])
    browser.add(encrypted=encrypt(".example.co.uk", "", prefix=b"v10", password=b"peanuts"))
    assert bc.read_cookies("https://example.co.uk")["cookies"][0]["value"] == ""


@pytest.mark.parametrize("ciphertext", [
    b"v11", b"v11short", b"v20" + b"x" * 16,
    encrypt(".example.co.uk", digest_host=".evil.com"),
    encrypt(".example.co.uk", raw=b"x" * 15 + b"\x00"),
    encrypt(".example.co.uk", raw=b"x" * 14 + b"\x01\x02"),
    encrypt(".example.co.uk", password=b"wrong-test-key"),
])
def test_malformed_ciphertext_fails_closed(browser, ciphertext):
    browser.add(encrypted=ciphertext)
    with pytest.raises(bc.CookieExtractionError, match="^Browser cookie extraction failed\\.$") as exc:
        bc.read_cookies("https://example.co.uk")
    assert exc.value.__cause__ is None


@pytest.mark.parametrize("url", [
    "file:///private", "https://localhost", "https://co.uk", "https://github.io",
    "https://127.0.0.1", "https://[::1]", "https://user:credential@example.com",
    "https://example.com:bad", "https://-bad.com", "not a URL",
])
def test_invalid_urls_do_not_read_database(browser, monkeypatch, url):
    monkeypatch.setattr(bc, "_read_rows", lambda _: pytest.fail("must validate before reading"))
    with pytest.raises(bc.CookieExtractionError):
        bc.read_cookies(url)


def test_modern_network_path_and_wal_snapshot(browser):
    browser.con.execute("PRAGMA journal_mode=WAL")
    browser.add(encrypted=encrypt(".example.co.uk"))
    # WAL stays live/open: backup must include the newest committed clearance.
    assert bc.read_cookies("https://example.co.uk")["cookies"][0]["value"] == "synthetic-cookie"
    browser.con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    network = browser.db.parent / "Network"
    network.mkdir()
    browser.db.rename(network / "Cookies")
    assert len(bc.read_cookies("https://example.co.uk")["cookies"]) == 1


@pytest.mark.parametrize("profile", ["..", ".", "../Profile 1", "/tmp/elsewhere"])
def test_profile_cannot_escape_root(browser, profile):
    with pytest.raises(bc.CookieExtractionError):
        bc.read_cookies("https://example.co.uk", profile=profile)


def test_cli_json_and_generic_errors(browser, monkeypatch, capsys):
    browser.add()
    assert bc.main(["--url", "https://example.co.uk"]) == 0
    out = capsys.readouterr()
    assert json.loads(out.out)["cookies"][0]["name"] == "cf_clearance"
    assert out.err == ""
    assert bc.main(["--url", "https://sensitive:credential@example.com"]) == 1
    out = capsys.readouterr()
    assert out.out == ""
    assert out.err == bc.ERROR + "\n"
    with pytest.raises(SystemExit) as exc:
        bc.main(["--url", "--credential-would-be-an-invalid-argument"])
    assert exc.value.code == 2
    assert capsys.readouterr().err == bc.ERROR + "\n"


def test_cli_refuses_terminal_output(browser, monkeypatch):
    browser.add()
    output = io.StringIO()
    output.isatty = lambda: True
    monkeypatch.setattr(sys, "stdout", output)
    assert bc.main(["--url", "https://example.co.uk"]) == 1
    assert output.getvalue() == ""


def test_missing_profile_sanitized_without_creating_files(browser, tmp_path):
    missing = tmp_path / "missing-user-dir"
    with pytest.raises(bc.CookieExtractionError, match=bc.ERROR):
        bc.read_cookies("https://example.co.uk", user_data_dir=missing)
    assert not missing.exists()


def test_keyring_reads_only_brave_storage_and_closes(monkeypatch):
    class Item:
        def __init__(self, label):
            self.label = label

        def get_label(self):
            return self.label

        def get_secret(self):
            assert self.label == "Brave Safe Storage"
            return PASSWORD

    calls = []
    collection = SimpleNamespace(is_locked=lambda: True,
                                 unlock=lambda: calls.append("unlock"),
                                 get_all_items=lambda: [Item("Chrome Safe Storage"), Item("Brave Safe Storage")])
    bus = SimpleNamespace(close=lambda: calls.append("close"))
    monkeypatch.setitem(sys.modules, "secretstorage", SimpleNamespace(
        dbus_init=lambda: bus, get_default_collection=lambda _: collection))
    assert bc._safe_storage_passwords() == [PASSWORD]
    assert calls == ["unlock", "close"]


def test_keyring_failure_never_exposes_details(browser, monkeypatch, capsys):
    browser.add(encrypted=encrypt(".example.co.uk"))

    def fail():
        raise RuntimeError("sensitive-keyring-detail")

    monkeypatch.setattr(bc, "_safe_storage_passwords", fail)
    assert bc.main(["--url", "https://example.co.uk"]) == 1
    assert capsys.readouterr() == ("", bc.ERROR + "\n")

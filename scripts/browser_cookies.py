"""Opt-in, host-only Brave cookie reader. Never log the returned credentials.

Install browser-cookies-requirements.txt; invoke with python3 and pipe stdout to
the caller, not a terminal/log. No browser is launched. The caller owns consent.
Full-domain means all cookies in the URL's registrable domain (including its
subdomains), not all browser cookies. Private PSL suffixes are isolation boundaries.
"""
from __future__ import annotations

import argparse
from functools import lru_cache
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from urllib.parse import urlsplit


ERROR = "Browser cookie extraction failed."
CF_NAMES = frozenset({"cf_clearance", "_cfuvid", "__cf_bm"})
CHROME_EPOCH = 11644473600


class CookieExtractionError(Exception):
    """Safe to expose; underlying exceptions must never be logged."""


@lru_cache(maxsize=1)
def _suffix_extractor():
    import tldextract

    # No network requests or persistent PSL cache, even on first invocation.
    return tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None,
                                include_psl_private_domains=True)


def _domain(host: str) -> str:
    host = host.encode("idna").decode("ascii").lower()
    if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*", host):
        raise ValueError("Invalid hostname")
    if any(len(label) > 63 or label.startswith("-") or label.endswith("-")
           for label in host.split(".")) or len(host) > 253:
        raise ValueError("Invalid hostname")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("IP hosts are not supported")
    result = _suffix_extractor()(host)
    domain = result.top_domain_under_public_suffix
    if not result.suffix or not domain:
        raise ValueError("No registrable domain")
    return domain


def _url_domain(url: str) -> str:
    parsed = urlsplit(url)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None):
        raise ValueError("Invalid URL")
    _ = parsed.port  # Validate malformed/out-of-range ports too.
    return _domain(parsed.hostname.rstrip("."))


def _safe_storage_passwords() -> list[bytes]:
    import secretstorage

    bus = secretstorage.dbus_init()
    try:
        collection = secretstorage.get_default_collection(bus)
        if collection.is_locked():
            collection.unlock()
        # Deliberately do not collect Chrome/Chromium or unrelated keyring secrets.
        return [item.get_secret() for item in collection.get_all_items()
                if item.get_label() == "Brave Safe Storage"]
    finally:
        bus.close()


def _decrypt(host: str, encrypted: bytes, version: int, passwords: list[bytes]) -> str:
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    if encrypted[:3] not in {b"v10", b"v11"} or not encrypted[3:] or len(encrypted[3:]) % 16:
        raise ValueError("Unsupported or malformed ciphertext")
    # Legacy Linux v10 used the fixed password; v11 uses Secret Service.
    candidates = passwords + ([b"peanuts"] if encrypted[:3] == b"v10" else [])
    for password in candidates:
        try:
            key = hashlib.pbkdf2_hmac("sha1", password, b"saltysalt", 1, dklen=16)
            decryptor = Cipher(algorithms.AES(key), modes.CBC(b" " * 16)).decryptor()
            padded = decryptor.update(encrypted[3:]) + decryptor.finalize()
            unpadder = padding.PKCS7(128).unpadder()
            plain = unpadder.update(padded) + unpadder.finalize()
            if version >= 24:
                if not hmac.compare_digest(plain[:32], hashlib.sha256(host.encode()).digest()):
                    continue
                plain = plain[32:]
            return plain.decode("utf-8")
        except (ValueError, UnicodeError):
            continue
    raise ValueError("Unable to decrypt cookie")


def _read_rows(db_path: Path) -> tuple[int, list[sqlite3.Row]]:
    # SQLite's backup API takes a consistent WAL-aware snapshot. Keeping it solely
    # in memory is safer than a credential-bearing temp file (and never writes to
    # the live profile). Bound retries when a browser holds an exclusive lock.
    deadline = time.monotonic() + 5

    def progress(_status, _remaining, _total):
        if time.monotonic() > deadline:
            raise TimeoutError()

    source = sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)
    snapshot = sqlite3.connect(":memory:")
    try:
        source.backup(snapshot, pages=256, progress=progress, sleep=0.05)
        snapshot.row_factory = sqlite3.Row
        version = int(snapshot.execute("SELECT value FROM meta WHERE key = 'version'").fetchone()[0])
        return version, snapshot.execute("SELECT * FROM cookies").fetchall()
    finally:
        snapshot.close()
        source.close()


def read_cookies(url: str, *, full_domain: bool = False,
                 user_data_dir: str | Path | None = None,
                 profile: str | None = None) -> dict:
    """Return {domain, cookies, clearance_created_at}; raises sanitized error.

    Only unexpired, unpartitioned cookies are exported. Cookie scope/path/flags
    and expiry are retained for the sidecar's browser cookie API. Session cookies
    omit expires. A missing clearance timestamp is None; timestamps are Unix seconds.
    Explicit paths override LOCAL_RESEARCHER_BROWSER_USER_DATA_DIR / _PROFILE.
    """
    try:
        domain = _url_domain(url)
        root = Path(user_data_dir or os.environ.get("LOCAL_RESEARCHER_BROWSER_USER_DATA_DIR")
                    or "~/.config/BraveSoftware/Brave-Origin").expanduser().resolve()
        selected = profile or os.environ.get("LOCAL_RESEARCHER_BROWSER_PROFILE") or "Profile 1"
        if selected in {".", ".."} or Path(selected).name != selected:
            raise ValueError("Invalid profile")
        profile_dir = (root / selected).resolve()
        if profile_dir.parent != root:
            raise ValueError("Invalid profile")
        db_path = profile_dir / "Network" / "Cookies"
        if not db_path.is_file():
            db_path = profile_dir / "Cookies"
        version, rows = _read_rows(db_path)
        now = time.time()
        cookies = []
        newest = None
        passwords = None
        for row in rows:
            host = row["host_key"]
            try:
                cookie_domain = _domain(host.removeprefix("."))
            except (ValueError, UnicodeError):
                continue
            if cookie_domain != domain or (not full_domain and row["name"] not in CF_NAMES):
                continue
            if "top_frame_site_key" in row.keys() and row["top_frame_site_key"]:
                continue  # Do not turn partitioned credentials into global cookies.
            expires = row["expires_utc"] / 1_000_000 - CHROME_EPOCH
            persistent = bool(row["has_expires"]) if "has_expires" in row.keys() else row["expires_utc"] != 0
            if persistent and expires <= now:
                continue
            encrypted = bytes(row["encrypted_value"] or b"")
            if encrypted:
                if passwords is None:
                    passwords = _safe_storage_passwords()
                value = _decrypt(host, encrypted, version, passwords)
            else:
                value = row["value"]
            cookie = {"name": row["name"], "value": value, "domain": host,
                      "path": row["path"], "secure": bool(row["is_secure"]),
                      "httpOnly": bool(row["is_httponly"])}
            if persistent:
                cookie["expires"] = expires
            if "samesite" in row.keys() and row["samesite"] in {0, 1, 2}:
                cookie["sameSite"] = {0: "None", 1: "Lax", 2: "Strict"}[row["samesite"]]
            cookies.append(cookie)
            if row["name"] == "cf_clearance" and row["creation_utc"] > 0:
                created = row["creation_utc"] / 1_000_000 - CHROME_EPOCH
                newest = created if newest is None else max(newest, created)
        return {"domain": domain, "cookies": cookies, "clearance_created_at": newest}
    except Exception:
        raise CookieExtractionError(ERROR) from None


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default echoes invalid arguments (possibly credential URLs).
        self.exit(2, ERROR + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--full-domain", action="store_true")
    args = parser.parse_args(argv)
    try:
        if sys.stdout.isatty():
            raise CookieExtractionError(ERROR)
        result = read_cookies(args.url, full_domain=args.full_domain)
        sys.stdout.write(json.dumps(result) + "\n")
        return 0
    except Exception:
        sys.stderr.write(ERROR + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

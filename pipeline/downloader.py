"""
NSE Platform — Bhav Copy Downloader
=====================================
Downloads the NSE F&O UDiFF bhav copy for any dates not yet processed.
NSE switched to UDiFF format from July 8 2024.

URL pattern:
  https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{YYYYMMDD}_F_0000.csv.zip

Usage (standalone):
    python pipeline/downloader.py

Called automatically by pipeline/startup.py on app launch.
"""

import io
import json
import logging
import time
import zipfile
from datetime import date, timedelta
from pathlib import Path

import httpx
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import DATA_ROOT

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# UDiFF F&O bhav copy (active from July 8, 2024 onwards)
FO_URL = (
    "https://nsearchives.nseindia.com/content/fo/"
    "BhavCopy_NSE_FO_0_0_0_{date}_F_0000.csv.zip"
)

# NSE requires these headers or it returns 401 / empty
NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer":         "https://www.nseindia.com/",
}

# State file — one global list of fully-processed bhav copy dates
STATE_FILE = DATA_ROOT / "processed_dates.json"

# Raw downloads land here before processing
RAW_DIR = DATA_ROOT / "raw_downloads"

# NSE is closed on weekends; this list is checked before attempting download.
# Public holidays are NOT pre-listed — a 404 on a weekday = holiday, handled gracefully.
WEEKENDS = {5, 6}   # Saturday=5, Sunday=6


# ── State helpers ─────────────────────────────────────────────────────────────

def load_state() -> dict:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"last_updated": None, "processed_dates": []}


def save_state(state: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, default=str)


def mark_processed(date_str: str):
    """Add a date (YYYY-MM-DD) to the processed list and save."""
    state = load_state()
    if date_str not in state["processed_dates"]:
        state["processed_dates"].append(date_str)
        state["processed_dates"].sort()
    state["last_updated"] = date.today().isoformat()
    save_state(state)


def get_processed_dates() -> set[str]:
    return set(load_state().get("processed_dates", []))


# ── Date helpers ──────────────────────────────────────────────────────────────

def trading_dates_since(start: date, end: date) -> list[date]:
    """Return weekday dates between start and end inclusive."""
    out = []
    cur = start
    while cur <= end:
        if cur.weekday() not in WEEKENDS:
            out.append(cur)
        cur += timedelta(days=1)
    return out


def missing_dates(from_date: date | None = None) -> list[date]:
    """
    Return weekday dates that haven't been processed yet.
    Defaults to checking from Jan 1 2025 (adjust START_DATE in config if needed).
    Only includes dates up to yesterday — today's data isn't available until ~6pm.
    """
    processed = get_processed_dates()
    start = from_date or date(2025, 1, 1)
    end   = date.today() - timedelta(days=1)
    return [
        d for d in trading_dates_since(start, end)
        if d.isoformat() not in processed
    ]


# ── Download ──────────────────────────────────────────────────────────────────

def _get_nse_session() -> httpx.Client:
    """
    NSE requires a real browser session cookie.
    We hit the homepage first to get cookies, then download.
    """
    client = httpx.Client(
        headers=NSE_HEADERS,
        follow_redirects=True,
        timeout=30,
    )
    try:
        client.get("https://www.nseindia.com/", timeout=15)
        time.sleep(1)   # polite delay
    except Exception:
        pass   # proceed anyway; cookie may not be strictly required for archives
    return client


def download_fo_bhav(trade_date: date, client: httpx.Client | None = None) -> Path | None:
    """
    Download the F&O bhav copy zip for a single date.
    Returns the path to the extracted CSV, or None if unavailable (holiday/weekend).
    """
    date_str  = trade_date.strftime("%Y%m%d")
    url       = FO_URL.format(date=date_str)
    out_dir   = RAW_DIR / trade_date.strftime("%Y-%m-%d")
    csv_name  = f"BhavCopy_NSE_FO_{date_str}.csv"
    csv_path  = out_dir / csv_name

    if csv_path.exists():
        log.info(f"  Already downloaded: {csv_path.name}")
        return csv_path

    out_dir.mkdir(parents=True, exist_ok=True)
    own_client = client is None
    if own_client:
        client = _get_nse_session()

    try:
        log.info(f"  Downloading {url}")
        r = client.get(url)

        if r.status_code == 404:
            log.info(f"  {trade_date} — not available (holiday or weekend)")
            return None
        r.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            # The zip contains one CSV; extract it regardless of internal filename
            names = z.namelist()
            if not names:
                log.warning(f"  Empty zip for {trade_date}")
                return None
            extracted = z.read(names[0])
            csv_path.write_bytes(extracted)

        log.info(f"  ✓ Saved {csv_path}")
        return csv_path

    except httpx.HTTPStatusError as e:
        log.warning(f"  HTTP {e.response.status_code} for {trade_date}")
        return None
    except Exception as e:
        log.warning(f"  Download failed for {trade_date}: {e}")
        return None
    finally:
        if own_client:
            client.close()


# ── Public API ─────────────────────────────────────────────────────────────────

def download_missing(from_date: date | None = None) -> list[Path]:
    """
    Download bhav copies for all dates not yet in processed_dates.json.
    Returns list of downloaded CSV paths (skips holidays automatically).
    """
    dates = missing_dates(from_date)
    if not dates:
        log.info("No missing dates to download.")
        return []

    log.info(f"Downloading {len(dates)} missing date(s)…")
    downloaded = []
    client = _get_nse_session()

    try:
        for d in dates:
            path = download_fo_bhav(d, client)
            if path:
                downloaded.append(path)
            time.sleep(0.5)   # be polite to NSE servers
    finally:
        client.close()

    return downloaded


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    paths = download_missing()
    print(f"\nDownloaded {len(paths)} file(s).")

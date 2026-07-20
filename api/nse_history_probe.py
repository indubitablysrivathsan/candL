"""
nse_history_probe.py

Standalone script (no dependency on your project's config.py) that walks
backward day-by-day over NSE's daily data endpoints and figures out how far
back each one is actually reachable, by pinging with GET and checking the
status code only (no download / no read of the body).

Rule: for each source, walk backward one calendar day at a time. Stop once
we hit 7 CONSECUTIVE calendar-day misses (404 / error) in a row. That
absorbs weekends/holidays (which are never 7 days long) while still
detecting the true "this feed didn't exist yet" boundary.

Outputs:
  - manifest.csv   -> date, source, url, status_code, exists
  - timeline.png   -> one row per source, dots for exists/missing across time

Usage:
  python nse_history_probe.py
"""

from __future__ import annotations
from datetime import datetime, timedelta
from pathlib import Path
import csv
import time

import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

# ── constants (mirrors your downloader.py) ──────────────────────────────────

NSE_BASE_URL = "https://nsearchives.nseindia.com"
NSE_HIST_BASE_URL = "https://archives.nseindia.com/content/historical"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 "
        "(KHTML, like Gecko) "
        "Chrome/136.0 Safari/537.36"
    )
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

REQUEST_DELAY_SECONDS = 0.05   # small delay between pings, per your note
REQUEST_TIMEOUT = 15
CONSECUTIVE_MISS_LIMIT = 7

MANIFEST_PATH = Path("../history/manifest.csv")
PLOT_PATH = Path("../history/timeline.png")


# ── URL builders (new schema, from your downloader.py) ─────────────────────

def url_fo(d: datetime) -> str:
    compact = d.strftime("%Y%m%d")
    return f"{NSE_BASE_URL}/content/fo/BhavCopy_NSE_FO_0_0_0_{compact}_F_0000.csv.zip"

def url_eq_bhav(d: datetime) -> str:
    dmy = d.strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/products/content/sec_bhavdata_full_{dmy}.csv"

def url_cm_bhav(d: datetime) -> str:
    compact = d.strftime("%Y%m%d")
    return f"{NSE_BASE_URL}/content/cm/BhavCopy_NSE_CM_0_0_0_{compact}_F_0000.csv.zip"

def url_fii(d: datetime) -> str:
    display = d.strftime("%d-%b-%Y")
    return f"{NSE_BASE_URL}/content/fo/fii_stats_{display}.xls"

def url_part_oi(d: datetime) -> str:
    dmy = d.strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/nsccl/fao_participant_oi_{dmy}.csv"

def url_part_vol(d: datetime) -> str:
    dmy = d.strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/nsccl/fao_participant_vol_{dmy}.csv"

def url_fo_volt(d: datetime) -> str:
    dmy = d.strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/archives/nsccl/volt/FOVOLT_{dmy}.csv"

def url_mkt_act(d: datetime) -> str:
    ddmmyy = d.strftime("%d%m%y")
    return f"{NSE_BASE_URL}/archives/equities/mkt/MA{ddmmyy}.csv"

def url_fo_contracts(d: datetime) -> str:
    dmy = d.strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/fo/NSE_FO_contract_{dmy}.csv.gz"

def url_cm_security(d: datetime) -> str:
    dmy = d.strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/cm/NSE_CM_security_{dmy}.csv.gz"

# ── legacy URL builders (pre new-schema, from your downloader.py) ──────────

def url_fo_legacy(d: datetime) -> str:
    ddmonyyyy = d.strftime("%d%b%Y").upper()
    return f"{NSE_HIST_BASE_URL}/DERIVATIVES/{d.strftime('%Y')}/{d.strftime('%b').upper()}/fo{ddmonyyyy}bhav.csv.zip"

def url_cm_legacy(d: datetime) -> str:
    ddmonyyyy = d.strftime("%d%b%Y").upper()
    return f"{NSE_HIST_BASE_URL}/EQUITIES/{d.strftime('%Y')}/{d.strftime('%b').upper()}/cm{ddmonyyyy}bhav.csv.zip"


# ── sources to probe: (name, url_builder, start_date) ───────────────────────
JAN_2024 = datetime(2024, 1, 5)
FEB_2024 = datetime(2024, 2, 5)
JAN_2022 = datetime(2022, 1, 5)
OCT_2019 = datetime(2019, 10, 5)
JAN_2016 = datetime(2016, 1, 5)
DEC_2014= datetime(2014, 12, 5)
JAN_2012 = datetime(2012, 1, 5)
MAR_2012 = datetime(2012, 3, 5)
OCT_2001 = datetime(2001, 10, 27)

SOURCES: list[tuple[str, callable, datetime]] = [
    ("fo",            url_fo,            JAN_2024),
    ("eq_bhav",       url_eq_bhav,       OCT_2019),
    ("cm_bhav",       url_cm_bhav,       JAN_2024),
    ("fii",           url_fii,           DEC_2014),
    ("part_oi",       url_part_oi,       JAN_2012),
    ("part_vol",      url_part_vol,      JAN_2012),
    ("fo_volt",       url_fo_volt,       OCT_2001),
    ("mkt_act",       url_mkt_act,       MAR_2012),
    ("fo_contracts",  url_fo_contracts,  FEB_2024),
    ("cm_security",   url_cm_security,   FEB_2024),
    ("fo_legacy",     url_fo_legacy,     JAN_2016),
    ("cm_legacy",     url_cm_legacy,     JAN_2016),
]


# ── probing ──────────────────────────────────────────────────────────────────

def probe(url: str) -> int:
    """GET the url without downloading/reading the body. Return a status code,
    or -1 on network error/timeout."""
    try:
        with SESSION.get(url, timeout=REQUEST_TIMEOUT, stream=True) as r:
            code = r.status_code
        return code
    except requests.RequestException as e:
        print(f"  [error] {url}: {e}")
        return -1


def walk_source(name: str, url_builder, start_date: datetime, rows: list[dict]) -> None:
    print(f"\n=== {name}: walking backward from {start_date.date()} ===")
    d = start_date
    consecutive_misses = 0

    while True:
        url = url_builder(d)
        code = probe(url)
        exists = (code == 200)

        rows.append({
            "date": d.strftime("%Y-%m-%d"),
            "source": name,
            "url": url,
            "status_code": code,
            "exists": exists,
        })

        tag = "OK " if exists else "MISS"
        print(f"  {d.date()}  [{tag}]  ({code})  {url}")

        if exists:
            consecutive_misses = 0
        else:
            consecutive_misses += 1
            if consecutive_misses >= CONSECUTIVE_MISS_LIMIT:
                print(f"  -> {CONSECUTIVE_MISS_LIMIT} consecutive misses reached, "
                      f"declaring '{name}' dead before {d.date()}")
                break

        d -= timedelta(days=1)
        time.sleep(REQUEST_DELAY_SECONDS)


# ── plotting ─────────────────────────────────────────────────────────────────

def plot_timeline(rows: list[dict]) -> None:
    sources = sorted({r["source"] for r in rows})
    fig, ax = plt.subplots(figsize=(14, 0.6 * len(sources) + 2))

    for i, source in enumerate(sources):
        src_rows = [r for r in rows if r["source"] == source]
        exist_dates = [datetime.strptime(r["date"], "%Y-%m-%d") for r in src_rows if r["exists"]]
        miss_dates = [datetime.strptime(r["date"], "%Y-%m-%d") for r in src_rows if not r["exists"]]

        ax.scatter(exist_dates, [i] * len(exist_dates), color="tab:green", s=6, marker="s")
        ax.scatter(miss_dates, [i] * len(miss_dates), color="tab:red", s=6, marker="x", alpha=0.4)

    ax.set_yticks(range(len(sources)))
    ax.set_yticklabels(sources)
    ax.xaxis.set_major_locator(mdates.YearLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    ax.set_xlabel("Date")
    ax.set_title("NSE endpoint availability timeline (green=exists, red=404/miss)")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(PLOT_PATH, dpi=150)
    print(f"\nSaved plot -> {PLOT_PATH.resolve()}")


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    rows: list[dict] = []

    for name, builder, start_date in SOURCES:
        walk_source(name, builder, start_date, rows)

    with MANIFEST_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["date", "source", "url", "status_code", "exists"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nSaved manifest -> {MANIFEST_PATH.resolve()} ({len(rows)} rows)")

    plot_timeline(rows)

    print("\n=== Summary: earliest available date per source ===")
    sources = sorted({r["source"] for r in rows})
    for s in sources:
        exist_rows = [r for r in rows if r["source"] == s and r["exists"]]
        if exist_rows:
            earliest = min(r["date"] for r in exist_rows)
            latest = max(r["date"] for r in exist_rows)
            print(f"  {s:14s}  earliest={earliest}  latest={latest}  count={len(exist_rows)}")
        else:
            print(f"  {s:14s}  no successful pings")


if __name__ == "__main__":
    main()
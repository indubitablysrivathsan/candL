"""
pipeline/trading_dates.py

Date-range and trading-calendar helpers over the manifest DataFrame.

All original function signatures/behavior are preserved exactly — every
existing call site (startup_sync.py, parallel_startup_sync.py, etc.) keeps
working unchanged. Internals are rewritten to avoid repeated O(n) filters
over the full manifest on every call, since these get called once per
candidate per round and the manifest can hold years of daily rows.
"""

from datetime import datetime, timedelta
import bisect
import pandas as pd


def generate_date_range(start_date: str, end_date: str) -> list[str]:
    """Inclusive YYYY-MM-DD date range."""
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    days = (end - start).days
    if days < 0:
        return []
    return [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days + 1)]


def get_missing_dates(manifest_df: pd.DataFrame, start_date: str, end_date: str) -> list[str]:
    """Same contract as before: dates in [start_date, end_date] that are
    either absent from the manifest, or present with status in
    {'failed', 'partial'}."""
    expected = generate_date_range(start_date, end_date)

    if manifest_df.empty:
        return expected

    existing = set(manifest_df["trade_date"].values)
    status_map = dict(zip(manifest_df["trade_date"], manifest_df["status"]))

    return [
        d for d in expected
        if d not in existing or status_map.get(d) in ("failed", "partial")
    ]


# ── sorted-index builders — call once per round, reuse across all lookups ──

def build_trading_date_index(manifest_df: pd.DataFrame) -> list[str]:
    """Sorted trade_dates with status != 'market_closed' — backs
    get_previous_trading_date in O(log n)."""
    if manifest_df.empty:
        return []
    valid = manifest_df.loc[manifest_df["status"] != "market_closed", "trade_date"]
    return sorted(valid.tolist())


def build_confirmed_date_index(manifest_df: pd.DataFrame) -> list[str]:
    """Sorted trade_dates where fo_dl==1 or eq_bhav_dl==1 — backs
    get_next_confirmed_trading_date in O(log n)."""
    if manifest_df.empty:
        return []
    confirmed = manifest_df.loc[
        (manifest_df["fo_dl"] == 1) | (manifest_df["eq_bhav_dl"] == 1),
        "trade_date",
    ]
    return sorted(confirmed.tolist())


def get_previous_trading_date_fast(sorted_valid_dates: list[str], trade_date: str) -> str | None:
    i = bisect.bisect_left(sorted_valid_dates, trade_date)
    return sorted_valid_dates[i - 1] if i > 0 else None


def get_next_confirmed_trading_date_fast(sorted_confirmed_dates: list[str], file_date: str) -> str | None:
    i = bisect.bisect_right(sorted_confirmed_dates, file_date)
    return sorted_confirmed_dates[i] if i < len(sorted_confirmed_dates) else None


# ── original entry points — same signature/behavior, now O(n log n) worst
# case per call (build index + bisect) instead of O(n) filter+sort/O(n)
# filter+min, and safe as drop-in replacements for every existing caller ──

def get_next_confirmed_trading_date(manifest_df: pd.DataFrame, file_date: str) -> str | None:
    """Earliest trade_date strictly after file_date with fo_dl==1 or
    eq_bhav_dl==1. None if no such date exists yet."""
    return get_next_confirmed_trading_date_fast(
        build_confirmed_date_index(manifest_df), file_date
    )


def get_previous_trading_date(manifest: pd.DataFrame, trade_date: str) -> str | None:
    """Latest trade_date strictly before trade_date with status !=
    'market_closed'."""
    return get_previous_trading_date_fast(
        build_trading_date_index(manifest), trade_date
    )
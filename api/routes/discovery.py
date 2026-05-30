"""
api/routes/discovery.py
========================
Cross-asset discovery and data-availability endpoints.

Endpoints:
  GET /discovery/tickers              — all tickers by asset type
  GET /discovery/dates                — latest available date per domain
  GET /discovery/ticker/{ticker}      — what's available for one ticker
  GET /discovery/coverage             — row counts per table per date range
  GET /admin/status/{trade_date}      — per-domain processing status
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from api.db import (
    list_tickers,
    list_expiries,
    get_eq_tickers,
    get_eq_available_dates,
    get_volatility_tickers,
    get_volatility_available_dates,
    get_participant_available_dates,
    get_fii_available_dates,
    get_fii_instruments,
    get_market_available_dates,
    get_market_index_names,
    get_futures_market_dates,
    is_processed,
    get_conn,
)

router = APIRouter(tags=["Discovery"])

_ASSET_TYPES = ["stock_options", "index_options", "stock_futures", "index_futures"]


# ── Global ticker listing ─────────────────────────────────────────────────────

@router.get("/discovery/tickers")
def all_tickers(asset_type: Optional[str] = Query(None, description="Filter by asset type")):
    """
    All tickers grouped by asset type.
    Pass ?asset_type=stock_options to filter to one type.
    """
    if asset_type:
        if asset_type not in _ASSET_TYPES:
            raise HTTPException(400, f"asset_type must be one of {_ASSET_TYPES}")
        return {asset_type: list_tickers(asset_type)}

    return {
        "stock_options":  list_tickers("stock_options"),
        "index_options":  list_tickers("index_options"),
        "stock_futures":  list_tickers("stock_futures"),
        "index_futures":  list_tickers("index_futures"),
        "equity":         get_eq_tickers(),
        "volatility":     get_volatility_tickers(),
    }


# ── Latest available dates per domain ────────────────────────────────────────

@router.get("/discovery/dates")
def all_latest_dates():
    """
    Returns the most recent available trade date for every data domain.
    Useful for a dashboard header that says 'data as of YYYY-MM-DD'.
    """
    def _latest(dates: list[str]) -> Optional[str]:
        return max(dates) if dates else None

    return {
        "equity":        _latest(get_eq_available_dates()),
        "stock_futures": _latest(get_futures_market_dates("stock_futures")),
        "index_futures": _latest(get_futures_market_dates("index_futures")),
        "participant":   _latest(get_participant_available_dates()),
        "fii":           _latest(get_fii_available_dates()),
        "volatility":    _latest(get_volatility_available_dates()),
        "market":        _latest(get_market_available_dates()),
    }


# ── Per-ticker availability ───────────────────────────────────────────────────

@router.get("/discovery/ticker/{ticker}")
def ticker_info(ticker: str):
    """
    For a given ticker, return what's available across all asset types.
    Useful for search: 'what can I look at for RELIANCE?'
    """
    ticker = ticker.upper()
    result = {"ticker": ticker, "available_in": {}}

    for asset_type in _ASSET_TYPES:
        try:
            expiries = list_expiries(asset_type, ticker)
            if expiries:
                result["available_in"][asset_type] = {
                    "expiry_count": len(expiries),
                    "earliest":     expiries[0],
                    "latest":       expiries[-1],
                }
        except Exception:
            pass

    # Check EQ
    eq_dates = get_eq_available_dates()
    conn = get_conn(read_only=True)
    try:
        row = conn.execute(
            """
            SELECT COUNT(*) FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.instrument_type = 'EQ' AND i.ticker = ?
            """,
            [ticker],
        ).fetchone()
        if row and row[0] > 0:
            result["available_in"]["equity"] = {"trade_days": row[0]}
    finally:
        conn.close()

    if not result["available_in"]:
        raise HTTPException(404, f"No data found for ticker {ticker!r}")

    return result


# ── Coverage summary ──────────────────────────────────────────────────────────

@router.get("/discovery/coverage")
def coverage_summary(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    Row counts per table over a date range.
    Quick sanity check that ingestion is complete.
    """
    conn = get_conn(read_only=True)
    try:
        def count(table: str, where: str, params: list) -> int:
            try:
                r = conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {where}", params
                ).fetchone()
                return r[0] if r else 0
            except Exception:
                return -1

        date_range = [start_date, end_date]

        return {
            "date_range": {"start": start_date, "end": end_date},
            "rows": {
                "market_data_daily":       count("market_data_daily",
                                                 "trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "futures_analytics_STF":   count("futures_analytics",
                                                 "instrument_type = 'STF' AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "futures_analytics_IDF":   count("futures_analytics",
                                                 "instrument_type = 'IDF' AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "options_analytics_STO":   count("options_analytics",
                                                 "instrument_type = 'STO' AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "options_analytics_IDO":   count("options_analytics",
                                                 "instrument_type = 'IDO' AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "participant_activity":    count("participant_activity",
                                                 "trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "fii_stats":               count("fii_stats",
                                                 "trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "fo_volatility":           count("fo_volatility",
                                                 "trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
                "market_activity_index":   count("market_activity_index",
                                                 "trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)",
                                                 date_range),
            },
        }
    finally:
        conn.close()


# ── Admin: processing status per date ────────────────────────────────────────

_STATUS_KEYS = {
    "stock_futures":  "STF",
    "index_futures":  "IDF",
    "stock_options":  "STO",
    "index_options":  "IDO",
    "equity":         "eq_bhav",
    "cm_bhav":        "cm_bhav",
    "fii":            "fii",
    "participant_oi": "part_oi",
    "participant_vol":"part_vol",
    "volatility":     "fo_volt",
    "market":         "mkt_act",
}

@router.get("/admin/status/{trade_date}")
def processing_status(trade_date: str):
    """
    Returns processed/missing status for every data domain on a given date.
    Maps directly to is_processed() in db.py.
    """
    status = {}
    for label, key in _STATUS_KEYS.items():
        try:
            status[label] = is_processed(trade_date, key)
        except Exception as e:
            status[label] = f"error: {e}"

    all_ok = all(v is True for v in status.values())
    return {
        "trade_date": trade_date,
        "all_complete": all_ok,
        "status": status,
    }
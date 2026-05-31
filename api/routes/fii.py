"""
api/routes/fii.py
=================
Routes for FII (Foreign Institutional Investor) derivatives statistics.

These come from the separate fii_stats_*.xls source files and are richer
than the participant_activity table — they include rupee amounts (crores)
and OI values, not just contract counts.

Endpoints:
  GET /fii/dates
  GET /fii/instruments
  GET /fii/stats
  GET /fii/index-flow
  GET /fii/summary          ← pivot table for a single day (mirrors the XLS layout)
"""

from fastapi import APIRouter, HTTPException, Query

from api.db import (
    get_fii_stats,
    get_fii_index_futures_flow,
    get_fii_available_dates,
    get_fii_instruments,
    get_fii_daily_summary,
)

router = APIRouter(prefix="/fii", tags=["FII"])


@router.get("/dates")
def dates():
    """All trade dates with FII stats data."""
    return get_fii_available_dates()


@router.get("/instruments")
def instruments():
    """All instrument names present in fii_stats."""
    return get_fii_instruments()


@router.get("/stats")
def stats(
    start_date:  str = Query(..., description="YYYY-MM-DD"),
    end_date:    str = Query(..., description="YYYY-MM-DD"),
    instruments: str = Query(None, description="Comma-separated instrument names"),
):
    """
    FII buy/sell/OI stats for a date range.
    Includes net_contracts and net_amount_cr derived columns.

    Instrument examples:
      INDEX FUTURES, NIFTY FUTURES, BANKNIFTY FUTURES,
      INDEX OPTIONS, STOCK FUTURES, STOCK OPTIONS
    """
    instr_list = [i.strip() for i in instruments.split(",")] if instruments else None
    df = get_fii_stats(start_date, end_date, instr_list)
    if df.empty:
        raise HTTPException(404, f"No FII stats between {start_date} and {end_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/index-flow")
def index_flow(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    """
    FII net index futures positions over time.
    Covers: INDEX FUTURES, NIFTY FUTURES, BANKNIFTY FUTURES.
    The key institutional-flow signal — historically leads Nifty returns.
    """
    df = get_fii_index_futures_flow(start_date, end_date)
    if df.empty:
        raise HTTPException(404, f"No FII index flow data between {start_date} and {end_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/summary")
def summary(
    trade_date: str = Query(..., description="YYYY-MM-DD — single-day snapshot"),
):
    """
    Single-day pivot matching the NSE FII Statistics XLS layout:
    rows = instruments, columns = buy_contracts, buy_amount_cr,
    sell_contracts, sell_amount_cr, oi_contracts, oi_amount_cr,
    net_contracts, net_amount_cr.
    """
    df = get_fii_daily_summary(trade_date)
    if df.empty:
        raise HTTPException(404, f"No FII summary for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")
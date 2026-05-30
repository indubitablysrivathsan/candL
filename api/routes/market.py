"""
api/routes/market.py
====================
Routes for:
  - Market activity (summary + index OHLC)
  - FII statistics
  - FO Volatility
  - Research signal: FII vs Nifty

Endpoints:
  GET /market/dates
  GET /market/index-names
  GET /market/summary
  GET /market/index-history
  GET /market/index-snapshot

  GET /fii/dates
  GET /fii/instruments
  GET /fii/stats
  GET /fii/index-flow

  GET /volatility/tickers
  GET /volatility/dates
  GET /volatility/{ticker}
  GET /volatility/snapshot

  GET /research/fii-vs-nifty
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List

from api.db import (
    # market
    get_market_summary,
    get_market_index_history,
    get_market_index_snapshot,
    get_market_available_dates,
    get_market_index_names,
    # fii
    get_fii_stats,
    get_fii_index_futures_flow,
    get_fii_available_dates,
    get_fii_instruments,
    # volatility
    get_volatility,
    get_volatility_snapshot,
    get_volatility_tickers,
    get_volatility_available_dates,
    # research
    get_fii_vs_nifty,
)

router = APIRouter(tags=["Market"])


# ── Market Activity ───────────────────────────────────────────────────────────

@router.get("/market/dates")
def market_dates():
    return get_market_available_dates()


@router.get("/market/index-names")
def index_names():
    return get_market_index_names()


@router.get("/market/summary")
def market_summary(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    Market-wide daily totals: traded value, qty, trades, market cap.
    """
    df = get_market_summary(start_date, end_date)
    if df.empty:
        raise HTTPException(404, "No market summary data in range")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/market/index-history")
def index_history(
    index_name: str = Query(..., description="e.g. 'Nifty 50'"),
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """OHLC history for a specific index."""
    df = get_market_index_history(index_name, start_date, end_date)
    if df.empty:
        raise HTTPException(404, f"No data for {index_name}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/market/index-snapshot")
def index_snapshot(
    trade_date: str = Query(..., description="YYYY-MM-DD"),
):
    """All index values + pct_change for a given date."""
    df = get_market_index_snapshot(trade_date)
    if df.empty:
        raise HTTPException(404, f"No index data for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


# ── FII Statistics ────────────────────────────────────────────────────────────

@router.get("/fii/dates")
def fii_dates():
    return get_fii_available_dates()


@router.get("/fii/instruments")
def fii_instruments():
    return get_fii_instruments()


@router.get("/fii/stats")
def fii_stats(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    instruments: Optional[str] = Query(
        None,
        description="Comma-separated instrument names, e.g. 'INDEX FUTURES,NIFTY FUTURES'"
    ),
):
    """
    FII derivatives stats: buy/sell/OI contracts + amounts.
    """
    instr_list = [i.strip() for i in instruments.split(",")] if instruments else None
    df = get_fii_stats(start_date, end_date, instr_list)
    if df.empty:
        raise HTTPException(404, "No FII stats in range")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/fii/index-flow")
def fii_index_flow(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    FII net index futures flow (INDEX FUTURES + NIFTY + BANKNIFTY).
    Key institutional signal for directional bias research.
    """
    df = get_fii_index_futures_flow(start_date, end_date)
    if df.empty:
        raise HTTPException(404, "No FII index flow data")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


# ── Volatility ────────────────────────────────────────────────────────────────

@router.get("/volatility/tickers")
def vol_tickers():
    return get_volatility_tickers()


@router.get("/volatility/dates")
def vol_dates():
    return get_volatility_available_dates()


@router.get("/volatility/snapshot")
def vol_snapshot(
    trade_date: str = Query(..., description="YYYY-MM-DD"),
    top_n: int = Query(50, ge=5, le=500),
):
    """
    Cross-sectional volatility ranking for all tickers on a given date.
    Sorted by applicable_annual_vol descending.
    """
    df = get_volatility_snapshot(trade_date, top_n)
    if df.empty:
        raise HTTPException(404, f"No volatility snapshot for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/volatility/{ticker}")
def vol_ticker(
    ticker: str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    Volatility time series for a ticker.
    Returns underlying vol, futures vol, and applicable vol (EWMA).
    """
    df = get_volatility(ticker.upper(), start_date, end_date)
    if df.empty:
        raise HTTPException(404, f"No volatility data for {ticker}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


# ── Research Signals ──────────────────────────────────────────────────────────

@router.get("/research/fii-vs-nifty")
def fii_vs_nifty(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    FII net index futures OI joined with Nifty 50 daily returns.
    Includes lag-1 FII OI and lead-1 Nifty return for correlation research.

    This is the foundational dataset for:
      - Does FII net futures OI predict next-day Nifty returns?
    """
    df = get_fii_vs_nifty(start_date, end_date)
    if df.empty:
        raise HTTPException(404, "Insufficient data for signal")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    # Drop trailing row where nifty_return_next is null
    df = df.dropna(subset=["nifty_return_next"])
    return df.to_dict(orient="records")
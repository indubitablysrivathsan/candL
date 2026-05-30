"""
api/routes/stocks_indexes.py
============================
Routes for equity (EQ) instruments.

Endpoints:
  GET /stocks/tickers
  GET /stocks/dates
  GET /stocks/{ticker}/ohlc
  GET /stocks/{ticker}/rolling
  GET /stocks/snapshot
  GET /stocks/delivery-leaders
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
import pandas as pd

from api.db import (
    get_eq_tickers,
    get_eq_ohlc,
    get_eq_snapshot,
    get_eq_delivery_leaders,
    get_eq_available_dates,
    get_eq_rolling_stats,
)

router = APIRouter(prefix="/stocks", tags=["Stocks"])


@router.get("/tickers")
def tickers():
    """List all active EQ tickers."""
    return get_eq_tickers()


@router.get("/dates")
def dates():
    """All trade dates with EQ data."""
    return get_eq_available_dates()

@router.get("/snapshot")
def snapshot(
    trade_date: str = Query(..., description="YYYY-MM-DD"),
    limit: int = Query(200, ge=1, le=500),
):
    """
    Cross-sectional snapshot of all EQ stocks for a given date.
    Sorted by absolute daily move. Useful for heatmap / screener.
    """
    df = get_eq_snapshot(trade_date, limit)
    if df.empty:
        raise HTTPException(404, f"No snapshot for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")

@router.get("/delivery-leaders")
def delivery_leaders(
    trade_date: str = Query(..., description="YYYY-MM-DD"),
    top_n: int = Query(50, ge=5, le=200),
):
    """
    Top stocks by delivery percentage.
    High delivery % often signals institutional / conviction positioning.
    """
    df = get_eq_delivery_leaders(trade_date, top_n)
    if df.empty:
        raise HTTPException(404, f"No delivery data for {trade_date}")
    return df.to_dict(orient="records")


@router.get("/{ticker}/ohlc")
def ohlc(
    ticker: str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    OHLCV + delivery data for a single ticker.
    Returns list of daily rows.
    """
    df = get_eq_ohlc(ticker.upper(), start_date, end_date)
    if df.empty:
        raise HTTPException(404, f"No data for {ticker} in range {start_date}–{end_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/{ticker}/rolling")
def rolling(
    ticker: str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    OHLCV + computed rolling metrics (returns, delivery MAs, relative volume).
    Useful for signal research.
    """
    df = get_eq_rolling_stats(ticker.upper(), start_date, end_date)
    if df.empty:
        raise HTTPException(404, f"No data for {ticker}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")
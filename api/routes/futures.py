"""
NSE Platform — Futures API routes
===================================
GET /api/v1/futures/tickers
GET /api/v1/futures/expiries/{ticker}
GET /api/v1/futures/dates/{ticker}/{expiry}
GET /api/v1/futures/analytics/{ticker}/{expiry}
GET /api/v1/futures/rollup/{trade_date}
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from api.db import (
    list_tickers,
    list_expiries,
    get_available_dates,
    get_futures_analytics,
    get_futures_rollup,
    get_futures_market_dates
)

router = APIRouter(prefix="/futures", tags=["futures"])


@router.get("/tickers")
def futures_tickers():
    tickers = list_tickers("futures")
    return {"asset_type": "futures", "tickers": tickers}


@router.get("/expiries/{ticker}")
def futures_expiries(ticker: str):
    expiries = list_expiries("futures", ticker)
    if not expiries:
        raise HTTPException(404, f"No futures data for ticker: {ticker}")
    return {"asset_type": "futures", "ticker": ticker, "expiries": expiries}


@router.get("/dates/{ticker}/{expiry}")
def futures_dates(ticker: str, expiry: str):
    dates = get_available_dates("futures", ticker, expiry)
    return {
        "asset_type": "futures",
        "ticker":     ticker,
        "expiry":     expiry,
        "dates":      dates,
    }


@router.get("/analytics/{ticker}/{expiry}")
def futures_analytics(ticker: str, expiry: str):
    df = get_futures_analytics(ticker, expiry)
    if df.empty:
        raise HTTPException(404, f"No analytics for {ticker} / {expiry}")

    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")

    rows = df.where(df.notna(), other=None).to_dict(orient="records")

    return {
        "ticker": ticker,
        "expiry": expiry,
        "rows": rows,
    }


@router.get("/rollup/{trade_date}")
def futures_rollup(trade_date: str):
    df = get_futures_rollup(trade_date)
    if df.empty:
        raise HTTPException(404, f"No futures data for date: {trade_date}")

    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")

    # NaN → None so JSON serialises cleanly
    rows = df.where(df.notna(), other=None).to_dict(orient="records")

    return {
        "trade_date": trade_date,
        "rows":       rows,
    }

@router.get("/market-dates")
def futures_market_dates():
    return {
        "dates": get_futures_market_dates()
    }
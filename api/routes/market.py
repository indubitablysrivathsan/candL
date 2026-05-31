"""
api/routes/market.py
====================
Routes for:
  - Market activity (summary + index OHLC + breadth + top stocks + securities)
  - FII statistics
  - FO Volatility
  - Research signal: FII vs Nifty

Endpoints:

  Market summary / index
  ──────────────────────
  GET /market/dates
  GET /market/index-names
  GET /market/summary
  GET /market/index-history
  GET /market/index-snapshot

  Breadth
  ───────
  GET /market/breadth
  GET /market/breadth/snapshot

  Top stocks
  ──────────
  GET /market/top-stocks
  GET /market/top-stocks/gainers-losers

  Securities
  ──────────
  GET /market/security/{symbol}
  GET /market/security/snapshot

  FII
  ───
  GET /fii/dates
  GET /fii/instruments
  GET /fii/stats
  GET /fii/index-flow

  Volatility
  ──────────
  GET /volatility/tickers
  GET /volatility/dates
  GET /volatility/{ticker}
  GET /volatility/snapshot

  Research
  ────────
  GET /research/fii-vs-nifty
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional

from api.db import (
    # market index
    get_market_summary,
    get_market_index_history,
    get_market_index_snapshot,
    get_market_available_dates,
    get_market_index_names,
    # breadth
    get_market_breadth,
    get_market_breadth_snapshot,
    # top stocks + securities (from market_data_daily + instruments)
    get_top_stocks,
    get_top_gainers_losers,
    get_security_daily,
    get_security_snapshot,
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


# ── Market summary ────────────────────────────────────────────────────────────

@router.get("/market/dates")
def market_dates():
    return get_market_available_dates()


@router.get("/market/index-names")
def index_names():
    return get_market_index_names()


@router.get("/market/summary")
def market_summary(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    df = get_market_summary(start_date, end_date)
    if df.empty:
        raise HTTPException(404, "No market summary data in range")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/market/index-history")
def index_history(
    index_name: str = Query(..., description="e.g. 'Nifty 50'"),
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    df = get_market_index_history(index_name, start_date, end_date)
    if df.empty:
        raise HTTPException(404, f"No data for {index_name}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/market/index-snapshot")
def index_snapshot(
    trade_date: str = Query(..., description="YYYY-MM-DD"),
):
    df = get_market_index_snapshot(trade_date)
    if df.empty:
        raise HTTPException(404, f"No index data for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


# ── Breadth ───────────────────────────────────────────────────────────────────

@router.get("/market/breadth")
def market_breadth(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    df = get_market_breadth(start_date, end_date)
    if df.empty:
        raise HTTPException(404, "No breadth data in range")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/market/breadth/snapshot")
def market_breadth_snapshot(
    trade_date: str = Query(..., description="YYYY-MM-DD"),
):
    result = get_market_breadth_snapshot(trade_date)
    if result is None:
        raise HTTPException(404, f"No breadth data for {trade_date}")
    return result


# ── Top stocks ────────────────────────────────────────────────────────────────

@router.get("/market/top-stocks")
def top_stocks(
    trade_date: str = Query(..., description="YYYY-MM-DD"),
    series:     str = Query("EQ", description="Series code, e.g. EQ"),
    limit:      int = Query(25, ge=1, le=100),
):
    """Top N stocks by turnover for a given date."""
    df = get_top_stocks(trade_date, series, limit)
    if df.empty:
        raise HTTPException(404, f"No top stocks data for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/market/top-stocks/gainers-losers")
def top_gainers_losers(
    trade_date:   str   = Query(..., description="YYYY-MM-DD"),
    series:       str   = Query("EQ", description="Series code, e.g. EQ"),
    limit:        int   = Query(10, ge=1, le=50),
    min_turnover: float = Query(100.0, description="Minimum turnover in lacs to filter illiquid stocks"),
):
    """Top gainers and losers by pct_change for a given date."""
    result = get_top_gainers_losers(trade_date, series, limit, min_turnover)
    gainers = result["gainers"]
    losers  = result["losers"]
    if gainers.empty and losers.empty:
        raise HTTPException(404, f"No gainers/losers data for {trade_date}")
    return {
        "gainers": gainers.assign(
            trade_date=gainers["trade_date"].dt.strftime("%Y-%m-%d")
        ).to_dict(orient="records"),
        "losers": losers.assign(
            trade_date=losers["trade_date"].dt.strftime("%Y-%m-%d")
        ).to_dict(orient="records"),
    }


# ── Securities ────────────────────────────────────────────────────────────────

@router.get("/market/security/snapshot")
def security_snapshot(
    trade_date:   str            = Query(..., description="YYYY-MM-DD"),
    series:       str            = Query("EQ", description="Series code, e.g. EQ"),
    min_turnover: Optional[float] = Query(None, description="Minimum turnover in lacs"),
):
    """All securities for a date sorted by turnover desc."""
    df = get_security_snapshot(trade_date, series, min_turnover)
    if df.empty:
        raise HTTPException(404, f"No security data for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/market/security/{symbol}")
def security_history(
    symbol:     str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
    series:     str = Query("EQ", description="Series code, e.g. EQ"),
):
    """OHLC + delivery time series for a single symbol."""
    df = get_security_daily(symbol, start_date, end_date, series)
    if df.empty:
        raise HTTPException(404, f"No security data for {symbol}")
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
    start_date:  str = Query(..., description="YYYY-MM-DD"),
    end_date:    str = Query(..., description="YYYY-MM-DD"),
    instruments: Optional[str] = Query(
        None,
        description="Comma-separated instrument names, e.g. 'INDEX FUTURES,NIFTY FUTURES'",
    ),
):
    instr_list = [i.strip() for i in instruments.split(",")] if instruments else None
    df = get_fii_stats(start_date, end_date, instr_list)
    if df.empty:
        raise HTTPException(404, "No FII stats in range")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/fii/index-flow")
def fii_index_flow(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
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
    top_n:      int = Query(50, ge=5, le=500),
):
    df = get_volatility_snapshot(trade_date, top_n)
    if df.empty:
        raise HTTPException(404, f"No volatility snapshot for {trade_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/volatility/{ticker}")
def vol_ticker(
    ticker:     str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    df = get_volatility(ticker.upper(), start_date, end_date)
    if df.empty:
        raise HTTPException(404, f"No volatility data for {ticker}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


# ── Research ──────────────────────────────────────────────────────────────────

@router.get("/research/fii-vs-nifty")
def fii_vs_nifty(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    df = get_fii_vs_nifty(start_date, end_date)
    if df.empty:
        raise HTTPException(404, "Insufficient data for signal")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    df = df.dropna(subset=["nifty_return_next"])
    return df.to_dict(orient="records")
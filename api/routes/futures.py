"""
NSE Platform — Futures routes
/api/v1/futures/...

Stub — ready to fill once the futures pipeline is built.
The structure mirrors options exactly so adding logic is minimal.
"""

from fastapi import APIRouter, HTTPException, Query
from api.db import list_tickers, list_expiries, get_available_dates, get_futures_data
from api.schemas import (
    TickerListResponse, ExpiriesResponse,
    AvailableDatesResponse, FuturesDataResponse, FuturesRow,
)

router = APIRouter(prefix="/futures", tags=["futures"])


@router.get("/tickers", response_model=TickerListResponse)
def futures_tickers():
    return TickerListResponse(asset_type="futures", tickers=list_tickers("futures"))


@router.get("/expiries/{ticker}", response_model=ExpiriesResponse)
def futures_expiries(ticker: str):
    exp = list_expiries("futures", ticker)
    if not exp:
        raise HTTPException(404, f"No expiries found for {ticker}")
    return ExpiriesResponse(asset_type="futures", ticker=ticker, expiries=exp)


@router.get("/dates/{ticker}/{expiry}", response_model=AvailableDatesResponse)
def futures_dates(ticker: str, expiry: str):
    return AvailableDatesResponse(
        asset_type="futures", ticker=ticker, expiry=expiry,
        dates=get_available_dates("futures", ticker, expiry),
    )


@router.get("/data/{ticker}/{expiry}", response_model=FuturesDataResponse)
def futures_data(
    ticker:     str,
    expiry:     str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    df = get_futures_data(ticker, expiry, start_date, end_date)
    if df.empty:
        raise HTTPException(404, "No futures data found.")
    df["trade_date"] = df["trade_date"].astype(str)
    df = df.replace([float("inf"), float("-inf")], None).where(df.notna(), None)
    return FuturesDataResponse(
        ticker=ticker, expiry=expiry,
        start_date=start_date, end_date=end_date,
        rows=[FuturesRow(**r) for r in df.to_dict(orient="records")],
    )

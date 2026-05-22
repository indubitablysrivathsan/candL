"""
NSE Platform — Futures + Index Futures API routes
===================================================
All endpoints are generated for both prefixes via _make_futures_router().

  /api/v1/futures/...        → STF contracts  (asset_type="stock_futures")
  /api/v1/index_futures/...  → IDF contracts  (asset_type="index_futures")

Endpoints
---------
  GET /tickers
  GET /expiries/{ticker}
  GET /dates/{ticker}/{expiry}
  GET /analytics/{ticker}/{expiry}
  GET /rollup/{trade_date}
  GET /market-dates
"""

from fastapi import APIRouter, HTTPException

from api.db import (
    list_tickers,
    list_expiries,
    get_available_dates,
    get_futures_analytics,
    get_futures_rollup,
    get_futures_market_dates,
)


def _make_futures_router(asset_type: str) -> APIRouter:
    """
    Returns a fully-wired APIRouter for a futures asset type.
    asset_type must be "futures" or "index_futures".
    """
    prefix = f"/{asset_type.replace('_', '_')}"   # /futures or /index_futures
    tag    = asset_type.replace("_", " ").title()  # "Futures" or "Index Futures"
    router = APIRouter(prefix=prefix, tags=[tag])

    @router.get("/tickers")
    def _tickers():
        return {
            "asset_type": asset_type,
            "tickers":    list_tickers(asset_type),
        }

    @router.get("/expiries/{ticker}")
    def _expiries(ticker: str):
        expiries = list_expiries(asset_type, ticker)
        if not expiries:
            raise HTTPException(404, f"No {asset_type} data for ticker: {ticker}")
        return {"asset_type": asset_type, "ticker": ticker, "expiries": expiries}

    @router.get("/dates/{ticker}/{expiry}")
    def _dates(ticker: str, expiry: str):
        return {
            "asset_type": asset_type,
            "ticker":     ticker,
            "expiry":     expiry,
            "dates":      get_available_dates(asset_type, ticker, expiry),
        }

    @router.get("/analytics/{ticker}/{expiry}")
    def _analytics(ticker: str, expiry: str):
        df = get_futures_analytics(asset_type, ticker, expiry)
        if df.empty:
            raise HTTPException(404, f"No analytics for {ticker} / {expiry}")

        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
        rows = df.where(df.notna(), other=None).to_dict(orient="records")
        return {"asset_type": asset_type, "ticker": ticker, "expiry": expiry, "rows": rows}

    @router.get("/rollup/{trade_date}")
    def _rollup(trade_date: str):
        df = get_futures_rollup(trade_date, asset_type)
        if df.empty:
            raise HTTPException(404, f"No {asset_type} rollup data for date: {trade_date}")

        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
        rows = df.where(df.notna(), other=None).to_dict(orient="records")
        return {"asset_type": asset_type, "trade_date": trade_date, "rows": rows}

    @router.get("/market-dates")
    def _market_dates():
        return {
            "asset_type": asset_type,
            "dates":      get_futures_market_dates(asset_type),
        }

    return router


# ── Exported routers ──────────────────────────────────────────────────────────

futures_router       = _make_futures_router("stock_futures")
index_futures_router = _make_futures_router("index_futures")
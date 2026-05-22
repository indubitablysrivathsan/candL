"""
NSE Platform — Options + Index Options API routes
===================================================
All endpoints are generated for both prefixes via _make_options_router().

  /api/v1/options/...        → STO contracts  (asset_type="stock_options")
  /api/v1/index_options/...  → IDO contracts  (asset_type="index_options")

Endpoints
---------
  GET /tickers
  GET /expiries/{ticker}
  GET /dates/{ticker}/{expiry}
  GET /data/{ticker}/{expiry}?start_date=&end_date=
  GET /analytics/{ticker}/{expiry}?start_date=&end_date=
  GET /snapshot/{ticker}/{expiry}/{trade_date}
  GET /daily-expiry-snapshot/{expiry}/{trade_date}
  GET /chart-scale/{ticker}/{expiry}?start_date=&end_date=&metric=
"""

import math
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from api.db import (
    list_tickers,
    list_expiries,
    get_available_dates,
    get_options_data,
    get_options_analytics,
    get_options_analytics_full,
    get_daily_expiry_snapshot,
    get_chart_scale,
)
from api.schemas import (
    TickerListResponse,
    ExpiriesResponse,
    AvailableDatesResponse,
    OptionsDataResponse,
    OptionsRow,
    AnalyticsResponse,
    AnalyticsRow,
    StrikeSnapshotResponse,
    StrikeBar,
    ChartScaleResponse,
)


def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _make_options_router(asset_type: str) -> APIRouter:
    """
    Returns a fully-wired APIRouter for an options asset type.
    asset_type must be "options" or "index_options".
    """
    prefix = f"/{asset_type}"
    tag    = asset_type.replace("_", " ").title()   # "Stock Options" or "Index Options"
    router = APIRouter(prefix=prefix, tags=[tag])

    # ── Discovery ─────────────────────────────────────────────────────────────

    @router.get("/tickers", response_model=TickerListResponse)
    def _tickers():
        return TickerListResponse(asset_type=asset_type, tickers=list_tickers(asset_type))

    @router.get("/expiries/{ticker}", response_model=ExpiriesResponse)
    def _expiries(ticker: str):
        exp = list_expiries(asset_type, ticker)
        if not exp:
            raise HTTPException(404, f"No expiries found for {ticker}")
        return ExpiriesResponse(asset_type=asset_type, ticker=ticker, expiries=exp)

    @router.get("/dates/{ticker}/{expiry}", response_model=AvailableDatesResponse)
    def _dates(ticker: str, expiry: str):
        return AvailableDatesResponse(
            asset_type=asset_type,
            ticker=ticker,
            expiry=expiry,
            dates=get_available_dates(asset_type, ticker, expiry),
        )

    # ── Raw data ──────────────────────────────────────────────────────────────

    @router.get("/data/{ticker}/{expiry}", response_model=OptionsDataResponse)
    def _data(
        ticker:     str,
        expiry:     str,
        start_date: str = Query(..., description="YYYY-MM-DD"),
        end_date:   str = Query(..., description="YYYY-MM-DD"),
    ):
        df = get_options_data(asset_type, ticker, expiry, start_date, end_date)
        if df.empty:
            raise HTTPException(404, "No data found for the given parameters.")

        df["trade_date"] = df["trade_date"].astype(str)
        df = df.replace([float("inf"), float("-inf")], None).where(df.notna(), None)

        return OptionsDataResponse(
            ticker=ticker, expiry=expiry,
            start_date=start_date, end_date=end_date,
            rows=[OptionsRow(**r) for r in df.to_dict(orient="records")],
        )

    # ── Analytics ─────────────────────────────────────────────────────────────

    @router.get("/analytics/{ticker}/{expiry}", response_model=AnalyticsResponse)
    def _analytics(
        ticker:     str,
        expiry:     str,
        start_date: Optional[str] = Query(None, description="YYYY-MM-DD — omit for full series"),
        end_date:   Optional[str] = Query(None, description="YYYY-MM-DD — omit for full series"),
    ):
        df = (
            get_options_analytics(asset_type, ticker, expiry, start_date, end_date)
            if start_date and end_date
            else get_options_analytics_full(asset_type, ticker, expiry)
        )
        if df.empty:
            raise HTTPException(404, "No analytics found.")

        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
        df = df.replace([float("inf"), float("-inf")], None).where(df.notna(), None)

        return AnalyticsResponse(
            ticker=ticker,
            expiry=expiry,
            rows=[AnalyticsRow(**r) for r in df.to_dict(orient="records")],
        )

    # ── Daily expiry snapshot ─────────────────────────────────────────────────

    @router.get("/daily-expiry-snapshot/{expiry}/{trade_date}")
    def _daily_expiry_snapshot(expiry: str, trade_date: str):
        """Analytics snapshot across ALL tickers for one expiry + trade date."""
        df = get_daily_expiry_snapshot(asset_type, expiry, trade_date)
        if df.empty:
            raise HTTPException(
                404, f"No snapshot data found for {expiry} on {trade_date}"
            )

        if "trade_date" in df.columns:
            df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")

        df = df.replace([np.inf, -np.inf], None).astype(object).where(pd.notnull(df), None)

        return {
            "asset_type": asset_type,
            "expiry":     expiry,
            "trade_date": trade_date,
            "rows":       df.to_dict(orient="records"),
        }

    # ── Strike snapshot ───────────────────────────────────────────────────────

    @router.get("/snapshot/{ticker}/{expiry}/{trade_date}",
                response_model=StrikeSnapshotResponse)
    def _snapshot(ticker: str, expiry: str, trade_date: str):
        """All strikes for one day, pivoted into CE/PE columns."""
        df = get_options_data(asset_type, ticker, expiry, trade_date, trade_date)
        if df.empty:
            raise HTTPException(404, f"No data for {ticker}/{expiry} on {trade_date}")

        ana_df = get_options_analytics(asset_type, ticker, expiry, trade_date, trade_date)
        ana    = ana_df.iloc[0] if not ana_df.empty else None

        underlying = max_pain = pcr = None
        if ana is not None:
            underlying = _safe_float(ana.get("underlying"))
            max_pain   = _safe_float(ana.get("max_pain"))
            pcr        = _safe_float(ana.get("pcr"))
        if underlying is None:
            uv = df["UndrlygPric"].dropna()
            underlying = float(uv.iloc[0]) if not uv.empty else None

        ce = df[df["OptnTp"] == "CE"].groupby("StrkPric", as_index=True).last(numeric_only=False)
        pe = df[df["OptnTp"] == "PE"].groupby("StrkPric", as_index=True).last(numeric_only=False)

        bars = [
            StrikeBar(
                strike     = float(s),
                ce_oi      = _safe_float(ce.loc[s]["OpnIntrst"]       if s in ce.index else 0),
                pe_oi      = _safe_float(pe.loc[s]["OpnIntrst"]       if s in pe.index else 0),
                ce_oi_chng = _safe_float(ce.loc[s]["ChngInOpnIntrst"] if s in ce.index else 0),
                pe_oi_chng = _safe_float(pe.loc[s]["ChngInOpnIntrst"] if s in pe.index else 0),
                ce_vol     = _safe_float(ce.loc[s]["TtlTradgVol"]     if s in ce.index else 0),
                pe_vol     = _safe_float(pe.loc[s]["TtlTradgVol"]     if s in pe.index else 0),
            )
            for s in sorted(set(ce.index.tolist()) | set(pe.index.tolist()))
        ]

        return StrikeSnapshotResponse(
            ticker=ticker, expiry=expiry, trade_date=trade_date,
            underlying=underlying, max_pain=max_pain, pcr=pcr,
            strikes=bars,
        )

    # ── Chart axis scale ──────────────────────────────────────────────────────

    @router.get("/chart-scale/{ticker}/{expiry}", response_model=ChartScaleResponse)
    def _chart_scale(
        ticker:     str,
        expiry:     str,
        start_date: str = Query(..., description="YYYY-MM-DD"),
        end_date:   str = Query(..., description="YYYY-MM-DD"),
        metric:     str = Query("oi", description="oi | oi_chng | vol"),
    ):
        scale = get_chart_scale(asset_type, ticker, expiry, start_date, end_date, metric)
        return ChartScaleResponse(
            ticker=ticker, expiry=expiry, metric=metric,
            y_min=scale["y_min"], y_max=scale["y_max"],
            x_min=scale["x_min"], x_max=scale["x_max"],
            strike_gap=scale["strike_gap"],
        )

    return router


# ── Exported routers ──────────────────────────────────────────────────────────

options_router       = _make_options_router("stock_options")
index_options_router = _make_options_router("index_options")
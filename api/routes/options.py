"""
NSE Platform — Options + Index Options API routes
===================================================
  /api/v1/stock_options/...  → STO  (asset_type="stock_options")
  /api/v1/index_options/...  → IDO  (asset_type="index_options")
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
    get_daily_expiry_snapshot,
    get_chart_scale,
)
from api.schemas import (
    TickerListResponse,
    ExpiriesResponse,
    AvailableDatesResponse,
    OptionsDataResponse,
    OptionsRow,
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
    prefix = f"/{asset_type}"
    tag    = asset_type.replace("_", " ").title()
    router = APIRouter(prefix=prefix, tags=[tag])

    # ── Discovery ─────────────────────────────────────────────────────────────

    @router.get("/tickers", response_model=TickerListResponse)
    def _tickers():
        return TickerListResponse(asset_type=asset_type, tickers=list_tickers(asset_type))
    
    @router.get("/expiries", response_model=ExpiriesResponse)
    def _all_expiries():
        exp = list_expiries(asset_type)
        if not exp:
            raise HTTPException(404, "No expiries found")
        return ExpiriesResponse(asset_type=asset_type, ticker=None, expiries=exp)

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
        start_date: str = Query(...),
        end_date:   str = Query(...),
    ):
        df = get_options_data(asset_type, ticker, expiry, start_date, end_date)
        if df.empty:
            raise HTTPException(404, "No data found for the given parameters.")

        df["trade_date"] = df["trade_date"].astype(str)
        df = df.replace(
            [float("inf"), float("-inf")],
            None
        ).astype(object).where(df.notna(), None)

        return OptionsDataResponse(
            ticker=ticker, expiry=expiry,
            start_date=start_date, end_date=end_date,
            rows=[OptionsRow(**r) for r in df.to_dict(orient="records")],
        )

    # ── Analytics ─────────────────────────────────────────────────────────────

    @router.get("/analytics/{ticker}/{expiry}")
    def _analytics(
        ticker:     str,
        expiry:     str,
        start_date: Optional[str] = Query(None),
        end_date:   Optional[str] = Query(None),
    ):
        df = get_options_analytics(asset_type, ticker, expiry, start_date, end_date)
        if df.empty:
            raise HTTPException(404, "No analytics found.")

        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")

        df = df.replace(
            [float("inf"), float("-inf")],
            None
        ).astype(object).where(df.notna(), None)

        # Explicit frontend schema normalization
        df = df.rename(columns={
            "pe_oi": "pe",
            "ce_oi": "ce",
        })

        # model_validate(row) required because AnalyticsRow uses Field aliases
        # (pe_oi → pe, ce_oi → ce) — **unpacking bypasses alias resolution
        
        return {
            "ticker": ticker,
            "expiry": expiry,
            "rows": df.to_dict(orient="records"),
        }

    # ── Daily expiry snapshot ─────────────────────────────────────────────────

    @router.get("/daily-expiry-snapshot/{expiry}/{trade_date}")
    def _daily_expiry_snapshot(expiry: str, trade_date: str):
        df = get_daily_expiry_snapshot(asset_type, expiry, trade_date)
        if df.empty:
            raise HTTPException(404, f"No snapshot data for {expiry} on {trade_date}")

        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
        df = df.replace(
            [float("inf"), float("-inf")],
            None
        ).astype(object).where(df.notna(), None)

        # Rename DB columns to frontend-expected names before serialising
        df = df.rename(columns={"pe_oi": "pe", "ce_oi": "ce"})

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
                ce_oi      = _safe_float(ce.loc[s].get("OpnIntrst")) if s in ce.index else None,
                pe_oi      = _safe_float(pe.loc[s].get("OpnIntrst")) if s in pe.index else None,
                ce_oi_chng = _safe_float(ce.loc[s].get("ChngInOpnIntrst")) if s in ce.index else None,
                pe_oi_chng = _safe_float(pe.loc[s].get("ChngInOpnIntrst")) if s in pe.index else None,
                ce_vol     = float(ce.loc[s]["TtlTradgVol"] * ce.loc[s]["NewBrdLotQty"]) 
                             if (s in ce.index and pd.notna(ce.loc[s].get("TtlTradgVol")) and pd.notna(ce.loc[s].get("NewBrdLotQty"))) 
                             else 0.0,
                pe_vol     = float(pe.loc[s]["TtlTradgVol"] * pe.loc[s]["NewBrdLotQty"]) 
                             if (s in pe.index and pd.notna(pe.loc[s].get("TtlTradgVol")) and pd.notna(pe.loc[s].get("NewBrdLotQty"))) 
                             else 0.0,
            )
            for s in sorted(set(ce.index.tolist()) | set(pe.index.tolist()))
        ]

        return StrikeSnapshotResponse(
            ticker=ticker, expiry=expiry, trade_date=trade_date,
            underlying=underlying, max_pain=max_pain, pcr=pcr,
            strikes=bars,
        )
    
    # ── Options cycle history ─────────────────────────────────────────────────

    @router.get("/cycle-history/{ticker}")
    def _cycle_history(ticker: str):
        from api.db import get_options_cycle_history
        df = get_options_cycle_history(ticker, asset_type)
        if df.empty:
            raise HTTPException(404, f"No cycle history for {ticker}")

        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
        df["expiry"]     = df["expiry"].dt.strftime("%Y-%m-%d")
        df = df.replace([float("inf"), float("-inf")], None) \
            .astype(object).where(df.notna(), None)

        return {
            "asset_type": asset_type,
            "ticker":     ticker,
            "rows":       df.to_dict(orient="records"),
        }
    
    @router.get("/market-history")
    def _market_history():
        from api.db import get_options_market_history
        df = get_options_market_history(asset_type)
        if df.empty:
            raise HTTPException(404, "No market history found")

        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
        df["expiry"]     = df["expiry"].dt.strftime("%Y-%m-%d")
        df = df.replace([float("inf"), float("-inf")], None) \
            .astype(object).where(df.notna(), None)

        return {
            "asset_type": asset_type,
            "rows":       df.to_dict(orient="records"),
        }

    # ── Chart axis scale ──────────────────────────────────────────────────────

    @router.get("/chart-scale/{ticker}/{expiry}", response_model=ChartScaleResponse)
    def _chart_scale(
        ticker:     str,
        expiry:     str,
        start_date: str = Query(...),
        end_date:   str = Query(...),
        metric:     str = Query("oi"),
    ):
        scale = get_chart_scale(asset_type, ticker, expiry, start_date, end_date, metric)
        return ChartScaleResponse(
            ticker=ticker, expiry=expiry, metric=metric,
            y_min=scale["y_min"], y_max=scale["y_max"],
            x_min=scale["x_min"], x_max=scale["x_max"],
            strike_gap=scale["strike_gap"],
        )

    return router


options_router       = _make_options_router("stock_options")
index_options_router = _make_options_router("index_options")
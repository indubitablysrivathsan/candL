"""
NSE Platform — Options routes
/api/v1/options/...
"""

import math
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

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

router = APIRouter(prefix="/options", tags=["options"])


# ── Discovery ─────────────────────────────────────────────────────────────────

@router.get("/tickers", response_model=TickerListResponse)
def options_tickers():
    return TickerListResponse(asset_type="options", tickers=list_tickers("options"))


@router.get("/expiries/{ticker}", response_model=ExpiriesResponse)
def options_expiries(ticker: str):
    exp = list_expiries("options", ticker)
    if not exp:
        raise HTTPException(404, f"No expiries found for {ticker}")
    return ExpiriesResponse(asset_type="options", ticker=ticker, expiries=exp)


@router.get("/dates/{ticker}/{expiry}", response_model=AvailableDatesResponse)
def options_dates(ticker: str, expiry: str):
    dates = get_available_dates("options", ticker, expiry)
    return AvailableDatesResponse(
        asset_type="options", ticker=ticker, expiry=expiry, dates=dates
    )


# ── Raw data ──────────────────────────────────────────────────────────────────

@router.get("/data/{ticker}/{expiry}", response_model=OptionsDataResponse)
def options_data(
    ticker:     str,
    expiry:     str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
):
    df = get_options_data(ticker, expiry, start_date, end_date)
    if df.empty:
        raise HTTPException(404, "No data found for the given parameters.")

    df["trade_date"] = df["trade_date"].astype(str)
    df = df.replace([float("inf"), float("-inf")], None)
    df = df.where(df.notna(), None)

    rows = df.to_dict(orient="records")
    return OptionsDataResponse(
        ticker=ticker, expiry=expiry,
        start_date=start_date, end_date=end_date,
        rows=[OptionsRow(**r) for r in rows],
    )


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics/{ticker}/{expiry}", response_model=AnalyticsResponse)
def options_analytics(
    ticker:     str,
    expiry:     str,
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD — omit for full series"),
    end_date:   Optional[str] = Query(None, description="YYYY-MM-DD — omit for full series"),
):
    if start_date and end_date:
        df = get_options_analytics(ticker, expiry, start_date, end_date)
    else:
        df = get_options_analytics_full(ticker, expiry)

    if df.empty:
        raise HTTPException(404, "No analytics found.")

    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    df = df.replace([float("inf"), float("-inf")], None)
    df = df.where(df.notna(), None)

    rows = [AnalyticsRow(**r) for r in df.to_dict(orient="records")]
    return AnalyticsResponse(ticker=ticker, expiry=expiry, rows=rows)

# ── Daily expiry snapshot ────────────────────────────────────────────────────

@router.get("/daily-expiry-snapshot/{expiry}/{trade_date}")
def daily_expiry_snapshot(
    expiry: str,
    trade_date: str,
):
    """
    Returns analytics snapshot rows across ALL tickers
    for ONE expiry and ONE trade date.
    """

    df = get_daily_expiry_snapshot(
        expiry,
        trade_date,
    )

    if df.empty:
        raise HTTPException(
            404,
            f"No snapshot data found for {expiry} on {trade_date}"
        )

    if "trade_date" in df.columns:
        df["trade_date"] = (
            df["trade_date"]
            .dt.strftime("%Y-%m-%d")
        )

    df = df.replace(
        [float("inf"), float("-inf")],
        None
    )

    df = df.where(df.notna(), None)

    return {
        "expiry": expiry,
        "trade_date": trade_date,
        "rows": df.to_dict(orient="records"),
    }

# ── Strike snapshot (single day — the main chart endpoint) ───────────────────

@router.get("/snapshot/{ticker}/{expiry}/{trade_date}",
            response_model=StrikeSnapshotResponse)
def options_snapshot(ticker: str, expiry: str, trade_date: str):
    """
    Returns all strikes for one day, already pivoted into CE/PE columns.
    This is the primary endpoint the chart page will call.
    """
    df = get_options_data(ticker, expiry, trade_date, trade_date)
    if df.empty:
        raise HTTPException(404, f"No data for {ticker}/{expiry} on {trade_date}")

    ana_df = get_options_analytics(ticker, expiry, trade_date, trade_date)
    ana = ana_df.iloc[0] if not ana_df.empty else None

    underlying = None
    max_pain   = None
    pcr        = None
    if ana is not None:
        underlying = _safe_float(ana.get("underlying"))
        max_pain   = _safe_float(ana.get("max_pain"))
        pcr        = _safe_float(ana.get("pcr"))
    if underlying is None:
        uv = df["UndrlygPric"].dropna()
        underlying = float(uv.iloc[0]) if not uv.empty else None

    ce = (
        df[df["OptnTp"] == "CE"]
        .groupby("StrkPric", as_index=True)
        .last(numeric_only=False)
    )
    pe = (
        df[df["OptnTp"] == "PE"]
        .groupby("StrkPric", as_index=True)
        .last(numeric_only=False)
    )

    all_strikes = sorted(
        set(ce.index.tolist()) | set(pe.index.tolist())
    )

    bars = []
    for s in all_strikes:
        ce_row = ce.loc[s] if s in ce.index else None
        pe_row = pe.loc[s] if s in pe.index else None

        bars.append(
            StrikeBar(
                strike=float(s),
                ce_oi=_safe_float(
                    ce_row["OpnIntrst"] if ce_row is not None else 0
                ),
                pe_oi=_safe_float(
                    pe_row["OpnIntrst"] if pe_row is not None else 0
                ),
                ce_oi_chng=_safe_float(
                    ce_row["ChngInOpnIntrst"] if ce_row is not None else 0
                ),
                pe_oi_chng=_safe_float(
                    pe_row["ChngInOpnIntrst"] if pe_row is not None else 0
                ),
                ce_vol=_safe_float(
                    ce_row["TtlTradgVol"] if ce_row is not None else 0
                ),
                pe_vol=_safe_float(
                    pe_row["TtlTradgVol"] if pe_row is not None else 0
                ),
            )
        )

    return StrikeSnapshotResponse(
        ticker=ticker, expiry=expiry, trade_date=trade_date,
        underlying=underlying, max_pain=max_pain, pcr=pcr,
        strikes=bars,
    )


# ── Chart axis scale ──────────────────────────────────────────────────────────

@router.get("/chart-scale/{ticker}/{expiry}", response_model=ChartScaleResponse)
def options_chart_scale(
    ticker:     str,
    expiry:     str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
    metric:     str = Query("oi", description="oi | oi_chng | vol"),
):
    """
    Returns stable y and x axis bounds for a metric across the full date range.
    Excludes zero-value rows so ghost strikes never pollute the x axis.
    Used by the frontend to lock both axes for cross-date comparison.
    """
    scale = get_chart_scale(ticker, expiry, start_date, end_date, metric)
    return ChartScaleResponse(
        ticker=ticker,
        expiry=expiry,
        metric=metric,
        y_min=scale["y_min"],
        y_max=scale["y_max"],
        x_min=scale["x_min"],
        x_max=scale["x_max"],
        strike_gap=scale["strike_gap"],
    )


# ── Util ──────────────────────────────────────────────────────────────────────

def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None
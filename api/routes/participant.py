"""
api/routes/participant.py
=========================
Routes for participant-level activity data.

Endpoints:
  GET /participant/dates
  GET /participant/net-oi
  GET /participant/net-vol
  GET /participant/latest
  GET /participant/summary          ← new: daily summary pivot (all participants × all sides)
"""

from fastapi import APIRouter, Query, HTTPException

from api.db import (
    get_participant_net_oi,
    get_participant_net_vol,
    get_participant_latest,
    get_participant_available_dates,
    get_participant_daily_summary,
)

router = APIRouter(prefix="/participant", tags=["Participant"])

# ── helpers ──────────────────────────────────────────────────────────────────

VALID_ASSET_CLASSES = {"INDEX", "STOCK"}


def _normalize_asset_class(raw: str) -> str:
    """
    Accept INDEX / STOCK (canonical) and legacy aliases:
      EQUITY → STOCK
    Raises 400 for anything else.
    """
    mapped = {"INDEX": "INDEX", "STOCK": "STOCK", "EQUITY": "STOCK"}
    v = raw.strip().upper()
    if v not in mapped:
        raise HTTPException(
            400,
            f"asset_class must be one of: INDEX, STOCK  (got '{raw}')"
        )
    return mapped[v]


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("/dates")
def dates():
    """All trade dates with participant activity data."""
    return get_participant_available_dates()


@router.get("/net-oi")
def net_oi(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
    asset_class: str = Query("INDEX", description="INDEX or STOCK"),
):
    """
    Net OI (long minus short) per participant type per day.
    Broken down by option_side: NA = futures, CE, PE.
    """
    ac = _normalize_asset_class(asset_class)
    df = get_participant_net_oi(start_date, end_date, ac)
    if df.empty:
        raise HTTPException(404, f"No OI data for {ac} between {start_date} and {end_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/net-vol")
def net_vol(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date:   str = Query(..., description="YYYY-MM-DD"),
    asset_class: str = Query("INDEX", description="INDEX or STOCK"),
):
    """
    Net trading volume (buy minus sell) per participant per day.
    Broken down by option_side: NA = futures, CE, PE.
    """
    ac = _normalize_asset_class(asset_class)
    df = get_participant_net_vol(start_date, end_date, ac)
    if df.empty:
        raise HTTPException(404, f"No volume data for {ac} between {start_date} and {end_date}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/latest")
def latest(
    asset_class: str = Query("INDEX", description="INDEX or STOCK"),
):
    """
    Most recent day's full OI breakdown for all participants.
    Returns one row per participant × option_side × direction.
    """
    ac = _normalize_asset_class(asset_class)
    df = get_participant_latest(ac)
    if df.empty:
        raise HTTPException(404, f"No participant data found for asset_class={ac}")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/summary")
def summary(
    trade_date:  str = Query(..., description="YYYY-MM-DD — single day pivot table"),
    asset_class: str = Query("INDEX", description="INDEX or STOCK"),
):
    """
    Full pivot table for a single day — one row per participant,
    columns for futures long/short/net and CE/PE long/short/net.
    Mirrors the NSE fao_participant_oi_*.csv layout.
    """
    ac = _normalize_asset_class(asset_class)
    df = get_participant_daily_summary(trade_date, ac)
    if df.empty:
        raise HTTPException(404, f"No data for {trade_date} / {ac}")
    if "trade_date" in df.columns:
        df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")
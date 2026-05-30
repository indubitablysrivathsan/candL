"""
api/routes/participant.py
=========================
Routes for participant-level activity data.

Endpoints:
  GET /participant/dates
  GET /participant/net-oi
  GET /participant/net-vol
  GET /participant/latest
"""

from fastapi import APIRouter, Query
from fastapi import HTTPException

from api.db import (
    get_participant_net_oi,
    get_participant_net_vol,
    get_participant_latest,
    get_participant_available_dates,
)

router = APIRouter(prefix="/participant", tags=["Participant"])


@router.get("/dates")
def dates():
    """All trade dates with participant activity data."""
    return get_participant_available_dates()


@router.get("/net-oi")
def net_oi(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    asset_class: str = Query("INDEX", description="INDEX or STOCK"),
):
    """
    Net OI (long minus short) per participant type per day.
    Broken down by option_side (NA=futures, CE, PE).

    Participants: FII, DII, Client, Pro
    """
    asset_class = asset_class.upper()
    if asset_class not in ("INDEX", "STOCK"):
        raise HTTPException(400, "asset_class must be INDEX or STOCK")

    df = get_participant_net_oi(start_date, end_date, asset_class)
    if df.empty:
        raise HTTPException(404, f"No OI data for {asset_class} in range")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/net-vol")
def net_vol(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    asset_class: str = Query("INDEX", description="INDEX or STOCK"),
):
    """
    Net trading volume (buy minus sell) per participant per day.
    """
    asset_class = asset_class.upper()
    if asset_class not in ("INDEX", "STOCK"):
        raise HTTPException(400, "asset_class must be INDEX or STOCK")

    df = get_participant_net_vol(start_date, end_date, asset_class)
    if df.empty:
        raise HTTPException(404, f"No volume data")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


@router.get("/latest")
def latest(
    asset_class: str = Query("INDEX", description="INDEX or STOCK"),
):
    """
    Most recent day's full OI breakdown for all participants.
    """
    asset_class = asset_class.upper()
    df = get_participant_latest(asset_class)
    if df.empty:
        raise HTTPException(404, "No latest participant data")
    df["trade_date"] = df["trade_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")
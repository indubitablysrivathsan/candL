"""
NSE Platform — Pydantic response schemas
=========================================
Every API response is typed here.
The frontend can rely on these shapes exactly.
"""

from pydantic import BaseModel, Field
from typing import Optional


# ── Common ────────────────────────────────────────────────────────────────────

class TickerListResponse(BaseModel):
    asset_type: str
    tickers: list[str]


class ExpiriesResponse(BaseModel):
    asset_type: str
    ticker: str
    expiries: list[str]


class AvailableDatesResponse(BaseModel):
    asset_type: str
    ticker: str
    expiry: Optional[str]
    dates: list[str]


# ── Options raw data ──────────────────────────────────────────────────────────

class OptionsRow(BaseModel):
    """
    DB columns are aliased back to original NSE names in the SELECT inside
    db.get_options_data() so these field names stay stable for the frontend.
    """
    trade_date:      str
    TckrSymb:        str
    XpryDt:          str
    StrkPric:        Optional[float]
    OptnTp:          Optional[str]
    OpnIntrst:       Optional[float]
    ChngInOpnIntrst: Optional[float]
    TtlTradgVol:     Optional[float]
    UndrlygPric:     Optional[float]
    OpnPric:         Optional[float]
    HghPric:         Optional[float]
    LwPric:          Optional[float]
    ClsPric:         Optional[float]
    LastPric:        Optional[float]

    model_config = {"extra": "ignore"}


class OptionsDataResponse(BaseModel):
    ticker:     str
    expiry:     str
    start_date: str
    end_date:   str
    rows:       list[OptionsRow]


# ── Options analytics ─────────────────────────────────────────────────────────

class AnalyticsRow(BaseModel):
    """
    DB stores pe_oi / ce_oi. Frontend expects pe / ce.
    Aliases handle the rename transparently; populate_by_name lets
    internal code still pass pe_oi= kwargs if needed.
    """
    trade_date: str
    pe:         Optional[float] = Field(None, alias="pe_oi")
    ce:         Optional[float] = Field(None, alias="ce_oi")
    pcr:        Optional[float]
    underlying: Optional[float]
    max_pain:   Optional[float]

    model_config = {"populate_by_name": True, "extra": "ignore"}


class AnalyticsResponse(BaseModel):
    ticker: str
    expiry: str
    rows:   list[AnalyticsRow]


# ── Strike snapshot ───────────────────────────────────────────────────────────

class StrikeBar(BaseModel):
    strike:     float
    ce_oi:      float
    pe_oi:      float
    ce_oi_chng: float
    pe_oi_chng: float
    ce_vol:     float
    pe_vol:     float


class StrikeSnapshotResponse(BaseModel):
    ticker:     str
    expiry:     str
    trade_date: str
    underlying: Optional[float]
    max_pain:   Optional[float]
    pcr:        Optional[float]
    strikes:    list[StrikeBar]


# ── Chart axis scale ──────────────────────────────────────────────────────────

class ChartScaleResponse(BaseModel):
    ticker:     str
    expiry:     str
    metric:     str
    y_min:      float
    y_max:      float
    x_min:      float
    x_max:      float
    strike_gap: float


# ── Futures ───────────────────────────────────────────────────────────────────

class FuturesRow(BaseModel):
    trade_date:      str
    TckrSymb:        str
    XpryDt:          str
    OpnPric:         Optional[float]
    HghPric:         Optional[float]
    LwPric:          Optional[float]
    ClsPric:         Optional[float]
    TtlTradgVol:     Optional[float]
    OpnIntrst:       Optional[float]
    ChngInOpnIntrst: Optional[float]

    model_config = {"extra": "ignore"}


class FuturesDataResponse(BaseModel):
    ticker:     str
    expiry:     str
    start_date: str
    end_date:   str
    rows:       list[FuturesRow]
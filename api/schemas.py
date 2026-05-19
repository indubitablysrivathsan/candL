"""
NSE Platform — Pydantic response schemas
=========================================
Every API response is typed here.
The frontend can rely on these shapes exactly.
"""

from pydantic import BaseModel
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
    dates: list[str]   # "YYYY-MM-DD" strings, sorted ascending


# ── Options ───────────────────────────────────────────────────────────────────

class OptionsRow(BaseModel):
    trade_date: str          # "YYYY-MM-DD"
    TckrSymb:   str
    XpryDt:     str
    StrkPric:   float
    OptnTp:     str          # "CE" | "PE"
    OpnIntrst:  float
    ChngInOpnIntrst: float
    TtlTradgVol: float
    UndrlygPric: Optional[float]
    OpnPric:    Optional[float]
    HghPric:    Optional[float]
    LwPric:     Optional[float]
    ClsPric:    Optional[float]
    LastPric:   Optional[float]

    class Config:
        # allow extra columns from the CSV without crashing
        extra = "ignore"


class OptionsDataResponse(BaseModel):
    ticker:     str
    expiry:     str
    start_date: str
    end_date:   str
    rows:       list[OptionsRow]


class AnalyticsRow(BaseModel):
    trade_date: str          # "YYYY-MM-DD"
    pe:         Optional[float]
    ce:         Optional[float]
    pcr:        Optional[float]
    underlying: Optional[float]
    max_pain:   Optional[float]


class AnalyticsResponse(BaseModel):
    ticker:  str
    expiry:  str
    rows:    list[AnalyticsRow]


# ── Strike snapshot (single day, aggregated for chart) ────────────────────────

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


# ── Futures ───────────────────────────────────────────────────────────────────

class FuturesRow(BaseModel):
    trade_date:  str
    TckrSymb:    str
    XpryDt:      str
    OpnPric:     Optional[float]
    HghPric:     Optional[float]
    LwPric:      Optional[float]
    ClsPric:     Optional[float]
    TtlTradgVol: Optional[float]
    OpnIntrst:   Optional[float]
    ChngInOpnIntrst: Optional[float]

    class Config:
        extra = "ignore"


class FuturesDataResponse(BaseModel):
    ticker:     str
    expiry:     str
    start_date: str
    end_date:   str
    rows:       list[FuturesRow]


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
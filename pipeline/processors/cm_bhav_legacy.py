"""
cm_bhav legacy processor — old pre-CSV-relaunch NSE CM bhavcopy format
(SYMBOL/SERIES/OPEN/HIGH/LOW/CLOSE/LAST/PREVCLOSE/TOTTRDQTY/TOTTRDVAL/
TIMESTAMP/TOTALTRADES/ISIN)
→ instruments + market_data_daily

Same identity convention as cm_bhav.py: SctySrs/SERIES is meaningful for CM
(unlike F&O), so it IS part of the instrument key here. instrument_type has
no legacy equivalent to FinInstrmTp, so it's hardcoded to "STK" — same
default cm_bhav.py falls back to when FinInstrmTp is missing.

── Fields NOT present in the legacy format (always written NULL) ────────────
instrument_id (FinInstrmId), instrument_name (FinInstrmNm) — legacy has no
descriptive name field, just the SYMBOL code. Also open_interest,
change_in_oi, settlement_price, underlying_price, avg_price, delivery_qty,
delivery_pct — none of these have legacy source columns; open_interest /
change_in_oi / settlement_price / underlying_price don't apply to CM
anyway, they're carried only for schema-shape parity with market_data_daily.

TOTALTRADES maps to trade_count (equivalent of TtlNbOfTxsExctd).
"""

import pandas as pd
from pathlib import Path

from config import CM_BHAV_LEGACY_ROOT
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments, upsert_market_data


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(CM_BHAV_LEGACY_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def process(trade_date: str):
    if is_processed(trade_date, "cm_bhav"):
        print(f"[cm_bhav_legacy] {trade_date} already processed, skipping")
        return

    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()
    
    try:
        trade_dt = pd.to_datetime(df["TIMESTAMP"].iloc[0], format="%d-%b-%Y").date()
    except ValueError:
        trade_dt = pd.to_datetime(df["TIMESTAMP"].iloc[0], format="%d-%b-%y").date()

    df["series_"] = df["SERIES"].fillna("").str.strip()
    df["itype"]   = "STK"

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["itype"], r["SYMBOL"].strip(), None, None, None, r["series_"]
    ), axis=1)

    instr = pd.DataFrame({
        "instrument_key":   df["instrument_key"],
        "exchange":         "NSE",
        "segment":          "CM",
        "instrument_id":    pd.array([pd.NA] * len(df), dtype="Int64"),
        "instrument_type":  df["itype"],
        "ticker":           df["SYMBOL"].str.strip(),
        "instrument_name":  None,
        "isin":             df["ISIN"].str.strip(),
        "series":           df["series_"],
        "expiry":           None,
        "strike":           None,
        "option_type":      None,
    }).drop_duplicates("instrument_key")

    mdd = pd.DataFrame({
        "trade_date":       trade_dt,
        "instrument_key":   df["instrument_key"],
        "open":             pd.to_numeric(df["OPEN"],       errors="coerce"),
        "high":             pd.to_numeric(df["HIGH"],       errors="coerce"),
        "low":              pd.to_numeric(df["LOW"],        errors="coerce"),
        "close":            pd.to_numeric(df["CLOSE"],      errors="coerce"),
        "last":             pd.to_numeric(df["LAST"],       errors="coerce"),
        "prev_close":       pd.to_numeric(df["PREVCLOSE"],  errors="coerce"),
        "avg_price":        None,
        "volume":           pd.to_numeric(df["TOTTRDQTY"],  errors="coerce").astype("Int64"),
        "turnover":         pd.to_numeric(df["TOTTRDVAL"],  errors="coerce"),
        "trade_count":      pd.to_numeric(df["TOTALTRADES"],errors="coerce").astype("Int64"),
        "open_interest":    None,
        "change_in_oi":     None,
        "settlement_price": None,
        "underlying_price": None,
        "delivery_qty":     None,
        "delivery_pct":     None,
    })

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, instr)
        upsert_market_data(conn, mdd)
        conn.execute("COMMIT")
        print(f"[cm_bhav_legacy] {trade_date} — {len(df)} rows")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
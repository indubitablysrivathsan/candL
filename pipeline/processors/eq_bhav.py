"""
eq_bhav processor — sec_bhavdata_full_DDMMYYYY.csv
→ instruments + market_data_daily
"""

import pandas as pd
from pathlib import Path

from config import EQ_BHAV_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments, upsert_market_data


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(EQ_BHAV_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def process(trade_date: str):
    if is_processed(trade_date, "eq_bhav"):
        print(f"[eq_bhav] {trade_date} already processed, skipping")
        return

    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()

    # Date from column, not filename
    trade_dt = pd.to_datetime(df["DATE1"].iloc[0], dayfirst=True).date()

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        "EQ", r["SYMBOL"].strip(), None, None, None, r["SERIES"].strip()
    ), axis=1)

    instr = pd.DataFrame({
        "instrument_key":   df["instrument_key"],
        "exchange":         "NSE",
        "segment":          "CM",
        "instrument_type":  "EQ",
        "instrument_id":    None,
        "ticker":           df["SYMBOL"].str.strip(),
        "instrument_name":  df["SYMBOL"].str.strip(),
        "isin":             None,
        "series":           df["SERIES"].str.strip(),
        "expiry":           None,
        "actual_expiry":    None,
        "strike":           None,
        "option_type":      None,
        "lot_size":         None,
        "underlying_symbol":df["SYMBOL"].str.strip(),
        "is_active":        True,
    }).drop_duplicates("instrument_key")

    mdd = pd.DataFrame({
        "trade_date":       trade_dt,
        "instrument_key":   df["instrument_key"],
        "open":             pd.to_numeric(df["OPEN_PRICE"],   errors="coerce"),
        "high":             pd.to_numeric(df["HIGH_PRICE"],   errors="coerce"),
        "low":              pd.to_numeric(df["LOW_PRICE"],    errors="coerce"),
        "close":            pd.to_numeric(df["CLOSE_PRICE"],  errors="coerce"),
        "last":             pd.to_numeric(df["LAST_PRICE"],   errors="coerce"),
        "prev_close":       pd.to_numeric(df["PREV_CLOSE"],   errors="coerce"),
        "avg_price":        pd.to_numeric(df["AVG_PRICE"],    errors="coerce"),
        "volume":           pd.to_numeric(df["TTL_TRD_QNTY"], errors="coerce").astype("Int64"),
        "turnover":         pd.to_numeric(df["TURNOVER_LACS"],errors="coerce"),
        "trade_count":      pd.to_numeric(df["NO_OF_TRADES"], errors="coerce").astype("Int64"),
        "open_interest":    None,
        "change_in_oi":     None,
        "settlement_price": None,
        "underlying_price": None,
        "delivery_qty":     pd.to_numeric(df["DELIV_QTY"],    errors="coerce").astype("Int64"),
        "delivery_pct":     pd.to_numeric(df["DELIV_PER"],    errors="coerce"),
    })

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, instr)
        upsert_market_data(conn, mdd)
        conn.execute("COMMIT")
        print(f"[eq_bhav] {trade_date} — {len(df)} rows")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
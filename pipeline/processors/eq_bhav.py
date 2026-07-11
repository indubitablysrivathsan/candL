"""
eq_bhav processor — sec_bhavdata_full_DDMMYYYY.csv
Enrichment pass only: adds avg_price / delivery_qty / delivery_pct
onto rows that cm_bhav already inserted. Does NOT touch instruments,
does NOT insert new market_data_daily rows.
"""

import pandas as pd
from pathlib import Path

from config import EQ_BHAV_ROOT
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_delivery_stats


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

    trade_dt = pd.to_datetime(df["DATE1"].iloc[0], dayfirst=True).date()

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        "STK", r["SYMBOL"].strip(), None, None, None, r["SERIES"].strip()
    ), axis=1)

    deliv = pd.DataFrame({
        "trade_date":      trade_dt,
        "instrument_key":  df["instrument_key"],
        "avg_price":       pd.to_numeric(df["AVG_PRICE"],    errors="coerce"),
        "delivery_qty":    pd.to_numeric(df["DELIV_QTY"],    errors="coerce").astype("Int64"),
        "delivery_pct":    pd.to_numeric(df["DELIV_PER"],    errors="coerce"),
    }).drop_duplicates("instrument_key")

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_delivery_stats(conn, deliv)
        conn.execute("COMMIT")
        print(f"[eq_bhav] {trade_date} — {len(deliv)} delivery rows patched")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
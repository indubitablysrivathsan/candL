"""
cm_bhav processor — BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv
→ instruments + market_data_daily
"""

import pandas as pd
from pathlib import Path

from config import CM_BHAV_ROOT
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments, upsert_market_data


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(CM_BHAV_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def process(trade_date: str):
    if is_processed(trade_date, "cm_bhav"):
        print(f"[cm_bhav] {trade_date} already processed, skipping")
        return

    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()

    trade_dt = pd.to_datetime(df["TradDt"].iloc[0], format="%Y-%m-%d", errors="coerce").date()

    df["series_"] = df["SctySrs"].fillna("").str.strip()
    df["itype"]   = df["FinInstrmTp"].fillna("STK").str.strip()

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["itype"], r["TckrSymb"].strip(), None, None, None, r["series_"]
    ), axis=1)

    instr = pd.DataFrame({
        "instrument_key":   df["instrument_key"],
        "exchange":         "NSE",
        "segment":          "CM",
        "instrument_type":  df["itype"],
        "instrument_id":    pd.to_numeric(df["FinInstrmId"], errors="coerce").astype("Int64"),
        "ticker":           df["TckrSymb"].str.strip(),
        "instrument_name":  df["FinInstrmNm"].str.strip(),
        "isin":             df["ISIN"].str.strip(),
        "series":           df["series_"],
        "expiry":           None,
        "actual_expiry":    None,
        "strike":           None,
        "option_type":      None,
        "lot_size":         pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64"),
    }).drop_duplicates("instrument_key")

    mdd = pd.DataFrame({
        "trade_date":       trade_dt,
        "instrument_key":   df["instrument_key"],
        "open":             pd.to_numeric(df["OpnPric"],        errors="coerce"),
        "high":             pd.to_numeric(df["HghPric"],        errors="coerce"),
        "low":              pd.to_numeric(df["LwPric"],         errors="coerce"),
        "close":            pd.to_numeric(df["ClsPric"],        errors="coerce"),
        "last":             pd.to_numeric(df["LastPric"],       errors="coerce"),
        "prev_close":       pd.to_numeric(df["PrvsClsgPric"],   errors="coerce"),
        "avg_price":        None,
        "volume":           pd.to_numeric(df["TtlTradgVol"],    errors="coerce").astype("Int64"),
        "turnover":         pd.to_numeric(df["TtlTrfVal"],      errors="coerce"),
        "trade_count":      pd.to_numeric(df["TtlNbOfTxsExctd"],errors="coerce").astype("Int64"),
        "open_interest":    pd.to_numeric(df["OpnIntrst"],      errors="coerce").astype("Int64"),
        "change_in_oi":     pd.to_numeric(df["ChngInOpnIntrst"],errors="coerce").astype("Int64"),
        "settlement_price": pd.to_numeric(df["SttlmPric"],      errors="coerce"),
        "underlying_price": pd.to_numeric(df["UndrlygPric"],    errors="coerce"),
        "delivery_qty":     None,
        "delivery_pct":     None,
    })

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, instr)
        upsert_market_data(conn, mdd)
        conn.execute("COMMIT")
        print(f"[cm_bhav] {trade_date} — {len(df)} rows")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
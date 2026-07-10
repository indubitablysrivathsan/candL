"""
cm_securities.py
CM security master processor
→ instruments (upsert), security_master_daily, corporate_actions
"""

import pandas as pd
import duckdb
from pathlib import Path

from config import CM_SECURITY_RAW_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed, mark_processed
from .keys import make_instrument_key
from .common import upsert_instruments


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(CM_SECURITY_RAW_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def _load(trade_date: str) -> pd.DataFrame:
    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)
    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()
    return df


def _epoch_to_date(series: pd.Series) -> pd.Series:
    """Legacy CM security master date fields are epoch seconds; 0 means null."""
    s = pd.to_numeric(series, errors="coerce")
    s = s.where(s > 0, None)
    return pd.to_datetime(s, unit="s", errors="coerce").dt.date


def _clean_sentinel(series: pd.Series) -> pd.Series:
    """999999999 is NSE's 'unlimited / no cap' marker, not a real quantity."""
    s = pd.to_numeric(series, errors="coerce")
    return s.where(s != 999_999_999, None)


# ── instrument identity ────────────────────────────────────────────────────────

def _build_instruments(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["lot_i"] = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")

    # equities have no expiry/strike/option_type — key collapses to
    # (instrument_type, ticker, "", "", "", series)
    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["FinInstrmTp"], r["TckrSymb"],
        None, None,
        None, r.get("SctySrs"),
    ), axis=1)

    instr = df[[
        "instrument_key", "FinInstrmTp", "FinInstrmId",
        "TckrSymb", "FinInstrmNm", "ISIN", "SctySrs", "lot_i",
    ]].drop_duplicates("instrument_key").copy()

    instr.columns = [
        "instrument_key", "instrument_type", "instrument_id",
        "ticker", "instrument_name", "isin", "series", "lot_size",
    ]
    instr.insert(1, "exchange", "NSE")
    instr.insert(2, "segment", "CM")
    instr["fin_instrm_tp"] = instr["instrument_type"]
    instr["expiry"] = None
    instr["actual_expiry"] = None
    instr["strike"] = None
    instr["option_type"] = None

    instr = instr[[
        "instrument_key", "exchange", "segment", "instrument_id",
        "instrument_type", "fin_instrm_tp", "ticker", "instrument_name",
        "isin", "series", "expiry", "actual_expiry", "strike", "option_type",
        "lot_size",
    ]]
    return df, instr


# ── security_master_daily ──────────────────────────────────────────────────────

def _build_security_master(df: pd.DataFrame, trade_date: str) -> pd.DataFrame:
    d = pd.DataFrame()
    d["trade_date"]      = pd.to_datetime(trade_date).date()
    d["instrument_key"]  = df["instrument_key"]

    d["lot_size"]          = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")
    d["tick_size"]           = pd.to_numeric(df["TickSz"], errors="coerce")
    d["min_price"]             = pd.to_numeric(df["MinPric"], errors="coerce")
    d["max_price"]              = pd.to_numeric(df["MaxPric"], errors="coerce")

    d["settlement_type"]         = df["SttlmTp"].astype("string")
    d["par_value"]                 = pd.to_numeric(df["ParVal"], errors="coerce")
    d["issued_capital"]              = pd.to_numeric(df["IssdCptl"], errors="coerce")
    d["max_trade_pct"]                 = _clean_sentinel(df["MaxTradQtyPctg"])

    d["listing_date"]                    = _epoch_to_date(df["ListgDt"])
    d["record_date"]                       = _epoch_to_date(df["RcrdDt"])
    d["removal_date"]                        = _epoch_to_date(df["RmvlDt"])
    d["readmission_date"]                      = _epoch_to_date(df["RadmssnDt"])

    d = d.drop_duplicates(subset=["trade_date", "instrument_key"])
    return d


def _upsert_security_master(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    conn.register("_secmaster_stage", df)
    conn.execute("""
        INSERT INTO security_master_daily
        SELECT * FROM _secmaster_stage
        ON CONFLICT (trade_date, instrument_key) DO UPDATE SET
            lot_size          = excluded.lot_size,
            tick_size          = excluded.tick_size,
            min_price           = excluded.min_price,
            max_price            = excluded.max_price,
            settlement_type       = excluded.settlement_type,
            par_value               = excluded.par_value,
            issued_capital           = excluded.issued_capital,
            max_trade_pct             = excluded.max_trade_pct,
            listing_date               = excluded.listing_date,
            record_date                  = excluded.record_date,
            removal_date                   = excluded.removal_date,
            readmission_date                 = excluded.readmission_date
    """)
    conn.unregister("_secmaster_stage")


# ── corporate actions ───────────────────────────────────────────────────────────

def _build_corp_actions(df: pd.DataFrame) -> pd.DataFrame:
    """
    CM security master has three explicit ex-date fields rather than a single
    reason string: ExDvddDt, ExBnsDt, ExRghtsDt. Any row where at least one is
    populated gets one corp_actions row per non-null ex-date type.
    """
    frames = []
    ex_date_cols = {
        "ExDvddDt":  "dividend",
        "ExBnsDt":   "bonus",
        "ExRghtsDt": "rights",
    }

    for col, event_type in ex_date_cols.items():
        if col not in df.columns:
            continue
        sub = df[["ISIN", "TckrSymb", "RcrdDt", col]].copy()
        sub["ex_date"] = _epoch_to_date(sub[col])
        sub = sub.dropna(subset=["ex_date"])
        if sub.empty:
            continue
        sub["record_date"] = _epoch_to_date(sub["RcrdDt"])
        sub["event_type"] = event_type
        sub["purpose_raw"] = None
        sub["ratio_numerator"] = None
        sub["ratio_denominator"] = None
        sub = sub.rename(columns={"ISIN": "isin", "TckrSymb": "ticker"})
        frames.append(sub[[
            "isin", "ticker", "event_type", "ratio_numerator",
            "ratio_denominator", "ex_date", "record_date", "purpose_raw",
        ]])

    if not frames:
        return pd.DataFrame(columns=[
            "isin", "ticker", "event_type", "ratio_numerator",
            "ratio_denominator", "ex_date", "record_date", "purpose_raw",
        ])

    ca = pd.concat(frames).drop_duplicates(subset=["isin", "ex_date"])
    return ca


def _upsert_corp_actions(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    if df.empty:
        return
    conn.register("_ca_stage", df)
    conn.execute("""
        INSERT INTO corporate_actions
        SELECT * FROM _ca_stage
        ON CONFLICT (isin, ex_date) DO UPDATE SET
            ticker       = excluded.ticker,
            event_type   = excluded.event_type,
            record_date  = excluded.record_date
    """)
    conn.unregister("_ca_stage")


# ── entry point ─────────────────────────────────────────────────────────────────

def process(trade_date: str):
    if is_processed(trade_date, "CM_SECURITY"):
        print(f"[cm_security] {trade_date} already processed, skipping")
        return

    raw = _load(trade_date)
    raw, instr = _build_instruments(raw)
    sec_master = _build_security_master(raw, trade_date)
    corp_actions = _build_corp_actions(raw)

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, instr)
        _upsert_security_master(conn, sec_master)
        _upsert_corp_actions(conn, corp_actions)
        mark_processed(trade_date, "CM_SECURITY")
        conn.execute("COMMIT")
        print(f"[cm_security] {trade_date} — {len(sec_master)} security rows, {len(corp_actions)} corp actions")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
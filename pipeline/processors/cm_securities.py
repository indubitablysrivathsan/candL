"""
cm_securities.py
CM security master processor
→ instruments (upsert), security_master_daily, corporate_actions

NOTE: this file is forward-looking, same as fo_contracts.py. A security
master dated `file_date` describes the CM security universe effective
on the NEXT trading session. `file_date` (publication date, used to
locate the file on disk) is kept separate from `trade_date` (the
effective session the snapshot applies to, written into
security_master_daily). The caller (startup_sync.py) resolves
trade_date from the manifest rather than assuming file_date + 1
calendar day, so weekends/holidays/gaps are handled correctly.
"""

import pandas as pd
import duckdb
from pathlib import Path

from config import CM_SECURITY_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments


def _raw_path(file_date: str) -> Path:
    dt = pd.to_datetime(file_date)
    return Path(CM_SECURITY_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{file_date}.csv"


def _load(file_date: str) -> pd.DataFrame:
    p = _raw_path(file_date)
    if not p.exists():
        raise FileNotFoundError(p)
    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()
    return df


# Empirically, cm securities timestamps are offset by 10 years
# relative to the corresponding F&O Bhavcopy.
_EPOCH_10Y_OFFSET = int(
    pd.Timestamp("2026-01-01").timestamp()
    - pd.Timestamp("2016-01-01").timestamp()
    - 86400
)

def _epoch_to_date(series: pd.Series) -> pd.Series:
    """Decode legacy contract master epoch fields (0 means null)."""
    s = pd.to_numeric(series, errors="coerce")
    s = s.where(s > 0)

    return pd.to_datetime(s + _EPOCH_10Y_OFFSET, unit="s", errors="coerce").dt.date



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
    instr["expiry"] = None
    instr["actual_expiry"] = None
    instr["strike"] = None
    instr["option_type"] = None

    instr = instr[[
        "instrument_key", "exchange", "segment", "instrument_id",
        "instrument_type", "ticker", "instrument_name",
        "isin", "series", "expiry", "actual_expiry", "strike", "option_type",
        "lot_size",
    ]]
    return df, instr


# ── security_master_daily ──────────────────────────────────────────────────────

def _build_security_master(df: pd.DataFrame, file_date: str, trade_date: str) -> pd.DataFrame:
    """
    `trade_date` here is the EFFECTIVE session (next trading day after
    file_date), resolved by the caller — never file_date itself.
    """
    d = pd.DataFrame(index=df.index)
    d["file_date"]      = pd.to_datetime(file_date).date()
    d["trade_date"]      = pd.to_datetime(trade_date).date()
    d["instrument_key"]  = df["instrument_key"]

    d["lot_size"]          = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")

    d["par_value"]                 = pd.to_numeric(df["ParVal"], errors="coerce")
    d["issued_capital"]              = pd.to_numeric(df["IssdCptl"], errors="coerce")
    d["max_trade_pct"]                 = _clean_sentinel(df["MaxTradQtyPctg"])

    d["listing_date"]                    = _epoch_to_date(df["ListgDt"])
    d["record_date"]                       = _epoch_to_date(df["RcrdDt"])

    d = d.drop_duplicates(subset=["trade_date", "instrument_key"])
    return d


def _upsert_security_master(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    conn.register("_secmaster_stage", df)
    conn.execute("""
        INSERT INTO security_master_daily
        SELECT * FROM _secmaster_stage
        ON CONFLICT (trade_date, instrument_key) DO UPDATE SET
            lot_size          = excluded.lot_size,
            par_value               = excluded.par_value,
            issued_capital           = excluded.issued_capital,
            max_trade_pct             = excluded.max_trade_pct,
            listing_date               = excluded.listing_date,
            record_date                  = excluded.record_date
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

def process(file_date: str, trade_date: str):
    """
    file_date  — date in the downloaded filename (publication date); used
                 to locate the raw file on disk.
    trade_date — the confirmed next trading day this snapshot is effective
                 for; resolved by the caller (startup_sync.py) from the
                 manifest via get_next_confirmed_trading_date, NOT by
                 assuming file_date + 1 calendar day. This is what gets
                 written to security_master_daily and checked against
                 is_processed.
    """
    if is_processed(trade_date, "CM_SECURITY"):
        print(f"[cm_security] {trade_date} (file {file_date}) already processed, skipping")
        return

    raw = _load(file_date)
    raw, instr = _build_instruments(raw)
    sec_master = _build_security_master(raw, file_date, trade_date)
    corp_actions = _build_corp_actions(raw)

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, instr)
        _upsert_security_master(conn, sec_master)
        _upsert_corp_actions(conn, corp_actions)
        conn.execute("COMMIT")
        print(f"[cm_security] file={file_date} → trade_date={trade_date} — "
              f"{len(sec_master)} security rows, {len(corp_actions)} corp actions")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
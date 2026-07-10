"""
fo_contracts.py
FO contract master processor (legacy / pre-UDIFF format)
→ instruments (upsert), instrument_contract_daily, corporate_actions
"""

import pandas as pd
import duckdb
from pathlib import Path

from config import FO_CONTRACT_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_CONTRACT_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def _load(trade_date: str) -> pd.DataFrame:
    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)
    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()
    return df


def _epoch_to_date(series: pd.Series) -> pd.Series:
    """Legacy contract master date fields are epoch seconds; 0 means null."""
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
    df["expiry_d"]  = _epoch_to_date(df["XpryDt"])
    df["strike_f"]  = pd.to_numeric(df["StrkPric"], errors="coerce")
    df["lot_i"]     = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["FinInstrmTp"], r["TckrSymb"],
        r["expiry_d"], r["strike_f"],
        r.get("OptnTp"), r.get("SrsId"),
    ), axis=1)

    instr = df[[
        "instrument_key", "FinInstrmTp", "FinInstrmId",
        "TckrSymb", "FinInstrmNm", "ISIN", "SrsId",
        "expiry_d", "strike_f", "OptnTp", "lot_i",
    ]].drop_duplicates("instrument_key").copy()

    instr.columns = [
        "instrument_key", "instrument_type", "instrument_id",
        "ticker", "instrument_name", "isin", "series",
        "expiry", "strike", "option_type", "lot_size",
    ]
    instr.insert(1, "exchange", "NSE")
    instr.insert(2, "segment", "FO")
    instr["actual_expiry"] = None  # not present in contract master

    # reorder to match instruments table exactly
    instr = instr[[
        "instrument_key", "exchange", "segment", "instrument_id",
        "instrument_type", "ticker", "instrument_name",
        "isin", "series", "expiry", "actual_expiry", "strike", "option_type",
        "lot_size",
    ]]
    return df, instr


# ── instrument_contract_daily ──────────────────────────────────────────────────

def _build_contract_daily(df: pd.DataFrame, trade_date: str) -> pd.DataFrame:
    d = pd.DataFrame(index=df.index) 
    d["trade_date"]          = pd.to_datetime(trade_date).date()
    d["instrument_key"]      = df["instrument_key"]

    d["lot_size"]            = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")
    d["min_lot"]              = pd.to_numeric(df["MinLot"], errors="coerce").astype("Int64")

    d["margin_pct"]           = pd.to_numeric(df["MrgnPctg"], errors="coerce")
    d["base_price"]            = pd.to_numeric(df["BasePric"], errors="coerce")
    d["min_price"]              = pd.to_numeric(df["MinPric"], errors="coerce")
    d["max_price"]                = pd.to_numeric(df["MaxPric"], errors="coerce")

    d["settlement_method"]         = df["SttlmMtd"].astype("string")
    d["exercise_style"]             = df["OptnExrcStyle"].astype("string")

    d["max_single_txn_qty"]         = _clean_sentinel(df["MaxTradQty"]).astype("Int64")

    d["admission_date"]              = _epoch_to_date(df["AdmssnDt"])
    d["removal_date"]                 = _epoch_to_date(df["RmvlDt"])
    d["readmission_date"]              = _epoch_to_date(df["RadmssnDt"])

    d = d.drop_duplicates(subset=["trade_date", "instrument_key"])
    return d


def _upsert_contract_daily(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    conn.register("_contract_stage", df)
    conn.execute("""
        INSERT INTO instrument_contract_daily
        SELECT * FROM _contract_stage
        ON CONFLICT (trade_date, instrument_key) DO UPDATE SET
            lot_size            = excluded.lot_size,
            min_lot              = excluded.min_lot,
            margin_pct            = excluded.margin_pct,
            base_price             = excluded.base_price,
            min_price               = excluded.min_price,
            max_price                = excluded.max_price,
            settlement_method         = excluded.settlement_method,
            exercise_style             = excluded.exercise_style,
            max_single_txn_qty          = excluded.max_single_txn_qty,
            admission_date                = excluded.admission_date,
            removal_date                   = excluded.removal_date,
            readmission_date                = excluded.readmission_date
    """)
    conn.unregister("_contract_stage")


# ── corporate actions ───────────────────────────────────────────────────────────

def _build_corp_actions(df: pd.DataFrame) -> pd.DataFrame:
    mask = df["CorpActnRsn"].notna() & (df["CorpActnRsn"].astype("string").str.strip() != "")
    ca = df.loc[mask, ["ISIN", "TckrSymb", "CorpActnRsn", "RcrdDt", "BookClsrStartDt"]].copy()
    if ca.empty:
        return ca

    ca["record_date"] = _epoch_to_date(ca["RcrdDt"])
    ca["ex_date"]      = _epoch_to_date(ca["BookClsrStartDt"])  # book closure start used as ex-date proxy pre-UDIFF

    ca = ca.rename(columns={
        "ISIN": "isin", "TckrSymb": "ticker", "CorpActnRsn": "purpose_raw",
    })[["isin", "ticker", "purpose_raw", "ex_date", "record_date"]]

    # event_type / ratio require parsing free-text purpose_raw — deferred until
    # real non-blank samples are confirmed (e.g. "BONUS 1:1", "FACE VALUE SPLIT ...")
    ca["event_type"]         = None
    ca["ratio_numerator"]     = None
    ca["ratio_denominator"]    = None

    ca = ca.dropna(subset=["ex_date"]).drop_duplicates(subset=["isin", "ex_date"])
    return ca[["isin", "ticker", "event_type", "ratio_numerator",
               "ratio_denominator", "ex_date", "record_date", "purpose_raw"]]


def _upsert_corp_actions(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    if df.empty:
        return
    conn.register("_ca_stage", df)
    conn.execute("""
        INSERT INTO corporate_actions
        SELECT * FROM _ca_stage
        ON CONFLICT (isin, ex_date) DO UPDATE SET
            ticker       = excluded.ticker,
            purpose_raw  = excluded.purpose_raw,
            record_date  = excluded.record_date
    """)
    conn.unregister("_ca_stage")


# ── entry point ─────────────────────────────────────────────────────────────────

def process(trade_date: str):
    if is_processed(trade_date, "FO_CONTRACT"):
        print(f"[fo_contract] {trade_date} already processed, skipping")
        return

    raw = _load(trade_date)
    raw, instr = _build_instruments(raw)
    contract_daily = _build_contract_daily(raw, trade_date)
    corp_actions = _build_corp_actions(raw)

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, instr)
        _upsert_contract_daily(conn, contract_daily)
        _upsert_corp_actions(conn, corp_actions)
        conn.execute("COMMIT")
        print(f"[fo_contract] {trade_date} — {len(contract_daily)} contract rows, {len(corp_actions)} corp actions")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
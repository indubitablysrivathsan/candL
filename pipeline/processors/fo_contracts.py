"""
fo_contracts.py
FO contract master processor (legacy / pre-UDIFF format)
→ instruments (upsert), instrument_contract_daily, corporate_actions

NOTE: SrsId is not reliable for F&O contracts (mostly blank/garbage — 'XX'
or empty), unlike CM where SctySrs/SrsId is meaningful (EQ, BE, SM, etc.).
`series` is therefore always written as NULL for F&O instruments and is
NOT part of the instrument_key — this must stay consistent with fo.py,
which independently derives F&O instrument_keys from the daily bhavcopy.
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

    # Legacy contract master ships mislabeled headers:
    #   actual "FinInstrmTp" column is named "FinInstrmNm"
    #   actual "FinInstrmNm" column is named "StockNm"
    df = df.drop(columns=["FinInstrmTp"], errors="ignore").rename(columns={
        "FinInstrmNm": "FinInstrmTp",
        "StockNm":     "FinInstrmNm",
    })

    return df

_LEGACY_INSTR_MAP = {
    "OPTSTK": "STO",
    "OPTIDX": "IDO",
    "FUTSTK": "STF",
    "FUTIDX": "IDF",
}
_OPTION_TYPES = {"STO", "IDO"}

_NORMALIZED_INSTR_TYPES = set(_LEGACY_INSTR_MAP.values())  # {"STO","IDO","STF","IDF"}

def _normalize_instr_type(series: pd.Series) -> pd.Series:
    """Map legacy raw codes (OPTSTK/OPTIDX/FUTSTK/FUTIDX) -> normalized codes.

    Idempotent by design: if called again on values that are already
    normalized (e.g. because an upstream step re-runs this on a frame
    that was already processed), those values pass through unchanged
    instead of being flagged as unmapped and dropped.
    """
    s = series.astype("string").str.strip().str.upper()
    already_normalized = s.isin(_NORMALIZED_INSTR_TYPES)
    mapped = s.map(_LEGACY_INSTR_MAP)
    mapped = mapped.where(~already_normalized, s)
    unknown = s[mapped.isna() & s.notna()].unique()
    if len(unknown):
        print(f"[fo_contract] WARNING unmapped FinInstrmTp values: {unknown}")
    return mapped

# Empirically, contract master timestamps are offset by 10 years
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


def _drop_invalid_rows(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """
    Drops invalid contract rows.

    Removes:
    - Placeholder/stale rows with both TckrSymb and FinInstrmNm blank.
    - Rows with negative strike prices.
    """
    df = df.copy()

    df["TckrSymb"] = df["TckrSymb"].astype("string").str.strip()
    df["FinInstrmNm"] = df["FinInstrmNm"].astype("string").str.strip()
    df["StrkPric"] = pd.to_numeric(df["StrkPric"], errors="coerce")

    valid_symbol = (
        (df["TckrSymb"].notna() & (df["TckrSymb"] != "")) |
        (df["FinInstrmNm"].notna() & (df["FinInstrmNm"] != ""))
    )
    # -1 is NSE's sentinel for "strike not applicable" on futures rows
    # (every FUTSTK/FUTIDX row ships StrkPric=-1), not a genuine invalid
    # negative strike. Only reject strikes that are negative and not
    # this sentinel.
    valid_strike = df["StrkPric"].isna() | (df["StrkPric"] == -1) | (df["StrkPric"] >= 0)
    mask = valid_symbol & valid_strike
    dropped = len(df) - mask.sum()

    return df[mask].copy(), dropped

# ── instrument identity ────────────────────────────────────────────────────────

def _build_instruments(df: pd.DataFrame) -> pd.DataFrame:
    df, dropped = _drop_invalid_rows(df)

    empty_instr_cols = [
        "instrument_key", "exchange", "segment", "instrument_id",
        "instrument_type", "ticker", "instrument_name",
        "isin", "series", "expiry", "actual_expiry", "strike", "option_type",
        "lot_size",
    ]
    if df.empty:
        return df, pd.DataFrame(columns=empty_instr_cols), dropped

    df["expiry_d"]  = _epoch_to_date(df["XpryDt"])

    # NOTE: normalize exactly once. Calling this twice re-maps already-
    # normalized values ("STO"/"IDO"/"STF"/"IDF") against the raw-value
    # map above, which doesn't recognize them, flags them as "unmapped",
    # and drops every row.
    df["FinInstrmTp"] = _normalize_instr_type(df["FinInstrmTp"])
    df = df[df["FinInstrmTp"].notna()].copy()

    is_option = df["FinInstrmTp"].isin(_OPTION_TYPES)

    # StrkPric/OptnTp are only meaningful for options. For futures NSE ships
    # these blank, which pandas turns into NaN / <NA> — NOT the same value
    # as the plain `None` that fo.py passes for futures when it builds
    # instrument_key from the daily bhavcopy. If NaN/<NA> leaks into
    # make_instrument_key() for futures here, the resulting key hashes
    # differently from fo.py's key for the same contract, so futures
    # silently fail to join. Force futures to real `None` explicitly so
    # both processors derive identical instrument_keys.
    df["strike_f"] = (pd.to_numeric(df["StrkPric"], errors="coerce") / 100).where(is_option)
    df["strike_f"] = df["strike_f"].where(df["strike_f"].notna(), None)

    df["OptnTp"] = df["OptnTp"].astype("string").where(is_option)
    df["OptnTp"] = df["OptnTp"].where(df["OptnTp"].notna(), None)

    df["lot_i"] = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")

    # series is not part of the identity key for F&O — SrsId is unreliable
    # (mostly 'XX' or blank) and must stay consistent with fo.py, which
    # also passes None for series when generating instrument_key.
    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["FinInstrmTp"], r["TckrSymb"],
        r["expiry_d"], r["strike_f"],
        r["OptnTp"], None,
    ), axis=1)

    instr = df[[
        "instrument_key", "FinInstrmTp", "FinInstrmId",
        "TckrSymb", "FinInstrmNm", "ISIN",
        "expiry_d", "strike_f", "OptnTp", "lot_i",
    ]].drop_duplicates("instrument_key").copy()

    instr.columns = [
        "instrument_key", "instrument_type", "instrument_id",
        "ticker", "instrument_name", "isin",
        "expiry", "strike", "option_type", "lot_size",
    ]
    instr.insert(1, "exchange", "NSE")
    instr.insert(2, "segment", "FO")
    instr["series"] = None          # not meaningful for F&O — always NULL
    instr["actual_expiry"] = None   # not present in contract master

    # reorder to match instruments table exactly
    instr = instr[empty_instr_cols]
    return df, instr, dropped


# ── instrument_contract_daily ──────────────────────────────────────────────────

def _build_contract_daily(df: pd.DataFrame, trade_date: str) -> pd.DataFrame:
    d = pd.DataFrame(index=df.index) 
    d["trade_date"]             = pd.to_datetime(trade_date).date()
    d["instrument_key"]         = df["instrument_key"]

    d["lot_size"]               = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")
    d["min_lot"]                = pd.to_numeric(df["MinLot"], errors="coerce").astype("Int64")

    d["margin_pct"]             = pd.to_numeric(df["MrgnPctg"], errors="coerce") / 100
    d["base_price"]             = pd.to_numeric(df["BasePric"], errors="coerce") / 100
    d["min_price"]              = pd.to_numeric(df["MinPric"], errors="coerce") / 100
    d["max_price"]              = pd.to_numeric(df["MaxPric"], errors="coerce") / 100

    d["settlement_method"]      = df["SttlmMtd"].astype("string")
    d["exercise_style"]         = df["OptnExrcStyle"].astype("string")

    d["max_single_txn_qty"]     = _clean_sentinel(df["MaxTradQty"]).astype("Int64")

    d["admission_date"]         = _epoch_to_date(df["AdmssnDt"])

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
    raw, instr, dropped = _build_instruments(raw)

    if raw.empty:
        print(f"[fo_contract] {trade_date} — 0 usable rows after filtering, nothing to process")
        return

    contract_daily = _build_contract_daily(raw, trade_date)
    corp_actions = _build_corp_actions(raw)

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, instr)
        _upsert_contract_daily(conn, contract_daily)
        _upsert_corp_actions(conn, corp_actions)
        conn.execute("COMMIT")
        print(f"[fo_contract] {trade_date} — {len(contract_daily)} contract rows, {len(corp_actions)} corp actions, {dropped} invalid rows dropped")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
"""
FO legacy bhavcopy processor
→ instruments, market_data_daily, options_analytics, futures_analytics

Handles the old pre-CSV-relaunch NSE F&O bhavcopy format (columns like
INSTRUMENT/SYMBOL/EXPIRY_DT/STRIKE_PR/OPTION_TYP/...), which predates the
FinInstrmTp/TckrSymb/XpryDt-style format handled by fo_bhavcopy.py.

Two format differences drive most of this file's logic:

1. Instrument-type codes differ: legacy uses FUTIDX/FUTSTK/OPTIDX/OPTSTK
   instead of STF/IDF/STO/IDO. These are mapped 1:1 onto the *same*
   STF/IDF/STO/IDO namespace used everywhere else (instruments.instrument_type,
   futures_analytics/options_analytics keys, is_processed() checks), so
   downstream consumers and the existing is_processed("STF"/"STO") checks
   work unmodified regardless of which processor populated a given date.

2. Legacy uses sentinel placeholders instead of blanks for non-applicable
   fields on futures rows: STRIKE_PR=0 and OPTION_TYP='XX'. These are
   normalized to NaN/None for FUT instrument types before key generation,
   to match the blank convention fo_bhavcopy.py / fo_contracts.py rely on —
   otherwise a future and its "same" contract from the new-format pipeline
   would hash to different instrument_keys.

── Fields NOT present in the legacy format (always written NULL) ────────────
instrument_id (FinInstrmId), isin, series (already NULL for F&O anyway),
last, prev_close, underlying_price, trade_count, delivery_qty, delivery_pct,
avg_price. Lot size is also unavailable, so choi_volume_ratio in
futures_analytics is always NULL for legacy dates (no actual_volume can be
computed). basis / cost_of_carry are always NULL too, since both depend on
underlying_price.

turnover: legacy reports VAL_INLAKH (value in lakhs) instead of a rupee
total, so it's scaled by 1e5 to line up with TtlTrfVal in the new format.

── Compute/write split ──────────────────────────────────────────────────────
Same shape as fo_bhavcopy.py: `process(trade_date)` does everything in one
transaction (startup_sync path); `compute(trade_date)` is pure pandas/numpy/
in-memory-duckdb work safe for a ProcessPoolExecutor worker, and `write(conn,
result, trade_date)` persists it on the single writer connection.
`process()` is `write(conn, compute(trade_date), trade_date)` internally —
no drift between the sequential and parallel paths.

The futures_analytics/options_analytics table writers are NOT duplicated
here — they're imported from fo_bhavcopy.py since the target tables, SQL,
and conflict-resolution logic are identical. Only the compute side differs
(legacy has fewer source columns).
"""

import numpy as np
import pandas as pd
import duckdb
from pathlib import Path

from config import FO_LEGACY_RAW_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments, upsert_market_data
from .fo_bhavcopy import (
    _QUADRANT,
    _write_futures_rows,
    _write_options_rows,
)


_LEGACY_FUT = {"FUTIDX", "FUTSTK"}
_LEGACY_OPT = {"OPTIDX", "OPTSTK"}

# legacy codes -> same STF/IDF/STO/IDO namespace used by fo_bhavcopy.py,
# instruments.instrument_type, and is_processed()
_LEGACY_TYPE_MAP = {
    "FUTIDX": "IDF",
    "FUTSTK": "STF",
    "OPTIDX": "IDO",
    "OPTSTK": "STO",
}


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_LEGACY_RAW_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def _load(trade_date: str) -> pd.DataFrame:
    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)
    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()
    return df


def _drop_blank_rows(df: pd.DataFrame) -> pd.DataFrame:
    """Drops placeholder/stale rows — identified by blank SYMBOL. Mirrors
    the guard in fo_bhavcopy.py, adapted to the legacy column name (there's
    no separate FinInstrmNm-equivalent field in the legacy format)."""
    df = df.copy()
    df["SYMBOL"] = df["SYMBOL"].astype("string").str.strip()

    mask = df["SYMBOL"].notna() & (df["SYMBOL"] != "")

    dropped = len(df) - mask.sum()
    if dropped:
        print(f"[fo_legacy] dropping {dropped} blank/placeholder rows")

    return df[mask].copy()


def _normalize_types(df: pd.DataFrame) -> pd.DataFrame:
    """Maps legacy INSTRUMENT codes onto the STF/IDF/STO/IDO namespace, and
    clears the futures sentinel placeholders (STRIKE_PR=0, OPTION_TYP='XX')
    to NaN/None so futures rows key identically to the new-format pipeline."""
    df = df.copy()
    df["INSTRUMENT"] = df["INSTRUMENT"].astype("string").str.strip()
    df["instrument_type"] = df["INSTRUMENT"].map(_LEGACY_TYPE_MAP)

    is_fut = df["INSTRUMENT"].isin(_LEGACY_FUT)
    df["STRIKE_PR"] = pd.to_numeric(df["STRIKE_PR"], errors="coerce")
    df.loc[is_fut, "STRIKE_PR"] = np.nan

    df["OPTION_TYP"] = df["OPTION_TYP"].astype("string").str.strip()
    df.loc[is_fut, "OPTION_TYP"] = pd.NA

    return df


# ── instrument key generation ─────────────────────────────────────────────

def _build_instruments(df: pd.DataFrame) -> pd.DataFrame:
    df = _drop_blank_rows(df)

    empty_instr_cols = [
        "instrument_key", "exchange", "segment", "instrument_id",
        "instrument_type", "ticker", "instrument_name",
        "isin", "series", "expiry", "strike", "option_type",
    ]
    if df.empty:
        return df, pd.DataFrame(columns=empty_instr_cols)

    df = _normalize_types(df)

    df["expiry_d"] = pd.to_datetime(
        df["EXPIRY_DT"], format="%d-%b-%y", errors="coerce"
    ).dt.date
    df["strike_f"] = df["STRIKE_PR"]

    # series is not part of the identity key for F&O, must stay NULL —
    # consistent with fo_bhavcopy.py / fo_contracts.py
    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["instrument_type"], r["SYMBOL"],
        r["expiry_d"], r["strike_f"],
        r.get("OPTION_TYP"), None,
    ), axis=1)

    instr = df[[
        "instrument_key", "instrument_type",
        "SYMBOL", "expiry_d", "strike_f", "OPTION_TYP",
    ]].drop_duplicates("instrument_key").copy()

    instr.columns = [
        "instrument_key", "instrument_type",
        "ticker", "expiry", "strike", "option_type",
    ]
    instr.insert(1, "exchange", "NSE")
    instr.insert(2, "segment", "FO")
    instr["instrument_id"] = pd.array([pd.NA] * len(instr), dtype="Int64")
    instr["instrument_name"] = None
    instr["isin"] = None
    instr["series"] = None  # not meaningful for F&O — always NULL

    # column order MUST match `instruments` table exactly — upsert is positional
    instr = instr[empty_instr_cols]
    return df, instr


def _build_market_data(df: pd.DataFrame) -> pd.DataFrame:
    d = pd.DataFrame()
    d["trade_date"]       = pd.to_datetime(df["TIMESTAMP"], format="%d-%b-%y", errors="coerce").dt.date
    d["instrument_key"]   = df["instrument_key"]
    d["open"]             = pd.to_numeric(df["OPEN"],  errors="coerce")
    d["high"]             = pd.to_numeric(df["HIGH"],  errors="coerce")
    d["low"]              = pd.to_numeric(df["LOW"],   errors="coerce")
    d["close"]            = pd.to_numeric(df["CLOSE"], errors="coerce")
    d["last"]             = None
    d["prev_close"]       = None
    d["avg_price"]        = None
    d["volume"]           = pd.to_numeric(df["CONTRACTS"],  errors="coerce").astype("Int64")
    d["turnover"]         = pd.to_numeric(df["VAL_INLAKH"], errors="coerce") * 1e5
    d["trade_count"]      = None
    d["open_interest"]    = pd.to_numeric(df["OPEN_INT"],   errors="coerce").astype("Int64")
    d["change_in_oi"]     = pd.to_numeric(df["CHG_IN_OI"],  errors="coerce").astype("Int64")
    d["settlement_price"] = pd.to_numeric(df["SETTLE_PR"],  errors="coerce")
    d["underlying_price"] = None
    d["delivery_qty"]     = None
    d["delivery_pct"]     = None
    return d


# ── futures analytics: compute half (pure — safe in worker process) ─────────

def _compute_futures_rows(df: pd.DataFrame, trade_date: str) -> list[tuple]:
    """Builds futures_analytics rows from legacy columns. No underlying price
    and no lot size in this format, so basis/cost_of_carry/choi_volume_ratio
    are always NULL — everything else mirrors fo_bhavcopy.py's logic."""
    if df.empty:
        return []

    mem = duckdb.connect(":memory:")
    try:
        mem.register("_fut_stage", df)
        agg = mem.execute("""
            SELECT
                instrument_type,
                SYMBOL AS ticker,
                TRY_CAST(EXPIRY_DT AS DATE) AS expiry_raw,
                expiry_d,
                AVG(TRY_CAST(CLOSE AS DOUBLE)) AS close,
                SUM(TRY_CAST(CHG_IN_OI AS DOUBLE)) AS chng_in_oi,
                SUM(TRY_CAST(OPEN_INT  AS DOUBLE)) AS open_int
            FROM _fut_stage
            GROUP BY instrument_type, SYMBOL, TRY_CAST(EXPIRY_DT AS DATE), expiry_d
        """).df()
        mem.unregister("_fut_stage")
    finally:
        mem.close()

    if agg.empty:
        return []

    trade_dt = pd.to_datetime(trade_date)
    rows = []
    for _, r in agg.iterrows():
        close = r["close"]
        chng_in_oi, open_int = r["chng_in_oi"], r["open_int"]
        expiry = r["expiry_d"]
        dte = max((pd.to_datetime(expiry) - trade_dt).days, 0)

        # legacy has no prev_close column, so chng_in_price / chng_price_per
        # can't be derived either — both stay NULL, same as basis/coc
        chng_price   = None
        prev_oi      = open_int - chng_in_oi if (open_int is not None and chng_in_oi is not None) else None
        quadrant     = None  # depends on chng_price, unavailable in legacy
        chng_price_p = None
        chng_oi_p    = (chng_in_oi / prev_oi * 100) if prev_oi else None

        rows.append((
            str(r["instrument_type"]), str(r["ticker"]),
            expiry, pd.to_datetime(trade_date).date(),
            chng_price, chng_price_p, chng_oi_p,
            quadrant, None, None, None, dte,
        ))
    return rows


# ── options analytics: max pain (unchanged logic from fo_bhavcopy.py) ───────

def _max_pain(df: pd.DataFrame) -> dict:
    results = {}
    for key, g in df.groupby(["instrument_type", "SYMBOL", "EXPIRY_DT"]):
        ce = g[g["OPTION_TYP"] == "CE"].set_index("STRIKE_PR")["OPEN_INT"].fillna(0)
        pe = g[g["OPTION_TYP"] == "PE"].set_index("STRIKE_PR")["OPEN_INT"].fillna(0)
        strikes = np.array(sorted(set(ce.index) | set(pe.index)))
        if not len(strikes):
            results[key] = np.nan; continue
        ce_k, ce_oi = ce.index.to_numpy(), ce.to_numpy()
        pe_k, pe_oi = pe.index.to_numpy(), pe.to_numpy()
        pains = np.array([
            np.sum(np.maximum(0, s - ce_k) * ce_oi) +
            np.sum(np.maximum(0, pe_k - s) * pe_oi)
            for s in strikes
        ])
        results[key] = float(strikes[np.argmin(pains)])
    return results


# ── options analytics: compute half (pure — safe in worker process) ─────────

def _compute_options_rows(df: pd.DataFrame, trade_date: str) -> list[tuple]:
    if df.empty:
        return []

    mem = duckdb.connect(":memory:")
    try:
        mem.register("_opt_stage", df)
        pcr_df = mem.execute("""
            SELECT
                instrument_type, SYMBOL AS ticker,
                TRY_CAST(EXPIRY_DT AS DATE) AS expiry,
                TRY_CAST(TIMESTAMP AS DATE) AS trade_date,
                SUM(CASE WHEN OPTION_TYP='PE' THEN TRY_CAST(OPEN_INT AS DOUBLE) ELSE 0 END) AS pe_oi,
                SUM(CASE WHEN OPTION_TYP='CE' THEN TRY_CAST(OPEN_INT AS DOUBLE) ELSE 0 END) AS ce_oi,
            FROM _opt_stage
            GROUP BY instrument_type, SYMBOL, TRY_CAST(EXPIRY_DT AS DATE), TRY_CAST(TIMESTAMP AS DATE)
        """).df()

        mp_df = mem.execute("""
            SELECT instrument_type, SYMBOL, EXPIRY_DT,
                   TRY_CAST(STRIKE_PR AS DOUBLE) AS STRIKE_PR,
                   OPTION_TYP,
                   TRY_CAST(OPEN_INT  AS DOUBLE) AS OPEN_INT
            FROM _opt_stage
            WHERE STRIKE_PR IS NOT NULL AND OPEN_INT IS NOT NULL
        """).df()
        mem.unregister("_opt_stage")
    finally:
        mem.close()

    if pcr_df.empty:
        return []

    pcr_df["pcr"] = pcr_df.apply(
        lambda r: r["pe_oi"] / r["ce_oi"] if r["ce_oi"] else np.nan, axis=1
    )
    mp_map = _max_pain(mp_df)

    rows = []
    for _, r in pcr_df.iterrows():
        key = (r["instrument_type"], r["ticker"], str(pd.to_datetime(r["expiry"]).date()))
        mp  = mp_map.get(key, np.nan)
        rows.append((
            str(r["instrument_type"]), str(r["ticker"]),
            r["expiry"], r["trade_date"],
            r["pe_oi"], r["ce_oi"], r["pcr"],
            None if (isinstance(mp, float) and np.isnan(mp)) else mp,
        ))
    return rows


# ── top-level compute (worker-safe: no real DB connection anywhere) ─────────

def compute(trade_date: str) -> dict:
    """Pure compute for one trade_date, legacy format. No connection to the
    real DB file — safe to run inside a ProcessPoolExecutor worker."""
    raw = _load(trade_date)
    raw.columns = raw.columns.str.strip()

    fut_raw = raw[raw["INSTRUMENT"].isin(_LEGACY_FUT)].copy()
    opt_raw = raw[raw["INSTRUMENT"].isin(_LEGACY_OPT)].copy()

    fut_raw, fut_instr = _build_instruments(fut_raw)
    opt_raw, opt_instr = _build_instruments(opt_raw)
    all_instr = pd.concat([fut_instr, opt_instr]).drop_duplicates("instrument_key")

    fut_mdd = _build_market_data(fut_raw) if not fut_raw.empty else pd.DataFrame()
    opt_mdd = _build_market_data(opt_raw) if not opt_raw.empty else pd.DataFrame()
    all_mdd = pd.concat([fut_mdd, opt_mdd])

    fut_rows = _compute_futures_rows(fut_raw, trade_date) if not fut_raw.empty else []
    opt_rows = _compute_options_rows(opt_raw, trade_date) if not opt_raw.empty else []

    return {
        "trade_date":    trade_date,
        "instruments":   all_instr,
        "market_data":   all_mdd,
        "futures_rows":  fut_rows,
        "options_rows":  opt_rows,
        "fut_row_count": len(fut_raw),
        "opt_row_count": len(opt_raw),
    }


# ── top-level write (must run on the single writer connection) ──────────────

def write(conn: duckdb.DuckDBPyConnection, result: dict, trade_date: str):
    """Persists a `compute()` result. Caller owns the transaction."""
    if not result["instruments"].empty:
        upsert_instruments(conn, result["instruments"])
    if not result["market_data"].empty:
        upsert_market_data(conn, result["market_data"])
    _write_futures_rows(conn, result["futures_rows"])
    _write_options_rows(conn, result["options_rows"])
    print(f"[fo_legacy] {trade_date} — {result['fut_row_count']} fut rows, {result['opt_row_count']} opt rows")


# ── entry point (sequential) ─────────────────────────────────────────────────

def process(trade_date: str):
    if is_processed(trade_date, "STF") and is_processed(trade_date, "STO"):
        print(f"[fo_legacy] {trade_date} already processed, skipping")
        return

    result = compute(trade_date)

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        write(conn, result, trade_date)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
"""
FO bhavcopy processor
→ instruments, market_data_daily, options_analytics, futures_analytics

NOTE: SctySrs is not reliable for F&O contracts (mostly blank/'XX'), unlike
CM where it's meaningful (EQ, BE, SM, etc.). `series` is therefore always
written as NULL for F&O instruments and is NOT part of the identity key —
this must stay consistent with fo_contracts.py, which also passes None for
series when generating instrument_key.

── Compute/write split ──────────────────────────────────────────────────────
This module is used two ways:

1. Sequential (unchanged behavior): `process(trade_date)` — does everything
   in one call, one connection, one transaction. Used by startup_sync.py
   for live daily updates. Nothing about this path has changed.

2. Parallel backfill: worker processes call `compute(trade_date)` — pure
   pandas/numpy/in-memory-duckdb work, NO connection to the real DB file,
   returns a dict of DataFrames/row-lists. A single writer process then
   calls `write(conn, result, trade_date)` inside its own transaction.
   `process()` is implemented as `write(conn, compute(trade_date), trade_date)`
   internally, so both paths run identical logic — no drift between them.
"""

import numpy as np
import pandas as pd
import duckdb
from pathlib import Path

from config import FO_RAW_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments, upsert_market_data


_FUT = {"STF", "IDF"}
_OPT = {"STO", "IDO"}
_QUADRANT = {
    (True,  True):  "long_buildup",
    (False, True):  "short_covering",
    (True,  False): "short_buildup",
    (False, False): "long_unwinding",
}


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_RAW_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def _load(trade_date: str) -> pd.DataFrame:
    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)
    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()
    return df


def _drop_blank_rows(df: pd.DataFrame) -> pd.DataFrame:
    """
    Drops placeholder/stale rows — identified by blank TckrSymb and blank
    FinInstrmNm together. Mirrors the guard in fo_contracts.py.
    """
    df = df.copy()
    df["TckrSymb"]    = df["TckrSymb"].astype("string").str.strip()
    df["FinInstrmNm"] = df["FinInstrmNm"].astype("string").str.strip()

    mask = (df["TckrSymb"].notna() & (df["TckrSymb"] != "")) | \
           (df["FinInstrmNm"].notna() & (df["FinInstrmNm"] != ""))

    dropped = len(df) - mask.sum()
    if dropped:
        print(f"[fo] dropping {dropped} blank/placeholder rows")

    return df[mask].copy()


# ── instrument key generation ─────────────────────────────────────────────────

def _build_instruments(df: pd.DataFrame) -> pd.DataFrame:
    df = _drop_blank_rows(df)

    empty_instr_cols = [
        "instrument_key", "exchange", "segment", "instrument_id",
        "instrument_type", "ticker", "instrument_name",
        "isin", "series", "expiry", "strike", "option_type",
    ]
    if df.empty:
        return df, pd.DataFrame(columns=empty_instr_cols)

    df["expiry_d"] = pd.to_datetime(
        df["XpryDt"], format="%Y-%m-%d", errors="coerce"
    ).dt.date

    df["act_exp_d"] = pd.to_datetime(
        df["FininstrmActlXpryDt"], format="%Y-%m-%d", errors="coerce"
    ).dt.date
    df["strike_f"] = pd.to_numeric(df["StrkPric"], errors="coerce")
    df["lot_i"]    = pd.to_numeric(df["NewBrdLotQty"], errors="coerce").astype("Int64")

    # series is not part of the identity key for F&O — SctySrs is unreliable
    # and must stay consistent with fo_contracts.py, which also passes None.
    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["FinInstrmTp"], r["TckrSymb"],
        r["expiry_d"], r["strike_f"],
        r.get("OptnTp"), None,
    ), axis=1)

    instr = df[[
        "instrument_key", "Sgmt", "FinInstrmId", "FinInstrmTp",
        "TckrSymb", "FinInstrmNm", "ISIN",
        "expiry_d", "strike_f", "OptnTp",
    ]].drop_duplicates("instrument_key").copy()

    instr.columns = [
        "instrument_key", "segment", "instrument_id", "instrument_type",
        "ticker", "instrument_name", "isin",
        "expiry", "strike", "option_type",
    ]
    instr.insert(1, "exchange", "NSE")
    instr["series"] = None  # not meaningful for F&O — always NULL

    instr["instrument_id"] = pd.to_numeric(instr["instrument_id"], errors="coerce").astype("Int64")

    # column order MUST match `instruments` table exactly — upsert is positional
    instr = instr[empty_instr_cols]
    return df, instr


def _build_market_data(df: pd.DataFrame) -> pd.DataFrame:
    d = pd.DataFrame()
    d["trade_date"]      = pd.to_datetime(df["TradDt"], format="%Y-%m-%d", errors="coerce").dt.date
    d["instrument_key"]  = df["instrument_key"]
    d["open"]            = pd.to_numeric(df["OpnPric"],        errors="coerce")
    d["high"]            = pd.to_numeric(df["HghPric"],        errors="coerce")
    d["low"]             = pd.to_numeric(df["LwPric"],         errors="coerce")
    d["close"]           = pd.to_numeric(df["ClsPric"],        errors="coerce")
    d["last"]            = pd.to_numeric(df["LastPric"],       errors="coerce")
    d["prev_close"]      = pd.to_numeric(df["PrvsClsgPric"],   errors="coerce")
    d["avg_price"]       = None
    d["volume"]          = pd.to_numeric(df["TtlTradgVol"],    errors="coerce").astype("Int64")
    d["turnover"]        = pd.to_numeric(df["TtlTrfVal"],      errors="coerce")
    d["trade_count"]     = pd.to_numeric(df["TtlNbOfTxsExctd"],errors="coerce").astype("Int64")
    d["open_interest"]   = pd.to_numeric(df["OpnIntrst"],      errors="coerce").astype("Int64")
    d["change_in_oi"]    = pd.to_numeric(df["ChngInOpnIntrst"],errors="coerce").astype("Int64")
    d["settlement_price"]= pd.to_numeric(df["SttlmPric"],      errors="coerce")
    d["underlying_price"]= pd.to_numeric(df["UndrlygPric"],    errors="coerce")
    d["delivery_qty"]    = None
    d["delivery_pct"]    = None
    return d


# ── futures analytics: compute half (pure — safe in worker process) ──────────

def _compute_futures_rows(df: pd.DataFrame, trade_date: str) -> list[tuple]:
    """Builds futures_analytics rows. Uses an in-memory DuckDB connection only
    (for the groupby aggregation) — never touches the real DB file. Safe to
    call from a ProcessPoolExecutor worker."""
    if df.empty:
        return []

    mem = duckdb.connect(":memory:")
    try:
        mem.register("_fut_stage", df)
        agg = mem.execute("""
            SELECT
                FinInstrmTp AS instrument_type,
                TckrSymb    AS ticker,
                TRY_CAST(XpryDt AS DATE) AS expiry,
                AVG(TRY_CAST(ClsPric        AS DOUBLE)) AS close,
                AVG(TRY_CAST(PrvsClsgPric   AS DOUBLE)) AS prev_close,
                AVG(TRY_CAST(UndrlygPric    AS DOUBLE)) AS underlying,
                SUM(TRY_CAST(ChngInOpnIntrst AS DOUBLE)) AS chng_in_oi,
                SUM(TRY_CAST(TtlTradgVol    AS DOUBLE)) AS volume,
                SUM(TRY_CAST(OpnIntrst      AS DOUBLE)) AS open_int,
                MAX(TRY_CAST(NewBrdLotQty   AS DOUBLE)) AS lot_size
            FROM _fut_stage
            GROUP BY FinInstrmTp, TckrSymb, TRY_CAST(XpryDt AS DATE)
        """).df()
        mem.unregister("_fut_stage")
    finally:
        mem.close()

    if agg.empty:
        return []

    trade_dt = pd.to_datetime(trade_date)
    rows = []
    for _, r in agg.iterrows():
        close, prev_close = r["close"], r["prev_close"]
        underlying = r["underlying"]
        chng_in_oi, open_int, volume, lot_size = r["chng_in_oi"], r["open_int"], r["volume"], r["lot_size"]
        expiry = r["expiry"]
        dte = max((pd.to_datetime(expiry) - trade_dt).days, 0)
        chng_price    = close - prev_close if (close and prev_close) else None
        prev_oi       = open_int - chng_in_oi if (open_int and chng_in_oi) else None
        basis         = close - underlying if (close and underlying) else None
        coc           = (basis / underlying) * (365 / dte) if (underlying and dte) else None
        actual_volume = volume * lot_size if (volume and lot_size) else None
        choivr        = chng_in_oi / actual_volume if actual_volume else None
        quadrant      = _QUADRANT[(chng_in_oi >= 0, chng_price >= 0)] if (chng_in_oi is not None and chng_price is not None) else None
        chng_price_p  = (chng_price / prev_close * 100) if prev_close else None
        chng_oi_p     = (chng_in_oi / prev_oi * 100) if prev_oi else None

        rows.append((
            str(r["instrument_type"]), str(r["ticker"]),
            expiry, pd.to_datetime(trade_date).date(),
            chng_price, chng_price_p, chng_oi_p,
            quadrant, basis, coc, choivr, dte,
        ))
    return rows


# ── futures analytics: write half (must run on the single writer conn) ──────

def _write_futures_rows(conn: duckdb.DuckDBPyConnection, rows: list[tuple]):
    if not rows:
        return
    conn.executemany("""
        INSERT INTO futures_analytics VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (instrument_type, ticker, expiry, trade_date) DO UPDATE SET
            chng_in_price=excluded.chng_in_price, chng_price_per=excluded.chng_price_per,
            chng_oi_per=excluded.chng_oi_per, quadrant=excluded.quadrant,
            basis=excluded.basis, cost_of_carry=excluded.cost_of_carry,
            choi_volume_ratio=excluded.choi_volume_ratio, days_to_expiry=excluded.days_to_expiry
    """, rows)


# ── options analytics: max pain (unchanged from original) ───────────────────

def _max_pain(df: pd.DataFrame) -> dict:
    results = {}
    for key, g in df.groupby(["FinInstrmTp", "TckrSymb", "XpryDt"]):
        ce = g[g["OptnTp"] == "CE"].set_index("StrkPric")["OpnIntrst"].fillna(0)
        pe = g[g["OptnTp"] == "PE"].set_index("StrkPric")["OpnIntrst"].fillna(0)
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
    """Builds options_analytics rows. Uses an in-memory DuckDB connection only
    for the PCR aggregation — never touches the real DB file. Safe to call
    from a ProcessPoolExecutor worker."""
    if df.empty:
        return []

    mem = duckdb.connect(":memory:")
    try:
        mem.register("_opt_stage", df)
        pcr_df = mem.execute("""
            SELECT
                FinInstrmTp AS instrument_type, TckrSymb AS ticker,
                TRY_CAST(XpryDt AS DATE) AS expiry,
                TRY_CAST(TradDt AS DATE) AS trade_date,
                SUM(CASE WHEN OptnTp='PE' THEN TRY_CAST(OpnIntrst AS DOUBLE) ELSE 0 END) AS pe_oi,
                SUM(CASE WHEN OptnTp='CE' THEN TRY_CAST(OpnIntrst AS DOUBLE) ELSE 0 END) AS ce_oi,
            FROM _opt_stage
            GROUP BY FinInstrmTp, TckrSymb, TRY_CAST(XpryDt AS DATE), TRY_CAST(TradDt AS DATE)
        """).df()

        mp_df = mem.execute("""
            SELECT FinInstrmTp, TckrSymb, XpryDt,
                   TRY_CAST(StrkPric  AS DOUBLE) AS StrkPric,
                   OptnTp,
                   TRY_CAST(OpnIntrst AS DOUBLE) AS OpnIntrst
            FROM _opt_stage
            WHERE StrkPric IS NOT NULL AND OpnIntrst IS NOT NULL
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


# ── options analytics: write half (must run on the single writer conn) ──────

def _write_options_rows(conn: duckdb.DuckDBPyConnection, rows: list[tuple]):
    if not rows:
        return
    conn.executemany("""
        INSERT INTO options_analytics VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT (instrument_type, ticker, expiry, trade_date) DO UPDATE SET
            pe_oi=excluded.pe_oi, ce_oi=excluded.ce_oi, pcr=excluded.pcr,
            max_pain=excluded.max_pain
    """, rows)


# ── top-level compute (worker-safe: no real DB connection anywhere) ─────────

def compute(trade_date: str) -> dict:
    """
    Pure compute for one trade_date. No connection to the real DB file —
    safe to run inside a ProcessPoolExecutor worker. Returns everything
    `write()` needs to persist the result.
    """
    raw = _load(trade_date)
    raw.columns = raw.columns.str.strip()

    fut_raw = raw[raw["FinInstrmTp"].isin(_FUT)].copy()
    opt_raw = raw[raw["FinInstrmTp"].isin(_OPT)].copy()

    # instrument keys (blank/placeholder rows filtered inside _build_instruments)
    fut_raw, fut_instr = _build_instruments(fut_raw)
    opt_raw, opt_instr = _build_instruments(opt_raw)
    all_instr = pd.concat([fut_instr, opt_instr]).drop_duplicates("instrument_key")

    fut_mdd = _build_market_data(fut_raw) if not fut_raw.empty else pd.DataFrame()
    opt_mdd = _build_market_data(opt_raw) if not opt_raw.empty else pd.DataFrame()
    all_mdd = pd.concat([fut_mdd, opt_mdd])

    fut_rows = _compute_futures_rows(fut_raw, trade_date) if not fut_raw.empty else []
    opt_rows = _compute_options_rows(opt_raw, trade_date) if not opt_raw.empty else []

    return {
        "trade_date":   trade_date,
        "instruments":  all_instr,
        "market_data":  all_mdd,
        "futures_rows": fut_rows,
        "options_rows": opt_rows,
        "fut_row_count": len(fut_raw),
        "opt_row_count": len(opt_raw),
    }


# ── top-level write (must run on the single writer connection) ──────────────

def write(conn: duckdb.DuckDBPyConnection, result: dict, trade_date: str):
    """
    Persists a `compute()` result. Caller owns the transaction (BEGIN/COMMIT/
    ROLLBACK) — this function just issues the inserts, same as the original
    inline logic in process().
    """
    if not result["instruments"].empty:
        upsert_instruments(conn, result["instruments"])
    if not result["market_data"].empty:
        upsert_market_data(conn, result["market_data"])
    _write_futures_rows(conn, result["futures_rows"])
    _write_options_rows(conn, result["options_rows"])
    print(f"[fo] {trade_date} — {result['fut_row_count']} fut rows, {result['opt_row_count']} opt rows")


# ── entry point (sequential — unchanged behavior for startup_sync.py) ───────

def process(trade_date: str):
    if is_processed(trade_date, "STF") and is_processed(trade_date, "STO"):
        print(f"[fo] {trade_date} already processed, skipping")
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
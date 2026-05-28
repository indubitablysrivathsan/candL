"""
fo_volatility processor — FOVOLT_DDMMYYYY.csv
→ fo_volatility

Each row gives underlying + futures EWMA volatility for one symbol on one date.
We resolve instrument_key by joining against the instruments table:
  - instrument_type IN ('STF', 'IDF')   (futures, since vol is anchored to futures)
  - ticker = symbol
  - expiry = nearest expiry >= trade_date  (front-month contract)
If a symbol has no active futures contract in instruments, the row is skipped
with a warning.
"""

import re
import pandas as pd
from pathlib import Path

from config import FO_VOLT_ROOT
from api.db import get_conn, is_processed


# ── Path helper ───────────────────────────────────────────────────────────────

def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    fname = f"FOVOLT_{dt.strftime('%d%m%Y')}.csv"
    return Path(FO_VOLT_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / fname


# ── Column name normaliser ────────────────────────────────────────────────────
# Raw headers contain spaces, parentheses, formula descriptions — strip to
# something stable we can reference by position anyway, but keep for safety.

_COL_MAP = {
    # position → canonical name  (0-based, after the Date + Symbol columns)
    2:  "underlying_close",
    3:  "underlying_prev_close",
    4:  "underlying_log_return",
    5:  "underlying_prev_vol",
    6:  "underlying_daily_vol",
    7:  "underlying_annual_vol",
    8:  "futures_close",
    9:  "futures_prev_close",
    10: "futures_log_return",
    11: "futures_prev_vol",
    12: "futures_daily_vol",
    13: "futures_annual_vol",
    14: "applicable_daily_vol",
    15: "applicable_annual_vol",
}


# ── Parser ────────────────────────────────────────────────────────────────────

def _parse(path: Path, trade_date: str) -> pd.DataFrame:
    raw = pd.read_csv(path, header=0)

    # Normalise column names so we can work by name safely
    cols = list(raw.columns)
    rename = {}
    rename[cols[0]] = "date_str"
    rename[cols[1]] = "symbol"
    for pos, canonical in _COL_MAP.items():
        if pos < len(cols):
            rename[cols[pos]] = canonical
    raw = raw.rename(columns=rename)

    # Drop rows where symbol is blank / NaN
    raw = raw[raw["symbol"].notna() & (raw["symbol"].astype(str).str.strip() != "")]
    raw["symbol"] = raw["symbol"].astype(str).str.strip().str.upper()

    # Keep only the columns we need
    keep = ["symbol"] + list(_COL_MAP.values())
    raw = raw[[c for c in keep if c in raw.columns]].copy()

    raw["trade_date"] = trade_date
    return raw


# ── instrument_key resolver ───────────────────────────────────────────────────

def _resolve_keys(conn, df: pd.DataFrame, trade_date: str) -> pd.DataFrame:
    """
    For each symbol, find the front-month futures instrument_key.
    Returns df with instrument_key column; unresolved rows are dropped.
    """
    # Pull all futures for these symbols that expire on or after trade_date
    symbols = df["symbol"].unique().tolist()
    placeholders = ", ".join("?" * len(symbols))
    rows = conn.execute(f"""
        SELECT ticker, instrument_key, expiry
        FROM instruments
        WHERE instrument_type IN ('STF', 'IDF')
          AND ticker IN ({placeholders})
          AND expiry >= CAST(? AS DATE)
          AND is_active = TRUE
        ORDER BY ticker, expiry
    """, symbols + [trade_date]).fetchall()

    # Pick front-month (smallest expiry) per ticker
    front = {}
    for ticker, ikey, expiry in rows:
        if ticker not in front:
            front[ticker] = ikey   # already ordered ASC by expiry

    missing = set(df["symbol"].unique()) - set(front.keys())
    if missing:
        print(f"[fo_volt] WARNING — no futures contract found for: {sorted(missing)}")

    df["instrument_key"] = df["symbol"].map(front)
    return df[df["instrument_key"].notna()].copy()


# ── Processor ─────────────────────────────────────────────────────────────────

def process(trade_date: str):
    if is_processed(trade_date, "fo_volt"):
        print(f"[fo_volt] {trade_date} already processed, skipping")
        return

    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = _parse(p, trade_date)
    if df.empty:
        print(f"[fo_volt] {trade_date} — no rows parsed")
        return

    conn = get_conn()
    try:
        conn.execute("BEGIN")

        df = _resolve_keys(conn, df, trade_date)
        if df.empty:
            print(f"[fo_volt] {trade_date} — no rows after key resolution")
            conn.execute("ROLLBACK")
            return

        # Build the exact staging frame the table expects
        stage = df[[
            "trade_date",
            "instrument_key",
            "underlying_log_return",
            "underlying_daily_vol",
            "underlying_annual_vol",
            "futures_log_return",
            "futures_daily_vol",
            "futures_annual_vol",
            "applicable_daily_vol",
            "applicable_annual_vol",
        ]].copy()

        # Coerce types
        stage["trade_date"]     = pd.to_datetime(stage["trade_date"]).dt.date
        stage["instrument_key"] = stage["instrument_key"].astype("int64")
        float_cols = [
            "underlying_log_return", "underlying_daily_vol", "underlying_annual_vol",
            "futures_log_return",    "futures_daily_vol",    "futures_annual_vol",
            "applicable_daily_vol",  "applicable_annual_vol",
        ]
        for c in float_cols:
            stage[c] = pd.to_numeric(stage[c], errors="coerce")

        conn.register("_fovolt_stage", stage)
        conn.execute("""
            INSERT INTO fo_volatility
            SELECT
                CAST(trade_date AS DATE),
                instrument_key,
                underlying_log_return,
                underlying_daily_vol,
                underlying_annual_vol,
                futures_log_return,
                futures_daily_vol,
                futures_annual_vol,
                applicable_daily_vol,
                applicable_annual_vol
            FROM _fovolt_stage
            ON CONFLICT (trade_date, instrument_key) DO UPDATE SET
                underlying_log_return  = excluded.underlying_log_return,
                underlying_daily_vol   = excluded.underlying_daily_vol,
                underlying_annual_vol  = excluded.underlying_annual_vol,
                futures_log_return     = excluded.futures_log_return,
                futures_daily_vol      = excluded.futures_daily_vol,
                futures_annual_vol     = excluded.futures_annual_vol,
                applicable_daily_vol   = excluded.applicable_daily_vol,
                applicable_annual_vol  = excluded.applicable_annual_vol
        """)
        conn.unregister("_fovolt_stage")
        conn.execute("COMMIT")
        print(f"[fo_volt] {trade_date} — {len(stage)} rows inserted/updated")

    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
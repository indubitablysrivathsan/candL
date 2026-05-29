"""
fo_volatility processor — FOVOLT_DDMMYYYY.csv
→ fo_volatility

Volatility is reported by NSE at the underlying symbol level, not per contract.
A single row covers RELIANCE (the underlying), not RELIANCE26MAYFUT or
RELIANCE26JUNFUT.  Keying by instrument_key would require picking one contract
arbitrarily and that mapping flips at every expiry rollover — wrong for research.

Primary key: (trade_date, ticker)   — exactly what the source data describes.
No instrument_key, no instruments join.
"""

import pandas as pd
from pathlib import Path

from config import FO_VOLT_ROOT
from api.db import get_conn, is_processed


# ── Path helper ───────────────────────────────────────────────────────────────

def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_VOLT_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


# ── Column positions → canonical names ───────────────────────────────────────
# NSE headers are verbose formula strings; map by position to avoid fragility.

_COL_MAP = {
    0:  "date_str",
    1:  "ticker",
    2:  "underlying_close",
    3:  "underlying_prev_close",
    4:  "underlying_log_return",
    5:  "prev_underlying_vol",
    6:  "underlying_daily_vol",
    7:  "underlying_annual_vol",
    8:  "futures_close",
    9:  "futures_prev_close",
    10: "futures_log_return",
    11: "prev_futures_vol",
    12: "futures_daily_vol",
    13: "futures_annual_vol",
    14: "applicable_daily_vol",
    15: "applicable_annual_vol",
}

# Columns written to the DB (everything except the raw date string)
_DB_COLS = [
    "trade_date",
    "ticker",

    "underlying_log_return",
    "underlying_daily_vol",
    "underlying_annual_vol",

    "futures_log_return",
    "futures_daily_vol",
    "futures_annual_vol",

    "applicable_daily_vol",
    "applicable_annual_vol",
]
_FLOAT_COLS = _DB_COLS[2:]   # everything after trade_date + ticker


# ── Parser ────────────────────────────────────────────────────────────────────

def _parse(path: Path, trade_date: str) -> pd.DataFrame:
    raw = pd.read_csv(path, header=0)

    # Rename by position — header text is unreliable across NSE releases
    cols = list(raw.columns)
    rename = {cols[i]: name for i, name in _COL_MAP.items() if i < len(cols)}
    raw = raw.rename(columns=rename)

    # Drop blank / header-repeat rows
    raw = raw[raw["ticker"].notna() & (raw["ticker"].astype(str).str.strip() != "")]
    raw["ticker"] = raw["ticker"].astype(str).str.strip().str.upper()

    # Coerce numeric columns
    for c in _FLOAT_COLS:
        if c in raw.columns:
            raw[c] = pd.to_numeric(raw[c], errors="coerce")

    raw["trade_date"] = pd.to_datetime(trade_date).date()

    return raw[[c for c in _DB_COLS if c in raw.columns]].copy()


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
        conn.register("_fovolt_stage", df)
        conn.execute(f"""
            INSERT INTO fo_volatility ({", ".join(_DB_COLS)})
            SELECT {", ".join(_DB_COLS)}
            FROM _fovolt_stage
            ON CONFLICT (trade_date, ticker) DO UPDATE SET
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
        print(f"[fo_volt] {trade_date} — {len(df)} rows inserted/updated")

    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
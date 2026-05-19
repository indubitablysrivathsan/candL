"""
NSE Platform — DuckDB query layer
===================================
All data access goes through this module.
FastAPI routes call these functions; nothing else touches the filesystem.
"""

import duckdb
import pandas as pd
from pathlib import Path
from typing import Optional
from config import (
    DUCKDB_PATH,
    OPTIONS_ROOT,
    FUTURES_ROOT,
    STOCKS_ROOT,
    INDEXES_ROOT,
)

# ── Connection ────────────────────────────────────────────────────────────────

def get_conn() -> duckdb.DuckDBPyConnection:
    """Return a DuckDB connection.  In-memory = a new connection each call.
    If DUCKDB_PATH is a file, connections share the on-disk cache."""
    return duckdb.connect(DUCKDB_PATH)


# ── Root resolver ─────────────────────────────────────────────────────────────

ASSET_ROOTS = {
    "options": OPTIONS_ROOT,
    "futures": FUTURES_ROOT,
    "stocks":  STOCKS_ROOT,
    "indexes": INDEXES_ROOT,
}

def asset_root(asset_type: str) -> Path:
    root = ASSET_ROOTS.get(asset_type)
    if root is None:
        raise ValueError(f"Unknown asset type: {asset_type}")
    return root


# ── Ticker / expiry discovery (pure filesystem) ───────────────────────────────

def list_tickers(asset_type: str) -> list[str]:
    root = asset_root(asset_type)
    if not root.exists():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def list_expiries(asset_type: str, ticker: str) -> list[str]:
    """For assets that have expiries (options, futures)."""
    base = asset_root(asset_type) / ticker
    if not base.exists():
        return []
    return sorted(p.name for p in base.iterdir() if p.is_dir())


# ── Options helpers ───────────────────────────────────────────────────────────

def _options_data_glob(ticker: str, expiry: str) -> str:
    """Return a DuckDB-compatible glob string for day-wise CSVs."""
    path = OPTIONS_ROOT / ticker / expiry / "DATA" / "*.csv"
    # DuckDB on Windows needs forward slashes
    return str(path).replace("\\", "/")


def get_options_data(
    ticker: str,
    expiry: str,
    start_date: str,       # "YYYY-MM-DD"
    end_date: str,         # "YYYY-MM-DD"
) -> pd.DataFrame:
    """
    Load all day-wise CSVs for a ticker+expiry, filter by date range.
    Returns a DataFrame with an added `trade_date` column (DATE type).
    """

    glob = _options_data_glob(ticker, expiry)
    conn = get_conn()
    try:
        df = conn.execute(f"""
            SELECT
                *,

                CAST(
                    regexp_extract(
                        filename,
                        '(\\d{{4}}-\\d{{2}}-\\d{{2}})\\.csv',
                        1
                    ) AS DATE
                ) AS trade_date

            FROM read_csv_auto(
                '{glob}',
                filename = true,
                ignore_errors = true
            )

            WHERE
                CAST(
                    regexp_extract(
                        filename,
                        '(\\d{{4}}-\\d{{2}}-\\d{{2}})\\.csv',
                        1
                    ) AS DATE
                )
                BETWEEN DATE '{start_date}'
                AND DATE '{end_date}'
        """).df()
    finally:
        conn.close()

    # Ensure numeric columns
    for col in ["StrkPric", "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol",
                "UndrlygPric"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    return df


def get_options_analytics(
    ticker: str,
    expiry: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Load analytics.csv for a ticker+expiry, filtered by date range."""
    path = OPTIONS_ROOT / ticker / expiry / "analytics.csv"
    if not path.exists():
        return pd.DataFrame()

    path_str = str(path).replace("\\", "/")
    conn = get_conn()
    try:
        df = conn.execute(f"""
            SELECT *
            FROM read_csv_auto('{path_str}', ignore_errors = true)
            WHERE CAST(trade_date AS DATE)
                  BETWEEN DATE '{start_date}' AND DATE '{end_date}'
            ORDER BY trade_date
        """).df()
    finally:
        conn.close()

    df["trade_date"] = pd.to_datetime(df["trade_date"], errors="coerce")
    return df.dropna(subset=["trade_date"])


def get_options_analytics_full(ticker: str, expiry: str) -> pd.DataFrame:
    """Load the complete analytics.csv with no date filter (for time-series view)."""
    path = OPTIONS_ROOT / ticker / expiry / "analytics.csv"
    if not path.exists():
        return pd.DataFrame()

    path_str = str(path).replace("\\", "/")
    conn = get_conn()
    try:
        df = conn.execute(f"""
            SELECT *
            FROM read_csv_auto('{path_str}', ignore_errors = true)
            ORDER BY trade_date
        """).df()
    finally:
        conn.close()

    df["trade_date"] = pd.to_datetime(df["trade_date"], errors="coerce")
    return df.dropna(subset=["trade_date"])


# ── Available date range for an expiry ───────────────────────────────────────

def get_available_dates(asset_type: str, ticker: str, expiry: str) -> list[str]:
    """
    Return sorted list of dates (YYYY-MM-DD strings) that have data files.
    Works by listing DATA/ directory — no DuckDB needed, very fast.
    """
    if asset_type in ("options", "futures"):
        data_dir = asset_root(asset_type) / ticker / expiry / "DATA"
    else:
        data_dir = asset_root(asset_type) / ticker / "DATA"

    if not data_dir.exists():
        return []

    dates = []
    for f in sorted(data_dir.iterdir()):
        if f.suffix == ".csv":
            stem = f.stem  # "2026-01-01"
            try:
                pd.to_datetime(stem)   # validate
                dates.append(stem)
            except Exception:
                pass
    return dates


# ── Chart axis scale ──────────────────────────────────────────────────────────

def get_chart_scale(
    ticker:     str,
    expiry:     str,
    start_date: str,
    end_date:   str,
    metric:     str,
) -> dict:
    """
    Returns y_min, y_max, x_min, x_max, strike_gap across all strikes and
    dates in the range, excluding zero-value rows so ghost strikes don't
    pollute the x axis.
    """
    METRIC_COL = {
        "oi":      "OpnIntrst",
        "oi_chng": "ChngInOpnIntrst",
        "vol":     "TtlTradgVol",
    }
    col = METRIC_COL.get(metric)
    if col is None:
        return {
            "y_min": 0.0, "y_max": 1.0,
            "x_min": 0.0, "x_max": 0.0,
            "strike_gap": 50.0,
        }

    glob = _options_data_glob(ticker, expiry)
    date_filter = f"""
        CAST(
            regexp_extract(
                filename,
                '(\\d{{4}}-\\d{{2}}-\\d{{2}})\\.csv',
                1
            ) AS DATE
        ) BETWEEN DATE '{start_date}' AND DATE '{end_date}'
    """

    conn = get_conn()
    try:
        # y and x min/max — only rows where the metric is non-zero
        minmax_row = conn.execute(f"""
            SELECT
                MIN(CAST("{col}"      AS DOUBLE)) AS y_min,
                MAX(CAST("{col}"      AS DOUBLE)) AS y_max,
                MIN(CAST("StrkPric"   AS DOUBLE)) AS x_min,
                MAX(CAST("StrkPric"   AS DOUBLE)) AS x_max
            FROM read_csv_auto(
                '{glob}',
                filename      = true,
                ignore_errors = true
            )
            WHERE
                {date_filter}
                AND CAST("{col}" AS DOUBLE) != 0
        """).fetchone()

        # Most common gap between adjacent distinct strikes (= base tick unit)
        gap_row = conn.execute(f"""
            WITH strikes AS (
                SELECT DISTINCT CAST("StrkPric" AS DOUBLE) AS s
                FROM read_csv_auto(
                    '{glob}',
                    filename      = true,
                    ignore_errors = true
                )
                WHERE
                    {date_filter}
                    AND CAST("{col}" AS DOUBLE) != 0
                ORDER BY s
            ),
            diffs AS (
                SELECT ROUND(LEAD(s) OVER (ORDER BY s) - s) AS gap
                FROM strikes
            )
            SELECT gap
            FROM diffs
            WHERE gap > 0
            GROUP BY gap
            ORDER BY COUNT(*) DESC
            LIMIT 1
        """).fetchone()

    finally:
        conn.close()

    y_raw_min  = float(minmax_row[0]) if minmax_row[0] is not None else 0.0
    y_raw_max  = float(minmax_row[1]) if minmax_row[1] is not None else 1.0
    x_min      = float(minmax_row[2]) if minmax_row[2] is not None else 0.0
    x_max      = float(minmax_row[3]) if minmax_row[3] is not None else 0.0
    strike_gap = float(gap_row[0])    if gap_row and gap_row[0] else 50.0

    y_pad = max(abs(y_raw_min), abs(y_raw_max)) * 0.08
    y_min = y_raw_min - y_pad
    y_max = y_raw_max + y_pad

    return {
        "y_min":      y_min,
        "y_max":      y_max,
        "x_min":      x_min,
        "x_max":      x_max,
        "strike_gap": strike_gap,
    }


# ── Futures helpers (stub — ready to fill when pipeline is built) ─────────────

def get_futures_data(
    ticker: str,
    expiry: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    glob = str(FUTURES_ROOT / ticker / expiry / "DATA" / "*.csv").replace("\\", "/")
    conn = get_conn()
    try:
        df = conn.execute(f"""
            SELECT *,
                CAST(
                    regexp_extract(filename, '(\\d{{4}}-\\d{{2}}-\\d{{2}})', 1)
                    AS DATE
                ) AS trade_date
            FROM read_csv_auto('{glob}', filename=true, ignore_errors=true)
            WHERE CAST(
                    regexp_extract(filename, '(\\d{{4}}-\\d{{2}}-\\d{{2}})', 1)
                    AS DATE
                  ) BETWEEN DATE '{start_date}' AND DATE '{end_date}'
        """).df()
    finally:
        conn.close()
    return df


# ── Stock / Index helpers (stub) ──────────────────────────────────────────────

def get_stock_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    glob = str(STOCKS_ROOT / ticker / "DATA" / "*.csv").replace("\\", "/")
    conn = get_conn()
    try:
        df = conn.execute(f"""
            SELECT *,
                CAST(
                    regexp_extract(filename, '(\\d{{4}}-\\d{{2}}-\\d{{2}})', 1)
                    AS DATE
                ) AS trade_date
            FROM read_csv_auto('{glob}', filename=true, ignore_errors=true)
            WHERE CAST(
                    regexp_extract(filename, '(\\d{{4}}-\\d{{2}}-\\d{{2}})', 1)
                    AS DATE
                  ) BETWEEN DATE '{start_date}' AND DATE '{end_date}'
        """).df()
    finally:
        conn.close()
    return df
"""
NSE Platform — DuckDB query layer
===================================
All data access goes through this module.
FastAPI routes call these functions; nothing else touches the filesystem.

Asset types
-----------
  "futures"        → STF contracts  (data/futures/)
  "index_futures"  → IDF contracts  (data/index_futures/)
  "options"        → STO contracts  (data/options/)
  "index_options"  → IDO contracts  (data/index_options/)

Connection strategy
-------------------
get_conn()          — in-memory DuckDB, one per request, used for ad-hoc CSV
                      scanning (options data, analytics, chart scale).
_rollup_read_conn() — read-only connection to the persistent rollup.db file.
                      Used by the futures rollup helpers.
                      The file is written exclusively by the ingestion pipeline
                      so no concurrent-writer issue exists on this local
                      single-process setup.
"""

import duckdb
import numpy as np
import pandas as pd
from pathlib import Path

from config import (
    DUCKDB_PATH,
    ROLLUP_DB_PATH,

    OPTIONS_ROOT,
    INDEX_OPTIONS_ROOT,

    FUTURES_ROOT,
    INDEX_FUTURES_ROOT,

    STOCKS_ROOT,
)


# ── Connection helpers ────────────────────────────────────────────────────────

def get_conn() -> duckdb.DuckDBPyConnection:
    """Fresh in-memory DuckDB connection for CSV-scanning queries."""
    return duckdb.connect(DUCKDB_PATH)


def _rollup_read_conn() -> duckdb.DuckDBPyConnection:
    """Read-only connection to the persistent futures rollup DB."""
    return duckdb.connect(str(ROLLUP_DB_PATH), read_only=True)


# ── Asset root resolver ───────────────────────────────────────────────────────

_ASSET_ROOTS = {
    "options":       OPTIONS_ROOT,
    "index_options": INDEX_OPTIONS_ROOT,
    "futures":       FUTURES_ROOT,
    "index_futures": INDEX_FUTURES_ROOT,
    "stocks":        STOCKS_ROOT,
}

# Map asset_type → instrument_type stored in rollup DB
_FUTURES_INSTRUMENT_TYPE = {
    "futures":       "STF",
    "index_futures": "IDF",
}


def asset_root(asset_type: str) -> Path:
    root = _ASSET_ROOTS.get(asset_type)
    if root is None:
        raise ValueError(f"Unknown asset type: {asset_type!r}")
    return root


# ── Discovery ─────────────────────────────────────────────────────────────────

def list_tickers(asset_type: str) -> list[str]:
    root = asset_root(asset_type)
    if not root.exists():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def list_expiries(asset_type: str, ticker: str) -> list[str]:
    base = asset_root(asset_type) / ticker
    if not base.exists():
        return []
    return sorted(p.name for p in base.iterdir() if p.is_dir())


def get_available_dates(asset_type: str, ticker: str, expiry: str) -> list[str]:
    """
    Sorted list of YYYY-MM-DD strings for which data exists.

    Futures / index_futures: reads trade_date from analytics.csv (one row per
        date, already aggregated — no need to scan the DATA directory).
    Options / index_options: scans the DATA/ directory for dated CSV filenames.
    """
    if asset_type in ("futures", "index_futures"):
        path = asset_root(asset_type) / ticker / expiry / "analytics.csv"
        if not path.exists():
            return []
        df = pd.read_csv(path, usecols=["trade_date"])
        return (
            pd.to_datetime(df["trade_date"], errors="coerce")
            .dropna()
            .dt.strftime("%Y-%m-%d")
            .drop_duplicates()
            .sort_values()
            .tolist()
        )

    # options / index_options / stocks — DATA/ directory scan
    if asset_type in ("options", "index_options"):
        data_dir = asset_root(asset_type) / ticker / expiry / "DATA"
    else:
        data_dir = asset_root(asset_type) / ticker / "DATA"

    if not data_dir.exists():
        return []

    dates = []
    for f in sorted(data_dir.iterdir()):
        if f.suffix == ".csv":
            try:
                pd.to_datetime(f.stem)
                dates.append(f.stem)
            except Exception:
                pass
    return dates


# ── Shared CSV helpers ────────────────────────────────────────────────────────

def _options_glob(asset_type: str, ticker: str, expiry: str) -> str:
    """DuckDB-compatible glob for day-wise options CSVs (forward slashes)."""
    return str(
        asset_root(asset_type) / ticker / expiry / "DATA" / "*.csv"
    ).replace("\\", "/")


def _date_from_filename_expr() -> str:
    """DuckDB expression that extracts a DATE from a YYYY-MM-DD filename."""
    return "CAST(regexp_extract(filename, '(\\d{4}-\\d{2}-\\d{2})\\.csv', 1) AS DATE)"


def _read_analytics_csv(
    path: Path,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    """
    Read an analytics.csv through DuckDB with an optional date filter.
    Handles path normalisation and trade_date casting in one place.
    """
    if not path.exists():
        return pd.DataFrame()

    path_str = str(path).replace("\\", "/")
    where = (
        f"WHERE CAST(trade_date AS DATE) BETWEEN DATE '{start_date}' AND DATE '{end_date}'"
        if start_date and end_date else ""
    )

    conn = get_conn()
    try:
        df = conn.execute(f"""
            SELECT * FROM read_csv_auto('{path_str}', ignore_errors=true)
            {where}
            ORDER BY trade_date
        """).df()
    finally:
        conn.close()

    df["trade_date"] = pd.to_datetime(df["trade_date"], errors="coerce")
    return df.dropna(subset=["trade_date"])


# ── Options (STO + IDO) — public API ─────────────────────────────────────────

def get_options_data(
    asset_type: str,
    ticker: str,
    expiry: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """All day-wise rows for a ticker+expiry in a date range."""
    glob      = _options_glob(asset_type, ticker, expiry)
    date_expr = _date_from_filename_expr()
    conn      = get_conn()
    try:
        df = conn.execute(f"""
            SELECT *, {date_expr} AS trade_date
            FROM read_csv_auto('{glob}', filename=true, ignore_errors=true)
            WHERE {date_expr} BETWEEN DATE '{start_date}' AND DATE '{end_date}'
        """).df()
    finally:
        conn.close()

    for col in ["StrkPric", "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "UndrlygPric"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def get_options_analytics(
    asset_type: str,
    ticker: str,
    expiry: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    return _read_analytics_csv(
        asset_root(asset_type) / ticker / expiry / "analytics.csv",
        start_date,
        end_date,
    )


def get_options_analytics_full(
    asset_type: str,
    ticker: str,
    expiry: str,
) -> pd.DataFrame:
    return _read_analytics_csv(
        asset_root(asset_type) / ticker / expiry / "analytics.csv"
    )


def get_daily_expiry_snapshot(
    asset_type: str,
    expiry: str,
    trade_date: str,
) -> pd.DataFrame:
    """
    One analytics row per ticker for a given expiry + trade date.
    Works for both options and index_options.
    """
    root = asset_root(asset_type)
    rows = []

    for ticker_dir in root.iterdir():
        if not ticker_dir.is_dir():
            continue
        path = ticker_dir / expiry / "analytics.csv"
        if not path.exists():
            continue
        path_str = str(path).replace("\\", "/")
        conn = get_conn()
        try:
            df = conn.execute(f"""
                SELECT * FROM read_csv_auto('{path_str}', ignore_errors=true)
                WHERE CAST(trade_date AS DATE) = DATE '{trade_date}'
                LIMIT 1
            """).df()
        finally:
            conn.close()
        if df.empty:
            continue
        row           = df.iloc[0].to_dict()
        row["ticker"] = ticker_dir.name
        row["expiry"] = expiry
        rows.append(row)

    if not rows:
        return pd.DataFrame()

    result = pd.DataFrame(rows)
    result["trade_date"] = pd.to_datetime(result["trade_date"], errors="coerce")
    if "pcr" in result.columns:
        result = result.sort_values("pcr", ascending=False, na_position="last")
    return result


def get_chart_scale(
    asset_type: str,
    ticker: str,
    expiry: str,
    start_date: str,
    end_date: str,
    metric: str,
) -> dict:
    """Y/X axis bounds + strike gap for a given options series + date range."""
    METRIC_COL = {
        "oi":      "OpnIntrst",
        "oi_chng": "ChngInOpnIntrst",
        "vol":     "TtlTradgVol",
    }
    col = METRIC_COL.get(metric)
    if col is None:
        return {"y_min": 0.0, "y_max": 1.0, "x_min": 0.0, "x_max": 0.0, "strike_gap": 50.0}

    glob        = _options_glob(asset_type, ticker, expiry)
    date_expr   = _date_from_filename_expr()
    date_filter = f"{date_expr} BETWEEN DATE '{start_date}' AND DATE '{end_date}'"

    conn = get_conn()
    try:
        minmax = conn.execute(f"""
            SELECT
                MIN(CAST("{col}"   AS DOUBLE)),
                MAX(CAST("{col}"   AS DOUBLE)),
                MIN(CAST(StrkPric  AS DOUBLE)),
                MAX(CAST(StrkPric  AS DOUBLE))
            FROM read_csv_auto('{glob}', filename=true, ignore_errors=true)
            WHERE {date_filter}
              AND CAST("{col}" AS DOUBLE) != 0
        """).fetchone()

        gap_row = conn.execute(f"""
            WITH strikes AS (
                SELECT DISTINCT CAST(StrkPric AS DOUBLE) AS s
                FROM read_csv_auto('{glob}', filename=true, ignore_errors=true)
                WHERE {date_filter} AND CAST("{col}" AS DOUBLE) != 0
                ORDER BY s
            ),
            diffs AS (
                SELECT ROUND(LEAD(s) OVER (ORDER BY s) - s) AS gap FROM strikes
            )
            SELECT gap FROM diffs WHERE gap > 0
            GROUP BY gap ORDER BY COUNT(*) DESC LIMIT 1
        """).fetchone()
    finally:
        conn.close()

    y_raw_min  = float(minmax[0])  if minmax[0]  is not None else 0.0
    y_raw_max  = float(minmax[1])  if minmax[1]  is not None else 1.0
    x_min      = float(minmax[2])  if minmax[2]  is not None else 0.0
    x_max      = float(minmax[3])  if minmax[3]  is not None else 0.0
    strike_gap = float(gap_row[0]) if gap_row and gap_row[0] else 50.0

    y_pad = max(abs(y_raw_min), abs(y_raw_max)) * 0.08
    return {
        "y_min":      y_raw_min - y_pad,
        "y_max":      y_raw_max + y_pad,
        "x_min":      x_min,
        "x_max":      x_max,
        "strike_gap": strike_gap,
    }


# ── Futures (STF + IDF) — public API ─────────────────────────────────────────

def get_futures_analytics(asset_type: str, ticker: str, expiry: str) -> pd.DataFrame:
    """Full analytics history for a single futures ticker+expiry."""
    df = _read_analytics_csv(asset_root(asset_type) / ticker / expiry / "analytics.csv")
    return df.replace({np.nan: None})


def get_futures_rollup(
    trade_date: str,
    asset_type: str = "futures",
) -> pd.DataFrame:
    """
    All contracts for a given trade date from the persistent rollup DB,
    filtered to the instrument_type that corresponds to asset_type.
    """
    if not ROLLUP_DB_PATH.exists():
        return pd.DataFrame()

    instrument_type = _FUTURES_INSTRUMENT_TYPE.get(asset_type)
    if instrument_type is None:
        raise ValueError(f"asset_type {asset_type!r} is not a futures type")

    conn = _rollup_read_conn()
    try:
        df = conn.execute(
            """
            SELECT *
            FROM futures_rollup
            WHERE trade_date = CAST(? AS DATE)
              AND instrument_type = ?
            ORDER BY ABS(chng_in_oi) DESC
            """,
            [trade_date, instrument_type],
        ).df()
    except Exception:
        return pd.DataFrame()
    finally:
        conn.close()

    return df.replace([np.nan, np.inf, -np.inf], None)


def get_futures_market_dates(asset_type: str = "futures") -> list[str]:
    """
    All unique trade dates present in the rollup DB for a given asset_type.
    """
    if not ROLLUP_DB_PATH.exists():
        return []

    instrument_type = _FUTURES_INSTRUMENT_TYPE.get(asset_type)
    if instrument_type is None:
        raise ValueError(f"asset_type {asset_type!r} is not a futures type")

    conn = _rollup_read_conn()
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td
            FROM futures_rollup
            WHERE instrument_type = ?
            ORDER BY td
            """,
            [instrument_type],
        ).fetchall()
    except Exception:
        return []
    finally:
        conn.close()

    return [r[0] for r in rows]


# ── Stocks (stub) ─────────────────────────────────────────────────────────────

def get_stock_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    glob      = str(STOCKS_ROOT / ticker / "DATA" / "*.csv").replace("\\", "/")
    date_expr = "CAST(regexp_extract(filename, '(\\d{4}-\\d{2}-\\d{2})', 1) AS DATE)"
    conn      = get_conn()
    try:
        df = conn.execute(f"""
            SELECT *, {date_expr} AS trade_date
            FROM read_csv_auto('{glob}', filename=true, ignore_errors=true)
            WHERE {date_expr} BETWEEN DATE '{start_date}' AND DATE '{end_date}'
        """).df()
    finally:
        conn.close()
    return df
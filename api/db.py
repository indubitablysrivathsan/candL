"""
NSE Platform — DuckDB query layer
===================================
Single DB file: data/nse.db

Tables
------
  fo_data             — raw tick data for all instrument types
  options_analytics   — computed per (instrument_type, ticker, expiry, trade_date)
  futures_analytics   — computed per (instrument_type, ticker, expiry, trade_date)

Asset types accepted by public API
-----------------------------------
  "stock_options"  → instrument_type = 'STO'
  "index_options"  → instrument_type = 'IDO'
  "stock_futures"  → instrument_type = 'STF'
  "index_futures"  → instrument_type = 'IDF'
"""

import numpy as np
import pandas as pd
import duckdb
from pathlib import Path

from config import NSE_DB_PATH   # Path("data/nse.db")


# ── Instrument type mapping ───────────────────────────────────────────────────

_INSTR = {
    "stock_options": "STO",
    "index_options": "IDO",
    "stock_futures": "STF",
    "index_futures": "IDF",
}

def _instr(asset_type: str) -> str:
    t = _INSTR.get(asset_type)
    if t is None:
        raise ValueError(f"Unknown asset_type: {asset_type!r}")
    return t


# ── Connection ────────────────────────────────────────────────────────────────

def get_conn(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(NSE_DB_PATH.resolve()), read_only=read_only)


# ── Schema bootstrap (called once at app startup) ─────────────────────────────

DDL = """
CREATE TABLE IF NOT EXISTS fo_data (
    trade_date      DATE        NOT NULL,
    biz_date        DATE,
    instrument_type VARCHAR(3)  NOT NULL,
    instrument_id   INTEGER     NOT NULL,
    ticker          VARCHAR     NOT NULL,
    expiry          DATE        NOT NULL,
    actual_expiry   DATE,
    strike          DOUBLE,
    option_type     VARCHAR(2),
    open            DOUBLE,
    high            DOUBLE,
    low             DOUBLE,
    close           DOUBLE,
    last            DOUBLE,
    prev_close      DOUBLE,
    underlying      DOUBLE,
    settlement      DOUBLE,
    open_interest   DOUBLE,
    chng_in_oi      DOUBLE,
    volume          DOUBLE,
    turnover        DOUBLE,
    trade_count     INTEGER,
    lot_size        INTEGER,
    PRIMARY KEY (trade_date, instrument_id)
);

CREATE TABLE IF NOT EXISTS options_analytics (
    instrument_type VARCHAR(3)  NOT NULL,
    ticker          VARCHAR     NOT NULL,
    expiry          DATE        NOT NULL,
    trade_date      DATE        NOT NULL,
    pe_oi           DOUBLE,
    ce_oi           DOUBLE,
    pcr             DOUBLE,
    underlying      DOUBLE,
    max_pain        DOUBLE,
    PRIMARY KEY (instrument_type, ticker, expiry, trade_date)
);

CREATE TABLE IF NOT EXISTS futures_analytics (
    instrument_type VARCHAR(3)  NOT NULL,
    ticker          VARCHAR     NOT NULL,
    expiry          DATE        NOT NULL,
    trade_date      DATE        NOT NULL,
    close           DOUBLE,
    prev_close      DOUBLE,
    chng_in_price   DOUBLE,
    chng_price_per  DOUBLE,
    chng_in_oi      DOUBLE,
    chng_oi_per     DOUBLE,
    open_int        DOUBLE,
    underlying      DOUBLE,
    quadrant        VARCHAR,
    basis           DOUBLE,
    cost_of_carry   DOUBLE,
    volume_oi_ratio DOUBLE,
    days_to_expiry  INTEGER,
    PRIMARY KEY (instrument_type, ticker, expiry, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_fo_ticker_expiry
    ON fo_data(ticker, expiry, trade_date);
CREATE INDEX IF NOT EXISTS idx_fo_instr_date
    ON fo_data(instrument_type, trade_date);
CREATE INDEX IF NOT EXISTS idx_opt_ana_lookup
    ON options_analytics(instrument_type, ticker, expiry);
CREATE INDEX IF NOT EXISTS idx_fut_ana_lookup
    ON futures_analytics(instrument_type, ticker, expiry);
"""

def init_db():
    """Create tables and indexes if they don't exist. Safe to call on every startup."""
    NSE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    try:
        conn.execute(DDL)
    finally:
        conn.close()


# ── Discovery ─────────────────────────────────────────────────────────────────

def list_tickers(asset_type: str) -> list[str]:
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            "SELECT DISTINCT ticker FROM fo_data WHERE instrument_type = ? ORDER BY ticker",
            [instr],
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


def list_expiries(asset_type: str, ticker: str) -> list[str]:
    """
    Returns expiries sorted: current/future months ascending first,
    then past months descending — matching original behaviour.
    """
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT CAST(expiry AS VARCHAR) AS exp
            FROM fo_data
            WHERE instrument_type = ? AND ticker = ?
            ORDER BY exp
            """,
            [instr, ticker],
        ).fetchall()
    finally:
        conn.close()

    from datetime import date
    today = date.today()
    current_month_start = today.replace(day=1)

    all_expiries = [r[0] for r in rows]
    future_and_current, past = [], []
    for exp in all_expiries:
        try:
            exp_date = date.fromisoformat(exp)
            if exp_date.replace(day=1) >= current_month_start:
                future_and_current.append(exp)
            else:
                past.append(exp)
        except ValueError:
            future_and_current.append(exp)

    return future_and_current + past[::-1]


def get_available_dates(asset_type: str, ticker: str, expiry: str) -> list[str]:
    instr = _instr(asset_type)
    table = (
        "futures_analytics"
        if asset_type in ("stock_futures", "index_futures")
        else "options_analytics"
    )
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            f"""
            SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td
            FROM {table}
            WHERE instrument_type = ? AND ticker = ? AND expiry = CAST(? AS DATE)
            ORDER BY td
            """,
            [instr, ticker, expiry],
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


# ── Options public API ────────────────────────────────────────────────────────

def get_options_data(
    asset_type: str,
    ticker: str,
    expiry: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                trade_date, instrument_type AS FinInstrmTp, instrument_id AS FinInstrmId,
                ticker AS TckrSymb, expiry AS XpryDt, strike AS StrkPric,
                option_type AS OptnTp, open AS OpnPric, high AS HghPric, low AS LwPric,
                close AS ClsPric, last AS LastPric, prev_close AS PrvsClsgPric,
                underlying AS UndrlygPric, settlement AS SttlmPric,
                open_interest AS OpnIntrst, chng_in_oi AS ChngInOpnIntrst,
                volume AS TtlTradgVol, turnover AS TtlTrfVal,
                trade_count AS TtlNbOfTxsExctd, lot_size AS NewBrdLotQty
            FROM fo_data
            WHERE instrument_type = ?
              AND ticker = ?
              AND expiry = CAST(? AS DATE)
              AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY trade_date, strike, option_type
            """,
            [instr, ticker, expiry, start_date, end_date],
        ).df()
    finally:
        conn.close()
    return df


def get_options_analytics(
    asset_type: str,
    ticker: str,
    expiry: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    instr = _instr(asset_type)
    where = "WHERE instrument_type = ? AND ticker = ? AND expiry = CAST(? AS DATE)"
    params = [instr, ticker, expiry]

    if start_date:
        where += " AND trade_date >= CAST(? AS DATE)"
        params.append(start_date)
    if end_date:
        where += " AND trade_date <= CAST(? AS DATE)"
        params.append(end_date)

    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            f"SELECT * FROM options_analytics {where} ORDER BY trade_date",
            params,
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df


def get_daily_expiry_snapshot(
    asset_type: str,
    expiry: str,
    trade_date: str,
) -> pd.DataFrame:
    """One analytics row per ticker for a given expiry + trade date."""
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT * FROM options_analytics
            WHERE instrument_type = ?
              AND expiry = CAST(? AS DATE)
              AND trade_date = CAST(? AS DATE)
            ORDER BY pcr DESC NULLS LAST
            """,
            [instr, expiry, trade_date],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df


def get_chart_scale(
    asset_type: str,
    ticker: str,
    expiry: str,
    start_date: str,
    end_date: str,
    metric: str,
) -> dict:
    METRIC_COL = {
        "oi":      "open_interest",
        "oi_chng": "chng_in_oi",
        "vol":     "volume",
    }
    col = METRIC_COL.get(metric)
    if col is None:
        return {"y_min": 0.0, "y_max": 1.0, "x_min": 0.0, "x_max": 0.0, "strike_gap": 50.0}

    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        minmax = conn.execute(
            f"""
            SELECT
                MIN({col}), MAX({col}),
                MIN(strike), MAX(strike)
            FROM fo_data
            WHERE instrument_type = ?
              AND ticker = ?
              AND expiry = CAST(? AS DATE)
              AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
              AND {col} != 0
            """,
            [instr, ticker, expiry, start_date, end_date],
        ).fetchone()

        gap_row = conn.execute(
            """
            WITH strikes AS (
                SELECT DISTINCT strike AS s
                FROM fo_data
                WHERE instrument_type = ?
                  AND ticker = ?
                  AND expiry = CAST(? AS DATE)
                  AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
                ORDER BY s
            ),
            diffs AS (
                SELECT ROUND(LEAD(s) OVER (ORDER BY s) - s) AS gap FROM strikes
            )
            SELECT gap FROM diffs WHERE gap > 0
            GROUP BY gap ORDER BY COUNT(*) DESC LIMIT 1
            """,
            [instr, ticker, expiry, start_date, end_date],
        ).fetchone()
    finally:
        conn.close()

    y_raw_min  = float(minmax[0]) if minmax[0] is not None else 0.0
    y_raw_max  = float(minmax[1]) if minmax[1] is not None else 1.0
    x_min      = float(minmax[2]) if minmax[2] is not None else 0.0
    x_max      = float(minmax[3]) if minmax[3] is not None else 0.0
    strike_gap = float(gap_row[0]) if gap_row and gap_row[0] else 50.0

    y_pad = max(abs(y_raw_min), abs(y_raw_max)) * 0.08
    return {
        "y_min":      y_raw_min - y_pad,
        "y_max":      y_raw_max + y_pad,
        "x_min":      x_min,
        "x_max":      x_max,
        "strike_gap": strike_gap,
    }


# ── Futures public API ────────────────────────────────────────────────────────

def get_futures_analytics(asset_type: str, ticker: str, expiry: str) -> pd.DataFrame:
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT * FROM futures_analytics
            WHERE instrument_type = ? AND ticker = ? AND expiry = CAST(? AS DATE)
            ORDER BY trade_date
            """,
            [instr, ticker, expiry],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace({np.nan: None})


def get_futures_rollup(trade_date: str, asset_type: str = "stock_futures") -> pd.DataFrame:
    """Replaces the old rollup.db — computed on the fly from futures_analytics."""
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT * FROM futures_analytics
            WHERE instrument_type = ? AND trade_date = CAST(? AS DATE)
            ORDER BY ABS(chng_in_oi) DESC
            """,
            [instr, trade_date],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_futures_market_dates(asset_type: str = "stock_futures") -> list[str]:
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td
            FROM futures_analytics
            WHERE instrument_type = ?
            ORDER BY td
            """,
            [instr],
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


# ── Processing state checks (used by startup_sync) ───────────────────────────

def is_processed(trade_date: str, instrument_type: str) -> bool:
    """
    Check whether data for a given trade_date + instrument_type exists in DB.
    Works for both analytics tables.
    """
    table = (
        "futures_analytics"
        if instrument_type in ("STF", "IDF")
        else "options_analytics"
    )
    conn = get_conn(read_only=True)
    try:
        result = conn.execute(
            f"""
            SELECT COUNT(*) FROM {table}
            WHERE instrument_type = ? AND trade_date = CAST(? AS DATE)
            """,
            [instrument_type, trade_date],
        ).fetchone()
        return result[0] > 0
    except Exception as e:
        print(f"[is_processed] ERROR {instrument_type} {trade_date}: {e}")
        print(f"[is_processed] DB path: {NSE_DB_PATH} (exists: {NSE_DB_PATH.exists()})")
        return False
    finally:
        conn.close()
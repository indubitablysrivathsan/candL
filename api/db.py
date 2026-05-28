"""
NSE Platform — DuckDB query layer
===================================
Single DB file: data/nse.db
 
Tables
------
  fo_data             — raw F&O tick data for all instrument types
  options_analytics   — computed per (instrument_type, ticker, expiry, trade_date)
  futures_analytics   — computed per (instrument_type, ticker, expiry, trade_date)
  eq_bhav             — equity bhavcopy (OHLC + delivery data)
  cm_bhav             — CM segment bhavcopy (new NSE format)
  fii_stats           — FII derivatives statistics
  participant_oi      — participant-wise open interest
  participant_vol     — participant-wise trading volume
  fo_volatility       — F&O underlying + futures volatility (EWMA)
  market_activity     — market activity report (index summary)
"""
 
import numpy as np
import pandas as pd
import duckdb
from pathlib import Path
 
from config import NSE_DB_PATH
 
 
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
 
 
# ── Schema bootstrap ──────────────────────────────────────────────────────────
 
DDL = """
-- ── F&O (existing) ────────────────────────────────────────────────────────────
 
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
 
-- ── Equity bhavcopy ───────────────────────────────────────────────────────────
 
CREATE TABLE IF NOT EXISTS eq_bhav (
    trade_date      DATE        NOT NULL,
    symbol          VARCHAR     NOT NULL,
    series          VARCHAR,
    prev_close      DOUBLE,
    open            DOUBLE,
    high            DOUBLE,
    low             DOUBLE,
    last            DOUBLE,
    close           DOUBLE,
    avg_price       DOUBLE,
    volume          BIGINT,
    turnover_lacs   DOUBLE,
    trade_count     INTEGER,
    deliv_qty       BIGINT,
    deliv_pct       DOUBLE,
    PRIMARY KEY (trade_date, symbol, series)
);
 
-- ── CM bhavcopy (new NSE format, includes gold bonds etc) ─────────────────────
 
CREATE TABLE IF NOT EXISTS cm_bhav (
    trade_date      DATE        NOT NULL,
    biz_date        DATE,
    segment         VARCHAR,
    instrument_type VARCHAR,
    instrument_id   INTEGER,
    isin            VARCHAR,
    ticker          VARCHAR     NOT NULL,
    series          VARCHAR,
    instrument_name VARCHAR,
    open            DOUBLE,
    high            DOUBLE,
    low             DOUBLE,
    close           DOUBLE,
    last            DOUBLE,
    prev_close      DOUBLE,
    settlement      DOUBLE,
    open_interest   DOUBLE,
    chng_in_oi      DOUBLE,
    volume          BIGINT,
    turnover        DOUBLE,
    trade_count     INTEGER,
    lot_size        INTEGER,
    PRIMARY KEY (trade_date, ticker, series)
);
 
-- ── FII derivatives statistics ────────────────────────────────────────────────
 
CREATE TABLE IF NOT EXISTS fii_stats (
    trade_date          DATE        NOT NULL,
    instrument          VARCHAR     NOT NULL,   -- e.g. INDEX FUTURES, NIFTY FUTURES
    buy_contracts       BIGINT,
    buy_amt_cr          DOUBLE,
    sell_contracts      BIGINT,
    sell_amt_cr         DOUBLE,
    oi_contracts        BIGINT,
    oi_amt_cr           DOUBLE,
    PRIMARY KEY (trade_date, instrument)
);
 
-- ── Participant-wise open interest ────────────────────────────────────────────
 
CREATE TABLE IF NOT EXISTS participant_oi (
    trade_date              DATE        NOT NULL,
    client_type             VARCHAR     NOT NULL,   -- Client, DII, FII, Pro
    fut_idx_long            BIGINT,
    fut_idx_short           BIGINT,
    fut_stk_long            BIGINT,
    fut_stk_short           BIGINT,
    opt_idx_call_long       BIGINT,
    opt_idx_put_long        BIGINT,
    opt_idx_call_short      BIGINT,
    opt_idx_put_short       BIGINT,
    opt_stk_call_long       BIGINT,
    opt_stk_put_long        BIGINT,
    opt_stk_call_short      BIGINT,
    opt_stk_put_short       BIGINT,
    total_long              BIGINT,
    total_short             BIGINT,
    PRIMARY KEY (trade_date, client_type)
);
 
-- ── Participant-wise trading volume ───────────────────────────────────────────
 
CREATE TABLE IF NOT EXISTS participant_vol (
    trade_date              DATE        NOT NULL,
    client_type             VARCHAR     NOT NULL,
    fut_idx_long            BIGINT,
    fut_idx_short           BIGINT,
    fut_stk_long            BIGINT,
    fut_stk_short           BIGINT,
    opt_idx_call_long       BIGINT,
    opt_idx_put_long        BIGINT,
    opt_idx_call_short      BIGINT,
    opt_idx_put_short       BIGINT,
    opt_stk_call_long       BIGINT,
    opt_stk_put_long        BIGINT,
    opt_stk_call_short      BIGINT,
    opt_stk_put_short       BIGINT,
    total_long              BIGINT,
    total_short             BIGINT,
    PRIMARY KEY (trade_date, client_type)
);
 
-- ── F&O volatility (EWMA) ─────────────────────────────────────────────────────
 
CREATE TABLE IF NOT EXISTS fo_volatility (
    trade_date              DATE        NOT NULL,
    ticker                  VARCHAR     NOT NULL,
    underlying_close        DOUBLE,
    underlying_prev_close   DOUBLE,
    underlying_log_ret      DOUBLE,
    prev_underlying_vol     DOUBLE,
    underlying_daily_vol    DOUBLE,
    underlying_annual_vol   DOUBLE,
    futures_close           DOUBLE,
    futures_prev_close      DOUBLE,
    futures_log_ret         DOUBLE,
    prev_futures_vol        DOUBLE,
    futures_daily_vol       DOUBLE,
    futures_annual_vol      DOUBLE,
    applicable_daily_vol    DOUBLE,
    applicable_annual_vol   DOUBLE,
    PRIMARY KEY (trade_date, ticker)
);
 
-- ── Market activity report ────────────────────────────────────────────────────
 
CREATE TABLE IF NOT EXISTS market_activity (
    trade_date          DATE        NOT NULL,
    index_name          VARCHAR     NOT NULL,
    prev_close          DOUBLE,
    open                DOUBLE,
    high                DOUBLE,
    low                 DOUBLE,
    close               DOUBLE,
    gain_loss           DOUBLE,
    PRIMARY KEY (trade_date, index_name)
);
 
CREATE TABLE IF NOT EXISTS market_activity_summary (
    trade_date          DATE        PRIMARY KEY,
    traded_value_cr     DOUBLE,
    traded_qty_lacs     DOUBLE,
    num_trades          BIGINT,
    market_cap_cr       DOUBLE
);
 
-- ── Indexes ───────────────────────────────────────────────────────────────────
 
CREATE INDEX IF NOT EXISTS idx_fo_ticker_expiry
    ON fo_data(ticker, expiry, trade_date);
CREATE INDEX IF NOT EXISTS idx_fo_instr_date
    ON fo_data(instrument_type, trade_date);
CREATE INDEX IF NOT EXISTS idx_opt_ana_lookup
    ON options_analytics(instrument_type, ticker, expiry);
CREATE INDEX IF NOT EXISTS idx_fut_ana_lookup
    ON futures_analytics(instrument_type, ticker, expiry);
 
CREATE INDEX IF NOT EXISTS idx_eq_bhav_date
    ON eq_bhav(trade_date, symbol);
CREATE INDEX IF NOT EXISTS idx_cm_bhav_date
    ON cm_bhav(trade_date, ticker);
CREATE INDEX IF NOT EXISTS idx_fo_volt_ticker
    ON fo_volatility(ticker, trade_date);
CREATE INDEX IF NOT EXISTS idx_part_oi_date
    ON participant_oi(trade_date);
CREATE INDEX IF NOT EXISTS idx_part_vol_date
    ON participant_vol(trade_date);
"""
 
 
def init_db():
    """Create all tables and indexes if they don't exist. Safe to call on every startup."""
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
    """Returns all expiries for a ticker in ascending date order."""
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
    return [r[0] for r in rows]


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

def get_options_cycle_history(
    ticker: str,
    asset_type: str = "stock_options",
) -> pd.DataFrame:
    """
    Full options analytics history for a ticker across all expiries,
    ordered by trade date. Used for cycle OI chart.
    """
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT *
            FROM options_analytics
            WHERE instrument_type = ?
              AND ticker = ?
            ORDER BY trade_date ASC
            """,
            [instr, ticker],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
        if "expiry" in df.columns:
            df["expiry"] = pd.to_datetime(df["expiry"])

    return df.replace([np.nan, np.inf, -np.inf], None)

def get_options_market_history(
    asset_type: str = "stock_options",
) -> pd.DataFrame:
    """
    Sum of ce_oi and pe_oi across ALL tickers per (expiry, trade_date).
    Used for the COMBINED market OI chart.
    """
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                trade_date,
                expiry,
                SUM(ce_oi) AS ce_oi,
                SUM(pe_oi) AS pe_oi
            FROM options_analytics
            WHERE instrument_type = ?
            GROUP BY trade_date, expiry
            ORDER BY trade_date ASC
            """,
            [instr],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
        if "expiry" in df.columns:
            df["expiry"] = pd.to_datetime(df["expiry"])

    return df.replace([np.nan, np.inf, -np.inf], None)

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


def get_futures_rollup(trade_date: str, asset_type: str = "stock_futures", ticker: str | None = None,) -> pd.DataFrame:
    """Replaces the old rollup.db — computed on the fly from futures_analytics."""
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    params = [instr, trade_date]
    query = """
        SELECT * FROM futures_analytics
        WHERE instrument_type = ? AND trade_date = CAST(? AS DATE)
    """
    if ticker:
        query += " AND ticker = ?"
        params.append(ticker)
    query += " ORDER BY ABS(chng_in_oi) DESC"
    try:
        df = conn.execute(
            query,            
            params,
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

def get_futures_cycle_history(
    ticker: str,
    asset_type: str = "stock_futures",
) -> pd.DataFrame:
    """
    Full futures analytics history for a ticker,
    ordered by trade date.
    """

    instr = _instr(asset_type)

    conn = get_conn(read_only=True)

    query = """
        SELECT *
        FROM futures_analytics
        WHERE instrument_type = ?
          AND ticker = ?
        ORDER BY trade_date ASC
    """

    try:
        df = conn.execute(
            query,
            [instr, ticker],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])

        if "expiry" in df.columns:
            df["expiry"] = pd.to_datetime(df["expiry"])

    return df.replace([np.nan, np.inf, -np.inf], None)


# ── Processing state checks ───────────────────────────────────────────────────
 
# Maps each processor key → (table, column, value) to check
_PROCESS_CHECK = {
    # F&O (existing)
    "STF": ("futures_analytics",  "instrument_type", "STF"),
    "IDF": ("futures_analytics",  "instrument_type", "IDF"),
    "STO": ("options_analytics",  "instrument_type", "STO"),
    "IDO": ("options_analytics",  "instrument_type", "IDO"),
    # New
    "eq_bhav":   ("eq_bhav",                 None, None),
    "cm_bhav":   ("cm_bhav",                 None, None),
    "fii":       ("fii_stats",               None, None),
    "part_oi":   ("participant_oi",          None, None),
    "part_vol":  ("participant_vol",         None, None),
    "fo_volt":   ("fo_volatility",           None, None),
    "mkt_act":   ("market_activity_summary", None, None),
}
 
def is_processed(trade_date: str, key: str) -> bool:
    """
    Check whether data for a given trade_date exists in the relevant table.
 
    For F&O keys (STF/IDF/STO/IDO) also filters by instrument_type.
    For all other keys just checks trade_date presence.
    """
    entry = _PROCESS_CHECK.get(key)
    if entry is None:
        raise ValueError(f"Unknown process key: {key!r}")
 
    table, col, val = entry
    conn = get_conn(read_only=True)
    try:
        if col:
            result = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {col} = ? AND trade_date = CAST(? AS DATE)",
                [val, trade_date],
            ).fetchone()
        else:
            result = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE trade_date = CAST(? AS DATE)",
                [trade_date],
            ).fetchone()
        return result[0] > 0
    except Exception as e:
        print(f"[is_processed] ERROR {key} {trade_date}: {e}")
        print(f"[is_processed] DB path: {NSE_DB_PATH} (exists: {NSE_DB_PATH.exists()})")
        return False
    finally:
        conn.close()
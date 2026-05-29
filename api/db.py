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
 
CREATE TABLE IF NOT EXISTS instruments (
    instrument_key      BIGINT PRIMARY KEY,

    exchange            VARCHAR,
    segment             VARCHAR,

    instrument_type     VARCHAR,
    instrument_id       BIGINT,

    ticker              VARCHAR,
    instrument_name     VARCHAR,

    isin                VARCHAR,
    series              VARCHAR,

    expiry              DATE,
    actual_expiry       DATE,

    strike              DOUBLE,
    option_type         VARCHAR,

    lot_size            INTEGER,

    underlying_symbol   VARCHAR,

    is_active           BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS market_data_daily (
    trade_date          DATE NOT NULL,
    instrument_key      BIGINT NOT NULL,

    open                DOUBLE,
    high                DOUBLE,
    low                 DOUBLE,
    close               DOUBLE,
    last                DOUBLE,
    prev_close          DOUBLE,
    avg_price           DOUBLE,

    volume              BIGINT,
    turnover            DOUBLE,
    trade_count         BIGINT,

    open_interest       BIGINT,
    change_in_oi        BIGINT,

    settlement_price    DOUBLE,
    underlying_price    DOUBLE,

    delivery_qty        BIGINT,
    delivery_pct        DOUBLE,

    PRIMARY KEY (trade_date, instrument_key)
);

CREATE TABLE IF NOT EXISTS participant_activity (
    trade_date          DATE NOT NULL,

    participant_type    VARCHAR NOT NULL,

    metric_type         VARCHAR NOT NULL,
    asset_class         VARCHAR NOT NULL,

    direction           VARCHAR NOT NULL,
    option_side         VARCHAR NOT NULL DEFAULT 'NA',

    contracts           BIGINT,

    PRIMARY KEY (
        trade_date,
        participant_type,
        metric_type,
        asset_class,
        direction,
        option_side
    )
);

CREATE TABLE IF NOT EXISTS fii_stats (
    trade_date          DATE NOT NULL,
    instrument          VARCHAR NOT NULL,

    buy_contracts       BIGINT,
    buy_amount_cr       DOUBLE,

    sell_contracts      BIGINT,
    sell_amount_cr      DOUBLE,

    oi_contracts        BIGINT,
    oi_amount_cr        DOUBLE,

    PRIMARY KEY (trade_date, instrument)
);

CREATE TABLE IF NOT EXISTS fo_volatility (
    trade_date   DATE NOT NULL,
    ticker       VARCHAR NOT NULL,

    underlying_log_return       DOUBLE,
    underlying_daily_vol        DOUBLE,
    underlying_annual_vol       DOUBLE,

    futures_log_return          DOUBLE,
    futures_daily_vol           DOUBLE,
    futures_annual_vol          DOUBLE,

    applicable_daily_vol        DOUBLE,
    applicable_annual_vol       DOUBLE,

    PRIMARY KEY (trade_date, ticker)
);

CREATE TABLE IF NOT EXISTS market_activity_index (
    trade_date          DATE NOT NULL,
    index_name          VARCHAR NOT NULL,

    prev_close          DOUBLE,
    open                DOUBLE,
    high                DOUBLE,
    low                 DOUBLE,
    close               DOUBLE,
    gain_loss           DOUBLE,

    PRIMARY KEY (trade_date, index_name)
);

CREATE TABLE IF NOT EXISTS market_activity_summary (
    trade_date          DATE PRIMARY KEY,

    traded_value_cr     DOUBLE,
    traded_qty_lacs     DOUBLE,
    num_trades          BIGINT,
    market_cap_cr       DOUBLE
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
 
-- ── Indexes ───────────────────────────────────────────────────────────────────

-- instruments
CREATE UNIQUE INDEX IF NOT EXISTS idx_instr_identity
ON instruments (
    instrument_type,
    ticker,
    expiry,
    strike,
    option_type,
    series
);
CREATE INDEX IF NOT EXISTS idx_instr_ticker
ON instruments (ticker);
CREATE INDEX IF NOT EXISTS idx_instr_expiry
ON instruments (expiry);
CREATE INDEX IF NOT EXISTS idx_instr_type
ON instruments (instrument_type);


-- market_data_daily
CREATE INDEX IF NOT EXISTS idx_market_instr_date
ON market_data_daily (
    instrument_key,
    trade_date
);
CREATE INDEX IF NOT EXISTS idx_market_date
ON market_data_daily (trade_date);


-- participant_activity
CREATE INDEX IF NOT EXISTS idx_participant_date
ON participant_activity (trade_date);
CREATE INDEX IF NOT EXISTS idx_participant_type
ON participant_activity (
    participant_type,
    metric_type,
    asset_class
);

 
-- fii_stats
CREATE INDEX IF NOT EXISTS idx_fii_date
ON fii_stats (trade_date);


-- fo_volatility
CREATE INDEX IF NOT EXISTS idx_vol_instr_date
ON fo_volatility (
    ticker,
    trade_date
);


-- market_activity_index
CREATE INDEX IF NOT EXISTS idx_market_index_date
ON market_activity_index (
    index_name,
    trade_date
);


-- options_analytics
CREATE INDEX IF NOT EXISTS idx_opt_analytics
ON options_analytics (
    ticker,
    expiry,
    trade_date
);


-- futures_analytics
CREATE INDEX IF NOT EXISTS idx_fut_analytics
ON futures_analytics (
    ticker,
    expiry,
    trade_date
);
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
            """
            SELECT DISTINCT ticker
            FROM instruments
            WHERE instrument_type = ? AND is_active = TRUE
            ORDER BY ticker
            """,
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
            FROM instruments
            WHERE instrument_type = ? AND ticker = ? AND expiry IS NOT NULL
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
    """
    Raw per-strike option chain data for a ticker/expiry/date range.
    Joins instruments + market_data_daily (replaces old fo_data query).
    Column aliases preserved so downstream code is unchanged.
    """
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                m.trade_date,
                i.instrument_type   AS FinInstrmTp,
                i.instrument_id     AS FinInstrmId,
                i.ticker            AS TckrSymb,
                i.expiry            AS XpryDt,
                i.strike            AS StrkPric,
                i.option_type       AS OptnTp,
                m.open              AS OpnPric,
                m.high              AS HghPric,
                m.low               AS LwPric,
                m.close             AS ClsPric,
                m.last              AS LastPric,
                m.prev_close        AS PrvsClsgPric,
                m.underlying_price  AS UndrlygPric,
                m.settlement_price  AS SttlmPric,
                m.open_interest     AS OpnIntrst,
                m.change_in_oi      AS ChngInOpnIntrst,
                m.volume            AS TtlTradgVol,
                m.turnover          AS TtlTrfVal,
                m.trade_count       AS TtlNbOfTxsExctd,
                i.lot_size          AS NewBrdLotQty
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.instrument_type = ?
              AND i.ticker = ?
              AND i.expiry = CAST(? AS DATE)
              AND m.trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY m.trade_date, i.strike, i.option_type
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
        "oi":      "m.open_interest",
        "oi_chng": "m.change_in_oi",
        "vol":     "m.volume",
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
                MIN(i.strike),  MAX(i.strike)
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.instrument_type = ?
              AND i.ticker = ?
              AND i.expiry = CAST(? AS DATE)
              AND m.trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
              AND {col} != 0
            """,
            [instr, ticker, expiry, start_date, end_date],
        ).fetchone()

        gap_row = conn.execute(
            """
            WITH strikes AS (
                SELECT DISTINCT i.strike AS s
                FROM market_data_daily m
                JOIN instruments i USING (instrument_key)
                WHERE i.instrument_type = ?
                  AND i.ticker = ?
                  AND i.expiry = CAST(? AS DATE)
                  AND m.trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
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


def get_futures_rollup(
    trade_date: str,
    asset_type: str = "stock_futures",
    ticker: str | None = None,
) -> pd.DataFrame:
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
        df = conn.execute(query, params).df()
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
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT *
            FROM futures_analytics
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


# ── Processing state checks ───────────────────────────────────────────────────
# (table, extra_where_clause_or_None, params_list_or_None)
# Replaces old _PROCESS_CHECK dict — new tables, new keys.

_PROCESS_CHECK = {
    # F&O analytics (unchanged keys, unchanged tables)
    "STF": ("futures_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["STF", d]),
    "IDF": ("futures_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["IDF", d]),
    "STO": ("options_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["STO", d]),
    "IDO": ("options_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["IDO", d]),

    # Normalized tables — check via segment/instrument_type on market_data_daily
    "eq_bhav": ("market_data_daily JOIN instruments USING (instrument_key)",
                "instruments.instrument_type = 'EQ' AND market_data_daily.trade_date = CAST(? AS DATE)",
                lambda d: [d]),
    "cm_bhav": ("market_data_daily JOIN instruments USING (instrument_key)",
                "instruments.segment = 'CM' AND instruments.instrument_type != 'EQ' AND market_data_daily.trade_date = CAST(? AS DATE)",
                lambda d: [d]),

    # Standalone tables
    "fii":      ("fii_stats",                "trade_date = CAST(? AS DATE)", lambda d: [d]),
    "part_oi":  ("participant_activity",     "metric_type = 'OI'  AND trade_date = CAST(? AS DATE)", lambda d: [d]),
    "part_vol": ("participant_activity",     "metric_type = 'VOL' AND trade_date = CAST(? AS DATE)", lambda d: [d]),
    "fo_volt":  ("fo_volatility",            "trade_date = CAST(? AS DATE)", lambda d: [d]),
    "mkt_act":  ("market_activity_summary",  "trade_date = CAST(? AS DATE)", lambda d: [d]),
}


def is_processed(trade_date: str, key: str) -> bool:
    entry = _PROCESS_CHECK.get(key)
    if entry is None:
        raise ValueError(f"Unknown process key: {key!r}")

    table, where, params_fn = entry
    conn = get_conn(read_only=True)
    try:
        result = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {where}",
            params_fn(trade_date),
        ).fetchone()
        return result[0] > 0
    except Exception as e:
        print(f"[is_processed] ERROR {key} {trade_date}: {e}")
        return False
    finally:
        conn.close()
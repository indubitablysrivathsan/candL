"""
NSE Platform — DuckDB query layer
===================================
Single DB file: data/nse.db

Tables
------
  instruments                 — master identity for all instrument types (F&O + CM)
  instrument_contract_daily   — daily F&O contract terms (lot_size, margin, price bands), keyed by trade_date
  security_master_daily       — daily CM security terms (lot_size, par value, issued capital), keyed by trade_date
  corporate_actions           — splits/bonus/rights/dividends/mergers (sparse, informational only — not queried)
  market_data_daily           — OHLCV + OI + delivery data for all instrument_keys (F&O and CM)
  options_analytics           — computed per (instrument_type, ticker, expiry, trade_date)
  futures_analytics           — computed per (instrument_type, ticker, expiry, trade_date)
  participant_activity        — participant-wise OI/volume by direction and option_side
  fii_stats                   — FII derivatives statistics
  fo_volatility                — F&O underlying + futures volatility (EWMA)
  market_activity_summary     — market-wide daily totals (traded value, qty, trades, market cap)
  market_activity_index       — daily OHLC for named indices
  market_activity_breadth     — advances/declines/unchanged + price-band hits

Notes
-----
  lot_size lives on instrument_contract_daily (F&O) / security_master_daily (CM),
  not on instruments — always join on (instrument_key, trade_date) to fetch it.

  Stock equities are identified via instruments.instrument_type = 'STK'
  AND instruments.series = 'EQ' (not instrument_type = 'EQ').
"""
import numpy as np
import pandas as pd
import duckdb
from pathlib import Path

import numpy as np
import pandas as pd
 
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
-- ── Core identity ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instruments (
    instrument_key      BIGINT PRIMARY KEY,

    exchange             VARCHAR,
    segment              VARCHAR,     -- 'FO' / 'CM'

    instrument_id        BIGINT,
    instrument_type      VARCHAR,     -- 'STO','IDO','STF','IDF',

    ticker               VARCHAR,
    instrument_name      VARCHAR,

    isin                  VARCHAR,
    series                VARCHAR,

    expiry                DATE,
    strike                DOUBLE,
    option_type           VARCHAR
);

-- ── F&O daily contract terms ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instrument_contract_daily (
    file_date           DATE   NOT NULL,
    trade_date           DATE   NOT NULL,
    instrument_key       BIGINT NOT NULL,

    lot_size              INTEGER,
    min_lot                INTEGER,

    margin_pct            DOUBLE,
    base_price             DOUBLE,
    min_price               DOUBLE,
    max_price               DOUBLE,

    settlement_method     VARCHAR,   -- 'C' cash / 'P' physical
    exercise_style          VARCHAR,   -- 'E' european / 'A' american

    max_single_txn_qty      BIGINT,    -- MaxTradQty

    admission_date          DATE,      -- AdmssnDt

    PRIMARY KEY (trade_date, instrument_key)
);

-- ── Corporate actions (sparse — only rows where an actual event exists) ─────

CREATE TABLE IF NOT EXISTS corporate_actions (
    isin                     VARCHAR,
    ticker                     VARCHAR,
    event_type                   VARCHAR,   -- split/bonus/rights/dividend/merger
    ratio_numerator                DOUBLE,
    ratio_denominator                DOUBLE,
    ex_date                             DATE,
    record_date                           DATE,
    purpose_raw                             VARCHAR,

    PRIMARY KEY (isin, ex_date)
);

-- ── CM daily security terms ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_master_daily (
    file_date           DATE   NOT NULL,
    trade_date            DATE   NOT NULL,
    instrument_key        BIGINT NOT NULL,

    lot_size                INTEGER,

    par_value                  DOUBLE,
    issued_capital             DOUBLE,
    max_trade_pct               DOUBLE,

    listing_date                DATE,
    record_date                  DATE,

    PRIMARY KEY (trade_date, instrument_key)
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
    max_pain        DOUBLE,
    PRIMARY KEY (instrument_type, ticker, expiry, trade_date)
);
 
CREATE TABLE IF NOT EXISTS futures_analytics (
    instrument_type VARCHAR(3)  NOT NULL,
    ticker          VARCHAR     NOT NULL,
    expiry          DATE        NOT NULL,
    trade_date      DATE        NOT NULL,

    chng_in_price     DOUBLE,
    chng_price_per    DOUBLE,
    chng_oi_per       DOUBLE,
    quadrant          VARCHAR,
    basis             DOUBLE,
    cost_of_carry     DOUBLE,
    choi_volume_ratio DOUBLE,
    days_to_expiry    INTEGER,

    PRIMARY KEY (instrument_type, ticker, expiry, trade_date)
);
 
CREATE TABLE IF NOT EXISTS market_activity_breadth (
    trade_date          DATE PRIMARY KEY,
 
    advances            INTEGER,
    declines            INTEGER,
    unchanged           INTEGER,
 
    -- total securities that hit their price band (up or down, not separated in source)
    price_band_hits     INTEGER
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
CREATE INDEX IF NOT EXISTS idx_instr_segment
ON instruments (segment);

-- instrument_contract_daily
CREATE INDEX IF NOT EXISTS idx_contract_daily_instr     ON instrument_contract_daily (instrument_key);
CREATE INDEX IF NOT EXISTS idx_contract_daily_admission ON instrument_contract_daily (admission_date);

-- corporate_actions
CREATE INDEX IF NOT EXISTS idx_corp_actions_isin    ON corporate_actions (isin);
CREATE INDEX IF NOT EXISTS idx_corp_actions_exdate  ON corporate_actions (ex_date);

-- security_master_daily
CREATE INDEX IF NOT EXISTS idx_sec_master_instr    ON security_master_daily (instrument_key);
CREATE INDEX IF NOT EXISTS idx_sec_master_listing  ON security_master_daily (listing_date);

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

-- market_activity_breadth
CREATE INDEX IF NOT EXISTS idx_breadth_date
ON market_activity_breadth (trade_date);
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
            WHERE instrument_type = ?
            ORDER BY ticker
            """,
            [instr],
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


def list_expiries(asset_type: str, ticker: str | None = None) -> list[str]:
    """Returns expiries for a ticker, or all expiries for an asset type if ticker is omitted."""
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)

    try:
        if ticker:
            rows = conn.execute(
                """
                SELECT DISTINCT CAST(expiry AS VARCHAR) AS exp
                FROM instruments
                WHERE instrument_type = ?
                  AND ticker = ?
                  AND expiry IS NOT NULL
                ORDER BY exp
                """,
                [instr, ticker],
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT DISTINCT CAST(expiry AS VARCHAR) AS exp
                FROM instruments
                WHERE instrument_type = ?
                  AND expiry IS NOT NULL
                ORDER BY exp
                """,
                [instr],
            ).fetchall()
    finally:
        conn.close()

    return [r[0] for r in rows]


def get_available_dates(asset_type: str, expiry: str, ticker: str | None = None) -> list[str]:
    instr = _instr(asset_type)
    table = (
        "futures_analytics"
        if asset_type in ("stock_futures", "index_futures")
        else "options_analytics"
    )
    conn = get_conn(read_only=True)
    try:
        query = f"""
            SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td
            FROM {table}
            WHERE instrument_type = ?
              AND expiry = CAST(? AS DATE)
        """
        params = [instr, expiry]
        if ticker:
            query += " AND ticker = ?"
            params.append(ticker)
        query += " ORDER BY td"
        rows = conn.execute(query, params).fetchall()
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
                c.lot_size          AS NewBrdLotQty
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            LEFT JOIN instrument_contract_daily c
                ON c.instrument_key = m.instrument_key
               AND c.trade_date     = m.trade_date
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
        # ── Y scale: min/max values within the requested date range only ──
        # (so the y-axis is still scaled to what the user is actually viewing)
        y_row = conn.execute(
            f"""
            SELECT MIN({col}), MAX({col})
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
 
        # ── X scale: ALL strikes ever recorded for this ticker+expiry ────
        # Deliberately ignores start_date/end_date so the strike window is
        # identical no matter which date slice the user is viewing.
        x_row = conn.execute(
            """
            SELECT MIN(i.strike), MAX(i.strike)
            FROM instruments i
            WHERE i.instrument_type = ?
              AND i.ticker = ?
              AND i.expiry = CAST(? AS DATE)
            """,
            [instr, ticker, expiry],
        ).fetchone()
 
        # ── Strike gap: most common gap across ALL dates ──────────────────
        gap_row = conn.execute(
            """
            WITH strikes AS (
                SELECT DISTINCT i.strike AS s
                FROM instruments i
                WHERE i.instrument_type = ?
                  AND i.ticker = ?
                  AND i.expiry = CAST(? AS DATE)
                ORDER BY s
            ),
            diffs AS (
                SELECT ROUND(LEAD(s) OVER (ORDER BY s) - s) AS gap FROM strikes
            )
            SELECT gap FROM diffs WHERE gap > 0
            GROUP BY gap ORDER BY COUNT(*) DESC LIMIT 1
            """,
            [instr, ticker, expiry],
        ).fetchone()
    finally:
        conn.close()
 
    y_raw_min  = float(y_row[0]) if y_row and y_row[0] is not None else 0.0
    y_raw_max  = float(y_row[1]) if y_row and y_row[1] is not None else 1.0
    x_min      = float(x_row[0]) if x_row and x_row[0] is not None else 0.0
    x_max      = float(x_row[1]) if x_row and x_row[1] is not None else 0.0
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

_FUT_JOIN = """
    FROM futures_analytics fa
    JOIN instruments i
        ON i.instrument_type = fa.instrument_type
       AND i.ticker          = fa.ticker
       AND i.expiry          = fa.expiry
    JOIN market_data_daily m
        ON m.instrument_key = i.instrument_key
       AND m.trade_date     = fa.trade_date
    LEFT JOIN instrument_contract_daily c
        ON c.instrument_key = i.instrument_key
       AND c.trade_date     = fa.trade_date
"""

_FUT_SELECT = """
    fa.*,
    m.close, m.prev_close, m.open_interest AS open_int,
    m.change_in_oi AS chng_in_oi, m.underlying_price AS underlying,
    m.volume,
    c.lot_size
"""


def get_futures_analytics(asset_type: str, ticker: str, expiry: str) -> pd.DataFrame:
    instr = _instr(asset_type)
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            f"""
            SELECT {_FUT_SELECT}
            {_FUT_JOIN}
            WHERE fa.instrument_type = ? AND fa.ticker = ? AND fa.expiry = CAST(? AS DATE)
            ORDER BY fa.trade_date
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
    query = f"""
        SELECT {_FUT_SELECT}
        {_FUT_JOIN}
        WHERE fa.instrument_type = ? AND fa.trade_date = CAST(? AS DATE)
    """
    if ticker:
        query += " AND fa.ticker = ?"
        params.append(ticker)
    query += " ORDER BY ABS(m.change_in_oi) DESC"
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
            f"""
            SELECT {_FUT_SELECT}
            {_FUT_JOIN}
            WHERE fa.instrument_type = ?
              AND fa.ticker = ?
            ORDER BY fa.trade_date ASC
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


# ─────────────────────────────────────────────────────────────────────────────
# STOCKS  (EQ instruments via market_data_daily + instruments)
# ─────────────────────────────────────────────────────────────────────────────
 
def get_eq_tickers() -> list[str]:
    """All active EQ tickers with market data."""
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT i.ticker
            FROM instruments i
            WHERE i.instrument_type = 'STK'
              AND i.series = 'EQ'
              AND EXISTS (
                  SELECT 1
                  FROM market_data_daily m
                  WHERE m.instrument_key = i.instrument_key
              )
            ORDER BY i.ticker
            """
        ).fetchall()
    finally:
        conn.close()

    return [r[0] for r in rows]
 
 
def get_eq_ohlc(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    OHLCV + delivery data for a single EQ ticker over a date range.
    Joins market_data_daily with instruments for metadata.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                m.trade_date,
                i.ticker,
                i.instrument_name,
                i.isin,
                m.open,
                m.high,
                m.low,
                m.close,
                m.last,
                m.prev_close,
                m.avg_price,
                m.volume,
                m.turnover,
                m.trade_count,
                m.delivery_qty,
                m.delivery_pct
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.instrument_type = 'STK'
              AND i.series = 'EQ'
              AND i.ticker = ?
              AND m.trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY m.trade_date
            """,
            [ticker, start_date, end_date],
        ).df()
    finally:
        conn.close()
 
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)
 
 
def get_eq_snapshot(trade_date: str, limit: int = 200) -> pd.DataFrame:
    """
    Cross-sectional snapshot of all EQ tickers for a given date.
    Computes pct_change, delivery_pct, volume, turnover.
    Used for screener / heatmap.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                i.ticker,
                i.instrument_name,
                i.isin,
                m.trade_date,
                m.open,
                m.high,
                m.low,
                m.close,
                m.prev_close,
                m.avg_price,
                m.volume,
                m.turnover,
                m.trade_count,
                m.delivery_qty,
                m.delivery_pct,
                ROUND(
                    (m.close - m.prev_close) / NULLIF(m.prev_close, 0) * 100,
                    2
                ) AS pct_change
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.instrument_type = 'STK'
              AND i.series = 'EQ'
              AND m.trade_date = CAST(? AS DATE)
              AND m.close IS NOT NULL
              AND m.prev_close IS NOT NULL
            ORDER BY ABS(
                (m.close - m.prev_close) / NULLIF(m.prev_close, 0)
            ) DESC NULLS LAST
            LIMIT ?
            """,
            [trade_date, limit],
        ).df()
    finally:
        conn.close()
 
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)
 
 
def get_eq_delivery_leaders(trade_date: str, top_n: int = 50) -> pd.DataFrame:
    """
    Top stocks by delivery percentage on a given date.
    High delivery % = strong institutional / conviction buying.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                i.ticker,
                i.instrument_name,
                m.close,
                m.prev_close,
                ROUND(
                    (m.close - m.prev_close) / NULLIF(m.prev_close, 0) * 100,
                    2
                ) AS pct_change,
                m.volume,
                m.turnover,
                m.delivery_qty,
                m.delivery_pct
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.instrument_type = 'STK'
              AND i.series = 'EQ'
              AND m.trade_date = CAST(? AS DATE)
              AND m.delivery_pct IS NOT NULL
            ORDER BY m.delivery_pct DESC NULLS LAST
            LIMIT ?
            """,
            [trade_date, top_n],
        ).df()
    finally:
        conn.close()
    return df.replace([np.nan, np.inf, -np.inf], None)
 
 
def get_eq_available_dates() -> list[str]:
    """All trade dates available in the EQ dataset."""
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT CAST(m.trade_date AS VARCHAR) AS td
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.instrument_type = 'STK'
              AND i.series = 'EQ'
            ORDER BY td
            """
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]
 
 
def get_eq_rolling_stats(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Returns daily returns + rolling 20d and 5d delivery_pct average.
    Useful for signal construction research.
    """
    df = get_eq_ohlc(ticker, start_date, end_date)
    if df.empty:
        return df
 
    df = df.sort_values("trade_date").copy()
    df["daily_return"] = df["close"].pct_change() * 100
    df["delivery_pct_ma5"] = df["delivery_pct"].rolling(5, min_periods=1).mean()
    df["delivery_pct_ma20"] = df["delivery_pct"].rolling(20, min_periods=1).mean()
    df["volume_ma20"] = df["volume"].rolling(20, min_periods=1).mean()
    df["rel_volume"] = df["volume"] / df["volume_ma20"]
    return df.replace([np.nan, np.inf, -np.inf], None)
 
 
"""
api/db_participant_fii.py
=========================
DB query functions for participant activity and FII statistics.
Drop-in additions/replacements for your existing api/db.py.

New functions added:
  get_participant_daily_summary(trade_date, asset_class)
  get_fii_daily_summary(trade_date)

Existing functions reproduced here for completeness (with minor fixes):
  get_participant_net_oi     — added long_contracts / short_contracts columns
  get_participant_net_vol    — column rename: buy/sell → long/short for consistency
  get_participant_latest     — unchanged
  get_participant_available_dates — unchanged
  get_fii_stats              — unchanged
  get_fii_index_futures_flow — unchanged
  get_fii_available_dates    — unchanged
  get_fii_instruments        — unchanged
"""

import numpy as np
import pandas as pd


# ─────────────────────────────────────────────────────────────────────────────
# PARTICIPANT ACTIVITY
# ─────────────────────────────────────────────────────────────────────────────

def get_participant_net_oi(
    start_date: str,
    end_date: str,
    asset_class: str = "INDEX",
) -> pd.DataFrame:
    """
    Net OI (long - short) per participant per day, by option_side.

    Returns columns:
      trade_date, participant_type, option_side,
      long_contracts, short_contracts, net_contracts
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                trade_date,
                participant_type,
                option_side,
                SUM(CASE WHEN direction = 'long'  THEN contracts ELSE 0 END) AS long_contracts,
                SUM(CASE WHEN direction = 'short' THEN contracts ELSE 0 END) AS short_contracts,
                SUM(CASE WHEN direction = 'long'  THEN contracts ELSE 0 END)
                - SUM(CASE WHEN direction = 'short' THEN contracts ELSE 0 END) AS net_contracts
            FROM participant_activity
            WHERE metric_type  = 'OI'
              AND asset_class  = ?
              AND trade_date   BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            GROUP BY trade_date, participant_type, option_side
            ORDER BY trade_date, participant_type, option_side
            """,
            [asset_class, start_date, end_date],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_participant_net_vol(
    start_date: str,
    end_date: str,
    asset_class: str = "INDEX",
) -> pd.DataFrame:
    """
    Net trading volume (buy - sell) per participant per day, by option_side.

    Returns columns:
      trade_date, participant_type, option_side,
      long_contracts, short_contracts, net_contracts

    Note: columns named long/short (not buy/sell) to match OI shape
    so the frontend can reuse the same pivot logic.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                trade_date,
                participant_type,
                option_side,
                SUM(CASE WHEN direction = 'long'  THEN contracts ELSE 0 END) AS long_contracts,
                SUM(CASE WHEN direction = 'short' THEN contracts ELSE 0 END) AS short_contracts,
                SUM(CASE WHEN direction = 'long'  THEN contracts ELSE 0 END)
                - SUM(CASE WHEN direction = 'short' THEN contracts ELSE 0 END) AS net_contracts
            FROM participant_activity
            WHERE metric_type  = 'VOL'
              AND asset_class  = ?
              AND trade_date   BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            GROUP BY trade_date, participant_type, option_side
            ORDER BY trade_date, participant_type, option_side
            """,
            [asset_class, start_date, end_date],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_participant_latest(asset_class: str = "INDEX") -> pd.DataFrame:
    """Most recent day's full OI breakdown for all participants."""
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT *
            FROM participant_activity
            WHERE metric_type = 'OI'
              AND asset_class = ?
              AND trade_date = (
                SELECT MAX(trade_date)
                FROM participant_activity
                WHERE metric_type = 'OI' AND asset_class = ?
              )
            ORDER BY participant_type, option_side, direction
            """,
            [asset_class, asset_class],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_participant_daily_summary(
    trade_date: str,
    asset_class: str = "INDEX",
) -> pd.DataFrame:
    """
    Single-day pivot matching the NSE fao_participant_oi_*.csv layout.

    Returns one row per participant with wide columns:
      fut_idx_long, fut_idx_short,
      fut_stk_long, fut_stk_short,          (only if asset_class='STOCK' or ALL)
      opt_ce_long,  opt_ce_short,
      opt_pe_long,  opt_pe_short,
      total_long,   total_short,
      fut_net,      ce_net,   pe_net,   total_net

    The pivot is done in SQL to avoid heavy Python wrangling.

    NOTE: This query works when participant_activity stores INDEX and STOCK
    rows separately (as the NSE files do). If your DB only stores one
    asset_class per row, the STOCK columns will be 0/null for INDEX queries.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                CAST(? AS DATE)                                              AS trade_date,
                participant_type,

                -- Futures
                SUM(CASE WHEN option_side='NA' AND direction='long'  THEN contracts ELSE 0 END) AS fut_long,
                SUM(CASE WHEN option_side='NA' AND direction='short' THEN contracts ELSE 0 END) AS fut_short,
                SUM(CASE WHEN option_side='NA' AND direction='long'  THEN contracts ELSE 0 END)
              - SUM(CASE WHEN option_side='NA' AND direction='short' THEN contracts ELSE 0 END) AS fut_net,

                -- Calls
                SUM(CASE WHEN option_side='CE' AND direction='long'  THEN contracts ELSE 0 END) AS ce_long,
                SUM(CASE WHEN option_side='CE' AND direction='short' THEN contracts ELSE 0 END) AS ce_short,
                SUM(CASE WHEN option_side='CE' AND direction='long'  THEN contracts ELSE 0 END)
              - SUM(CASE WHEN option_side='CE' AND direction='short' THEN contracts ELSE 0 END) AS ce_net,

                -- Puts
                SUM(CASE WHEN option_side='PE' AND direction='long'  THEN contracts ELSE 0 END) AS pe_long,
                SUM(CASE WHEN option_side='PE' AND direction='short' THEN contracts ELSE 0 END) AS pe_short,
                SUM(CASE WHEN option_side='PE' AND direction='long'  THEN contracts ELSE 0 END)
              - SUM(CASE WHEN option_side='PE' AND direction='short' THEN contracts ELSE 0 END) AS pe_net,

                -- Totals
                SUM(CASE WHEN direction='long'  THEN contracts ELSE 0 END)  AS total_long,
                SUM(CASE WHEN direction='short' THEN contracts ELSE 0 END)  AS total_short,
                SUM(CASE WHEN direction='long'  THEN contracts ELSE 0 END)
              - SUM(CASE WHEN direction='short' THEN contracts ELSE 0 END)  AS total_net

            FROM participant_activity
            WHERE metric_type  = 'OI'
              AND asset_class  = ?
              AND trade_date   = CAST(? AS DATE)
            GROUP BY participant_type
            ORDER BY participant_type
            """,
            [trade_date, asset_class, trade_date],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_participant_available_dates() -> list[str]:
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td
            FROM participant_activity
            ORDER BY td
            """
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# FII STATISTICS
# ─────────────────────────────────────────────────────────────────────────────

def get_fii_stats(
    start_date: str,
    end_date: str,
    instruments: list[str] | None = None,
) -> pd.DataFrame:
    """
    FII derivatives stats for a date range.
    Adds net_contracts and net_amount_cr columns.
    """
    where = "trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)"
    params: list = [start_date, end_date]

    if instruments:
        placeholders = ", ".join(["?" for _ in instruments])
        where += f" AND instrument IN ({placeholders})"
        params.extend(instruments)

    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            f"""
            SELECT
                trade_date,
                instrument,
                buy_contracts,
                buy_amount_cr,
                sell_contracts,
                sell_amount_cr,
                oi_contracts,
                oi_amount_cr,
                buy_contracts  - sell_contracts  AS net_contracts,
                buy_amount_cr  - sell_amount_cr  AS net_amount_cr
            FROM fii_stats
            WHERE {where}
            ORDER BY trade_date, instrument
            """,
            params,
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_fii_index_futures_flow(
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """FII net index futures positions — the primary institutional-flow signal."""
    return get_fii_stats(
        start_date, end_date,
        instruments=["INDEX FUTURES", "NIFTY FUTURES", "BANKNIFTY FUTURES"],
    )


def get_fii_daily_summary(trade_date: str) -> pd.DataFrame:
    """
    Single-day FII snapshot matching the NSE XLS table layout.
    All instruments for the given date with buy/sell/OI/net columns.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT
                trade_date,
                instrument,
                buy_contracts,
                buy_amount_cr,
                sell_contracts,
                sell_amount_cr,
                oi_contracts,
                oi_amount_cr,
                buy_contracts  - sell_contracts  AS net_contracts,
                buy_amount_cr  - sell_amount_cr  AS net_amount_cr
            FROM fii_stats
            WHERE trade_date = CAST(? AS DATE)
            ORDER BY instrument
            """,
            [trade_date],
        ).df()
    finally:
        conn.close()

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_fii_available_dates() -> list[str]:
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            "SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td FROM fii_stats ORDER BY td"
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


def get_fii_instruments() -> list[str]:
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            "SELECT DISTINCT instrument FROM fii_stats ORDER BY instrument"
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]
 
# ─────────────────────────────────────────────────────────────────────────────
# FO VOLATILITY
# ─────────────────────────────────────────────────────────────────────────────
 
def get_volatility(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """EWMA volatility series for a ticker (underlying + futures)."""
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT *
            FROM fo_volatility
            WHERE ticker = ?
              AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY trade_date
            """,
            [ticker, start_date, end_date],
        ).df()
    finally:
        conn.close()
 
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)
 
 
def get_volatility_snapshot(trade_date: str, top_n: int = 50) -> pd.DataFrame:
    """
    Cross-sectional volatility snapshot — all tickers on one date.
    Useful for vol screener / ranking.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            """
            SELECT *
            FROM fo_volatility
            WHERE trade_date = CAST(? AS DATE)
            ORDER BY applicable_annual_vol DESC NULLS LAST
            LIMIT ?
            """,
            [trade_date, top_n],
        ).df()
    finally:
        conn.close()
 
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)
 
 
def get_volatility_tickers() -> list[str]:
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            "SELECT DISTINCT ticker FROM fo_volatility ORDER BY ticker"
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]
 
 
def get_volatility_available_dates() -> list[str]:
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td
            FROM fo_volatility ORDER BY td
            """
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]
 
 
"""
api/db_market_activity.py
==========================
DB query functions for market-activity tables.

Tables:
    market_activity_summary
    market_activity_index
    market_activity_breadth
    
Top stocks / security queries use:
    market_data_daily JOIN instruments (sourced from sec_bhavdata_full_*.csv)
"""


# ─────────────────────────────────────────────────────────────────────────────
# MARKET ACTIVITY — SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

def get_market_summary(start_date: str, end_date: str) -> pd.DataFrame:
    """Market-wide daily totals: traded value, qty, trades, market cap."""
    conn = get_conn(read_only=True)
    try:
        df = conn.execute("""
            SELECT *
            FROM market_activity_summary
            WHERE trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY trade_date
        """, [start_date, end_date]).df()
    finally:
        conn.close()
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


# ─────────────────────────────────────────────────────────────────────────────
# MARKET ACTIVITY — INDEX
# ─────────────────────────────────────────────────────────────────────────────

def get_market_index_history(
    index_name: str, start_date: str, end_date: str
) -> pd.DataFrame:
    """OHLC history for a named index (e.g. 'Nifty 50')."""
    conn = get_conn(read_only=True)
    try:
        df = conn.execute("""
            SELECT *
            FROM market_activity_index
            WHERE index_name = ?
              AND trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY trade_date
        """, [index_name, start_date, end_date]).df()
    finally:
        conn.close()
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_market_index_snapshot(trade_date: str) -> pd.DataFrame:
    """All index values for a given date with pct_change."""
    conn = get_conn(read_only=True)
    try:
        df = conn.execute("""
            SELECT
                trade_date,
                index_name,
                prev_close,
                open,
                high,
                low,
                close,
                gain_loss,
                ROUND(gain_loss / NULLIF(prev_close, 0) * 100, 2) AS pct_change
            FROM market_activity_index
            WHERE trade_date = CAST(? AS DATE)
            ORDER BY index_name
        """, [trade_date]).df()
    finally:
        conn.close()
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_market_available_dates() -> list[str]:
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute("""
            SELECT DISTINCT CAST(trade_date AS VARCHAR) AS td
            FROM market_activity_summary
            ORDER BY td
        """).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


def get_market_index_names() -> list[str]:
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute("""
            SELECT DISTINCT index_name
            FROM market_activity_index
            ORDER BY
                CASE
                    -- 1. Core indices (highest priority group)

                    WHEN LOWER(index_name) LIKE '%nifty bank%' THEN 0
                    WHEN LOWER(index_name) LIKE '%nifty fin service%' THEN 0
                    WHEN LOWER(index_name) LIKE '%nifty mid select%' THEN 0
                    WHEN LOWER(index_name) LIKE '%nifty next 50%' THEN 0
                    WHEN LOWER(index_name) LIKE '%india vix%' THEN 0

                    -- 2. All other NIFTY indices
                    WHEN LOWER(index_name) LIKE '%nifty%' THEN 1

                    -- 3. BharatBond
                    WHEN LOWER(index_name) LIKE 'bharatbond%' THEN 2

                    -- 4. Everything else
                    ELSE 3
                END,

                -- secondary sort: alphabetical inside buckets
                LOWER(index_name)
        """).fetchall()
    finally:
        conn.close()

    return [r[0] for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# MARKET ACTIVITY — BREADTH
# ─────────────────────────────────────────────────────────────────────────────

def get_market_breadth(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Advances / declines / unchanged and price-band hit counts over a date range.
    Includes computed ad_ratio and ad_spread.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute("""
            SELECT
                trade_date,
                advances,
                declines,
                unchanged,
                price_band_hits,
                ROUND(
                    advances * 1.0 / NULLIF(advances + declines, 0),
                    4
                ) AS ad_ratio,
                advances - declines AS ad_spread
            FROM market_activity_breadth
            WHERE trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY trade_date
        """, [start_date, end_date]).df()
    finally:
        conn.close()
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_market_breadth_snapshot(trade_date: str) -> dict | None:
    """Single-day breadth snapshot."""
    conn = get_conn(read_only=True)
    try:
        rows = conn.execute("""
            SELECT *
            FROM market_activity_breadth
            WHERE trade_date = CAST(? AS DATE)
        """, [trade_date]).fetchall()
    finally:
        conn.close()
    if not rows:
        return None
    row = rows[0]
    return {
        "trade_date":      str(row[0]),
        "advances":        row[1],
        "declines":        row[2],
        "unchanged":       row[3],
        "price_band_hits": row[4],
    }


# ─────────────────────────────────────────────────────────────────────────────
# TOP STOCKS — from market_data_daily + instruments (sec_bhavdata_full)
# ─────────────────────────────────────────────────────────────────────────────

def get_top_stocks(
    trade_date: str,
    series: str = "EQ",
    limit: int = 25,
) -> pd.DataFrame:
    """
    Top N stocks by turnover for a given date.
    Sourced from market_data_daily joined with instruments.
    Default: top 25 EQ series by turnover.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute("""
            SELECT
                mdd.trade_date,
                i.ticker,
                i.series,
                mdd.prev_close,
                mdd.open,
                mdd.high,
                mdd.low,
                mdd.close,
                mdd.volume,
                mdd.turnover,
                mdd.trade_count,
                ROUND((mdd.close - mdd.prev_close) / NULLIF(mdd.prev_close, 0) * 100, 2) AS pct_change
            FROM market_data_daily mdd
            JOIN instruments i ON i.instrument_key = mdd.instrument_key
            WHERE mdd.trade_date = CAST(? AS DATE)
              AND i.series = ?
              AND i.instrument_type = 'STK'
            ORDER BY mdd.turnover DESC NULLS LAST
            LIMIT ?
        """, [trade_date, series, limit]).df()
    finally:
        conn.close()
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_top_gainers_losers(
    trade_date: str,
    series: str = "EQ",
    limit: int = 10,
    min_turnover: float = 100.0,   # lacs — filter out illiquid names
) -> dict[str, pd.DataFrame]:
    """
    Top gainers and losers by pct_change for a given date.
    Filters by minimum turnover to avoid illiquid noise.
    Returns dict with keys 'gainers' and 'losers'.
    """
    conn = get_conn(read_only=True)
    try:
        base = conn.execute("""
            SELECT
                mdd.trade_date,
                i.ticker,
                i.series,
                mdd.prev_close,
                mdd.close,
                mdd.turnover,
                mdd.volume,
                ROUND((mdd.close - mdd.prev_close) / NULLIF(mdd.prev_close, 0) * 100, 2) AS pct_change
            FROM market_data_daily mdd
            JOIN instruments i ON i.instrument_key = mdd.instrument_key
            WHERE mdd.trade_date = CAST(? AS DATE)
              AND i.series = ?
              AND i.instrument_type = 'STK'
              AND mdd.turnover >= ?
              AND mdd.prev_close > 0
        """, [trade_date, series, min_turnover]).df()
    finally:
        conn.close()

    if base.empty:
        empty = pd.DataFrame()
        return {"gainers": empty, "losers": empty}

    base["trade_date"] = pd.to_datetime(base["trade_date"])
    base = base.replace([np.nan, np.inf, -np.inf], None).dropna(subset=["pct_change"])

    gainers = base.nlargest(limit, "pct_change").reset_index(drop=True)
    losers  = base.nsmallest(limit, "pct_change").reset_index(drop=True)
    return {"gainers": gainers, "losers": losers}


def get_security_daily(
    symbol: str,
    start_date: str,
    end_date: str,
    series: str = "EQ",
) -> pd.DataFrame:
    """
    OHLC + volume + delivery time series for a single symbol.
    """
    conn = get_conn(read_only=True)
    try:
        df = conn.execute("""
            SELECT
                mdd.trade_date,
                i.ticker,
                i.series,
                mdd.prev_close,
                mdd.open,
                mdd.high,
                mdd.low,
                mdd.close,
                mdd.avg_price,
                mdd.volume,
                mdd.turnover,
                mdd.trade_count,
                mdd.delivery_qty,
                mdd.delivery_pct,
                ROUND((mdd.close - mdd.prev_close) / NULLIF(mdd.prev_close, 0) * 100, 2) AS pct_change
            FROM market_data_daily mdd
            JOIN instruments i ON i.instrument_key = mdd.instrument_key
            WHERE i.ticker = ?
              AND i.series = ?
              AND i.instrument_type = 'STK'
              AND mdd.trade_date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
            ORDER BY mdd.trade_date
        """, [symbol.upper(), series.upper(), start_date, end_date]).df()
    finally:
        conn.close()
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


def get_security_snapshot(
    trade_date: str,
    series: str = "EQ",
    min_turnover: float | None = None,
) -> pd.DataFrame:
    """
    All EQ securities traded on a given date, sorted by turnover desc.
    Optionally filter by minimum turnover (lacs).
    """
    conn = get_conn(read_only=True)
    params: list = [trade_date, series]
    turnover_clause = ""
    if min_turnover is not None:
        turnover_clause = "AND mdd.turnover >= ?"
        params.append(min_turnover)
    try:
        df = conn.execute(f"""
            SELECT
                mdd.trade_date,
                i.ticker,
                i.series,
                mdd.prev_close,
                mdd.open,
                mdd.high,
                mdd.low,
                mdd.close,
                mdd.volume,
                mdd.turnover,
                mdd.trade_count,
                mdd.delivery_qty,
                mdd.delivery_pct,
                ROUND((mdd.close - mdd.prev_close) / NULLIF(mdd.prev_close, 0) * 100, 2) AS pct_change
            FROM market_data_daily mdd
            JOIN instruments i ON i.instrument_key = mdd.instrument_key
            WHERE mdd.trade_date = CAST(? AS DATE)
              AND i.series = ?
              AND i.instrument_type = 'STK'
              {turnover_clause}
            ORDER BY mdd.turnover DESC NULLS LAST
        """, params).df()
    finally:
        conn.close()
    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df.replace([np.nan, np.inf, -np.inf], None)


# ── Processing state checks ───────────────────────────────────────────────────
# (table, extra_where_clause_or_None, params_list_or_None)
# Replaces old _PROCESS_CHECK dict — new tables, new keys.

_PROCESS_CHECK = {

    # Contracts
    "FO_CONTRACT": ("instrument_contract_daily", "trade_date = CAST(? AS DATE)", lambda d: [d]),
    # F&O analytics (unchanged keys, unchanged tables)
    "STF": ("futures_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["STF", d]),
    "IDF": ("futures_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["IDF", d]),
    "STO": ("options_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["STO", d]),
    "IDO": ("options_analytics",       "instrument_type = ? AND trade_date = CAST(? AS DATE)", lambda d: ["IDO", d]),

    # Normalized tables — check via segment/instrument_type on market_data_daily

    # Securities
    "CM_SECURITY": ("security_master_daily",      "trade_date = CAST(? AS DATE)", lambda d: [d]),
    
    "cm_bhav": ("market_data_daily JOIN instruments USING (instrument_key)",
            "instruments.segment = 'CM' AND instruments.isin IS NOT NULL AND market_data_daily.trade_date = CAST(? AS DATE)",
            lambda d: [d]),

    "eq_bhav": ("market_data_daily",
            "avg_price IS NOT NULL AND trade_date = CAST(? AS DATE)",
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
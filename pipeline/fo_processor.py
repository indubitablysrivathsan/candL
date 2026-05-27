"""
NSE Platform — Unified F&O bhav copy processor
===============================================
Single file read → dispatch on FinInstrmTp → insert into nse.db

Strategy
--------
  - Register the DataFrame directly with DuckDB, zero iterrows.
  - All aggregations (PCR, futures analytics, max pain) computed in SQL.
  - Indexes dropped before bulk insert, rebuilt after.
  - One transaction per trade date; rollback on failure.
  - Print only per-date summary, not per-ticker.
"""

from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd
import duckdb

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import FO_RAW_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed


_FUTURES_TYPES = {"STF", "IDF"}
_OPTIONS_TYPES = {"STO", "IDO"}

_QUADRANT_MAP = {
    (True,  True):  "long_buildup",
    (False, True):  "short_covering",
    (True,  False): "short_buildup",
    (False, False): "long_unwinding",
}


# ── Raw file path ─────────────────────────────────────────────────────────────

def get_raw_fo_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_RAW_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


# ── Processing state checks ───────────────────────────────────────────────────

def already_stock_futures_processed(trade_date: str) -> bool:
    return is_processed(trade_date, "STF")

def already_index_futures_processed(trade_date: str) -> bool:
    return is_processed(trade_date, "IDF")

def already_stock_options_processed(trade_date: str) -> bool:
    return is_processed(trade_date, "STO")

def already_index_options_processed(trade_date: str) -> bool:
    return is_processed(trade_date, "IDO")


# ── Index management ──────────────────────────────────────────────────────────

_DROP_INDEXES = """
DROP INDEX IF EXISTS idx_fo_ticker_expiry;
DROP INDEX IF EXISTS idx_fo_instr_date;
DROP INDEX IF EXISTS idx_opt_ana_lookup;
DROP INDEX IF EXISTS idx_fut_ana_lookup;
"""

_REBUILD_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_fo_ticker_expiry
    ON fo_data(ticker, expiry, trade_date);
CREATE INDEX IF NOT EXISTS idx_fo_instr_date
    ON fo_data(instrument_type, trade_date);
CREATE INDEX IF NOT EXISTS idx_opt_ana_lookup
    ON options_analytics(instrument_type, ticker, expiry);
CREATE INDEX IF NOT EXISTS idx_fut_ana_lookup
    ON futures_analytics(instrument_type, ticker, expiry);
"""


# ── Vectorized fo_data insert ─────────────────────────────────────────────────

def _insert_fo_data(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    """
    Register the DataFrame and let DuckDB pull it in one vectorized scan.
    No iterrows, no tuple construction, no executemany.
    """
    # Ensure date columns are strings so CAST inside SQL is clean
    conn.register("_fo_stage", df)
    conn.execute("""
        INSERT INTO fo_data
        SELECT
            TRY_CAST(TradDt              AS DATE),
            TRY_CAST(BizDt               AS DATE),
            FinInstrmTp,
            TRY_CAST(FinInstrmId         AS INTEGER),
            TckrSymb,
            TRY_CAST(XpryDt              AS DATE),
            TRY_CAST(FininstrmActlXpryDt AS DATE),
            TRY_CAST(StrkPric            AS DOUBLE),
            OptnTp,
            TRY_CAST(OpnPric             AS DOUBLE),
            TRY_CAST(HghPric             AS DOUBLE),
            TRY_CAST(LwPric              AS DOUBLE),
            TRY_CAST(ClsPric             AS DOUBLE),
            TRY_CAST(LastPric            AS DOUBLE),
            TRY_CAST(PrvsClsgPric        AS DOUBLE),
            TRY_CAST(UndrlygPric         AS DOUBLE),
            TRY_CAST(SttlmPric           AS DOUBLE),
            TRY_CAST(OpnIntrst           AS DOUBLE),
            TRY_CAST(ChngInOpnIntrst     AS DOUBLE),
            TRY_CAST(TtlTradgVol         AS DOUBLE),
            TRY_CAST(TtlTrfVal           AS DOUBLE),
            TRY_CAST(TtlNbOfTxsExctd     AS INTEGER),
            TRY_CAST(NewBrdLotQty        AS INTEGER)
        FROM _fo_stage
        ON CONFLICT (trade_date, instrument_id) DO UPDATE SET
            biz_date        = excluded.biz_date,
            instrument_type = excluded.instrument_type,
            ticker          = excluded.ticker,
            expiry          = excluded.expiry,
            actual_expiry   = excluded.actual_expiry,
            strike          = excluded.strike,
            option_type     = excluded.option_type,
            open            = excluded.open,
            high            = excluded.high,
            low             = excluded.low,
            close           = excluded.close,
            last            = excluded.last,
            prev_close      = excluded.prev_close,
            underlying      = excluded.underlying,
            settlement      = excluded.settlement,
            open_interest   = excluded.open_interest,
            chng_in_oi      = excluded.chng_in_oi,
            volume          = excluded.volume,
            turnover        = excluded.turnover,
            trade_count     = excluded.trade_count,
            lot_size        = excluded.lot_size
    """)
    conn.unregister("_fo_stage")


# ── Futures analytics — pure SQL aggregation ──────────────────────────────────

def _process_futures(conn: duckdb.DuckDBPyConnection, trade_date: str):
    """
    Compute futures analytics entirely in DuckDB SQL.
    Quadrant classification done in Python on the small aggregated result.
    """
    conn.execute("""
        CREATE TEMP TABLE IF NOT EXISTS _fut_agg AS
        SELECT
            FinInstrmTp                          AS instrument_type,
            TckrSymb                             AS ticker,
            TRY_CAST(XpryDt AS DATE)             AS expiry,
            TRY_CAST(TradDt AS DATE)             AS trade_date,
            AVG(TRY_CAST(ClsPric      AS DOUBLE)) AS close,
            AVG(TRY_CAST(PrvsClsgPric AS DOUBLE)) AS prev_close,
            AVG(TRY_CAST(UndrlygPric  AS DOUBLE)) AS underlying,
            SUM(TRY_CAST(ChngInOpnIntrst AS DOUBLE)) AS chng_in_oi,
            SUM(TRY_CAST(TtlTradgVol     AS DOUBLE)) AS volume,
            SUM(TRY_CAST(OpnIntrst       AS DOUBLE)) AS open_int
        FROM _fut_stage
        GROUP BY FinInstrmTp, TckrSymb, TRY_CAST(XpryDt AS DATE), TRY_CAST(TradDt AS DATE)
    """)

    agg = conn.execute("SELECT * FROM _fut_agg").df()
    conn.execute("DROP TABLE _fut_agg")

    if agg.empty:
        return

    trade_dt = pd.to_datetime(trade_date)
    rows = []
    for _, r in agg.iterrows():
        close      = r["close"]
        prev_close = r["prev_close"]
        underlying = r["underlying"]
        chng_in_oi = r["chng_in_oi"]
        open_int   = r["open_int"]
        volume     = r["volume"]
        expiry     = r["expiry"]

        chng_in_price   = close - prev_close
        prev_oi         = open_int - chng_in_oi
        basis           = close - underlying
        days_to_expiry  = max((pd.to_datetime(expiry) - trade_dt).days, 0)
        cost_of_carry   = (
            (close - underlying) / underlying * (365 / days_to_expiry)
            if underlying and days_to_expiry > 0 else None
        )
        volume_oi_ratio = volume / open_int if open_int else None
        quadrant        = _QUADRANT_MAP[(chng_in_oi >= 0, chng_in_price >= 0)]
        chng_price_per  = (chng_in_price / prev_close * 100) if prev_close else None
        chng_oi_per     = (chng_in_oi / prev_oi * 100) if prev_oi else None

        rows.append((
            str(r["instrument_type"]), str(r["ticker"]),
            expiry, pd.to_datetime(trade_date).date(),
            close, prev_close, chng_in_price, chng_price_per,
            chng_in_oi, chng_oi_per, open_int, underlying,
            quadrant, basis, cost_of_carry, volume_oi_ratio, days_to_expiry,
        ))

    # Small result set (213 STF + 5 IDF × ~3 expiries ≈ 654 rows max)
    # executemany is fine here — the heavy work was the SQL aggregation above
    conn.executemany("""
        INSERT INTO futures_analytics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (instrument_type, ticker, expiry, trade_date) DO UPDATE SET
            close           = excluded.close,
            prev_close      = excluded.prev_close,
            chng_in_price   = excluded.chng_in_price,
            chng_price_per  = excluded.chng_price_per,
            chng_in_oi      = excluded.chng_in_oi,
            chng_oi_per     = excluded.chng_oi_per,
            open_int        = excluded.open_int,
            underlying      = excluded.underlying,
            quadrant        = excluded.quadrant,
            basis           = excluded.basis,
            cost_of_carry   = excluded.cost_of_carry,
            volume_oi_ratio = excluded.volume_oi_ratio,
            days_to_expiry  = excluded.days_to_expiry
    """, rows)


# ── Options analytics — PCR in SQL, max pain vectorized ──────────────────────

def _compute_max_pain_vectorized(df: pd.DataFrame) -> pd.Series:
    """
    Compute max pain for all (ticker, expiry, instr) groups at once.
    Returns a Series indexed by (instrument_type, ticker, expiry).
    """
    results = {}
    for key, g in df.groupby(["FinInstrmTp", "TckrSymb", "XpryDt"]):
        ce = g[g["OptnTp"] == "CE"].set_index("StrkPric")["OpnIntrst"].fillna(0)
        pe = g[g["OptnTp"] == "PE"].set_index("StrkPric")["OpnIntrst"].fillna(0)
        strikes = np.array(sorted(set(ce.index) | set(pe.index)))
        if len(strikes) == 0:
            results[key] = np.nan
            continue
        ce_k, ce_oi = ce.index.to_numpy(), ce.to_numpy()
        pe_k, pe_oi = pe.index.to_numpy(), pe.to_numpy()
        pains = np.array([
            np.sum(np.maximum(0, s - ce_k) * ce_oi) +
            np.sum(np.maximum(0, pe_k - s) * pe_oi)
            for s in strikes
        ])
        results[key] = float(strikes[np.argmin(pains)])
    return results


def _process_options(conn: duckdb.DuckDBPyConnection, trade_date: str):
    """
    PCR computed in SQL. Max pain computed vectorized in Python on numeric data only.
    """
    # PCR via SQL — one scan, no groupby in Python
    pcr_df = conn.execute("""
        SELECT
            FinInstrmTp                      AS instrument_type,
            TckrSymb                         AS ticker,
            TRY_CAST(XpryDt AS DATE)         AS expiry,
            TRY_CAST(TradDt AS DATE)         AS trade_date,
            AVG(TRY_CAST(UndrlygPric AS DOUBLE)) AS underlying,
            SUM(CASE WHEN OptnTp = 'PE'
                THEN TRY_CAST(OpnIntrst AS DOUBLE) ELSE 0 END) AS pe_oi,
            SUM(CASE WHEN OptnTp = 'CE'
                THEN TRY_CAST(OpnIntrst AS DOUBLE) ELSE 0 END) AS ce_oi
        FROM _opt_stage
        GROUP BY FinInstrmTp, TckrSymb, TRY_CAST(XpryDt AS DATE), TRY_CAST(TradDt AS DATE)
    """).df()

    if pcr_df.empty:
        return

    pcr_df["pcr"] = pcr_df.apply(
        lambda r: r["pe_oi"] / r["ce_oi"] if r["ce_oi"] else np.nan, axis=1
    )

    # Max pain — needs strike-level data, pull numeric columns only
    mp_df = conn.execute("""
        SELECT
            FinInstrmTp AS FinInstrmTp,
            TckrSymb    AS TckrSymb,
            XpryDt      AS XpryDt,
            TRY_CAST(StrkPric    AS DOUBLE) AS StrkPric,
            OptnTp,
            TRY_CAST(OpnIntrst   AS DOUBLE) AS OpnIntrst
        FROM _opt_stage
        WHERE StrkPric IS NOT NULL AND OpnIntrst IS NOT NULL
    """).df()

    max_pain_map = _compute_max_pain_vectorized(mp_df)

    rows = []
    for _, r in pcr_df.iterrows():
        max_pain = max_pain_map.get(
            (
                r["instrument_type"],
                r["ticker"],
                str(pd.to_datetime(r["expiry"]).date()),
            ),
            np.nan,
        )
        rows.append((
            str(r["instrument_type"]), str(r["ticker"]),
            r["expiry"], r["trade_date"],
            r["pe_oi"], r["ce_oi"], r["pcr"], r["underlying"],
            None if (isinstance(max_pain, float) and np.isnan(max_pain)) else max_pain,
        ))

    conn.executemany("""
        INSERT INTO options_analytics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (instrument_type, ticker, expiry, trade_date) DO UPDATE SET
            pe_oi      = excluded.pe_oi,
            ce_oi      = excluded.ce_oi,
            pcr        = excluded.pcr,
            underlying = excluded.underlying,
            max_pain   = excluded.max_pain
    """, rows)


# ── Unified entry point ───────────────────────────────────────────────────────

def process_file(file: str, target_ticker: str | None = None):
    df = pd.read_csv(file, low_memory=False)
    trade_date = pd.to_datetime(df["TradDt"].iloc[0]).strftime("%Y-%m-%d")

    if target_ticker:
        df = df[df["TckrSymb"] == target_ticker]

    futures_df = df[df["FinInstrmTp"].isin(_FUTURES_TYPES)].copy()
    options_df = df[df["FinInstrmTp"].isin(_OPTIONS_TYPES)].copy()

    conn = get_conn()
    try:
        conn.execute(_DROP_INDEXES)
        conn.execute("BEGIN")

        if not futures_df.empty:
            _insert_fo_data(conn, futures_df)
            conn.register("_fut_stage", futures_df)
            _process_futures(conn, trade_date)
            conn.unregister("_fut_stage")

        if not options_df.empty:
            _insert_fo_data(conn, options_df)
            conn.register("_opt_stage", options_df)
            _process_options(conn, trade_date)
            conn.unregister("_opt_stage")

        conn.execute("COMMIT")
        print(f"✓ {trade_date} — {len(futures_df)} futures rows, {len(options_df)} options rows")

    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.execute(_REBUILD_INDEXES)
        conn.close()


def process_trade_date(trade_date: str, target_ticker: str | None = None):
    raw_file = get_raw_fo_path(trade_date)
    if not raw_file.exists():
        raise FileNotFoundError(raw_file)
    process_file(str(raw_file), target_ticker)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse, glob, os

    parser = argparse.ArgumentParser(description="NSE F&O bhav copy processor")
    parser.add_argument("--input",  required=True)
    parser.add_argument("--ticker", default=None)
    args = parser.parse_args()

    files = glob.glob(os.path.join(args.input, "*.csv"))
    if not files:
        print(f"No CSV files found in {args.input}")
    else:
        print(f"Processing {len(files)} file(s)")
        for f in sorted(files):
            process_file(f, args.ticker)
        print("Done.")
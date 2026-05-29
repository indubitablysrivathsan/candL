"""Shared instrument upsert helper — used by all processors."""

import pandas as pd
import duckdb

_INSTR_STR_COLS = [
    "exchange", "segment", "instrument_type", "ticker",
    "instrument_name", "isin", "series", "option_type",
    "underlying_symbol",
]

def upsert_instruments(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    """
    df must have columns matching instruments schema.
    Uses vectorized INSERT via registered DataFrame.
    """

    df = df.copy()
    for col in _INSTR_STR_COLS:
        if col in df.columns:
            df[col] = df[col].where(df[col].notna(), None)
            df[col] = df[col].astype("string")

    conn.register("_instr_stage", df)

    conn.execute("""
        INSERT INTO instruments
        SELECT * FROM _instr_stage
        ON CONFLICT (instrument_key) DO UPDATE SET
            instrument_name   = excluded.instrument_name,
            isin              = excluded.isin,
            lot_size          = excluded.lot_size,
            underlying_symbol = excluded.underlying_symbol,
            actual_expiry     = excluded.actual_expiry,
            is_active         = TRUE
    """)
    conn.unregister("_instr_stage")


def upsert_market_data(conn: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    """Vectorized upsert into market_data_daily."""
    conn.register("_mdd_stage", df)
    conn.execute("""
        INSERT INTO market_data_daily
        SELECT * FROM _mdd_stage
        ON CONFLICT (trade_date, instrument_key) DO UPDATE SET
            open             = excluded.open,
            high             = excluded.high,
            low              = excluded.low,
            close            = excluded.close,
            last             = excluded.last,
            prev_close       = excluded.prev_close,
            avg_price        = excluded.avg_price,
            volume           = excluded.volume,
            turnover         = excluded.turnover,
            trade_count      = excluded.trade_count,
            open_interest    = excluded.open_interest,
            change_in_oi     = excluded.change_in_oi,
            settlement_price = excluded.settlement_price,
            underlying_price = excluded.underlying_price,
            delivery_qty     = excluded.delivery_qty,
            delivery_pct     = excluded.delivery_pct
    """)
    conn.unregister("_mdd_stage")
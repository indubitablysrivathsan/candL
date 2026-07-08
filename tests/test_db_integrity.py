"""
tests/test_db_integrity.py
============================
Covers: database integrity constraints.

Two angles:
  1. Directly exercise the DDL's PRIMARY KEY / UNIQUE INDEX constraints
     with a raw INSERT that bypasses ON CONFLICT, confirming DuckDB
     actually rejects the duplicate (i.e. the constraint is real, not
     just documentation).
  2. After real ingestion via the fixture data, confirm key columns never
     end up NULL (would silently break joins/queries downstream).
"""

import duckdb
import pytest

from tests.conftest import DATE_ROLLOVER
from pipeline.processors.keys import make_instrument_key


# ── constraint enforcement ────────────────────────────────────────────────────

def test_options_analytics_primary_key_rejects_raw_duplicate_insert(tmp_db):
    import api.db as db

    conn = db.get_conn()
    try:
        conn.execute("""
            INSERT INTO options_analytics VALUES
            ('STO', 'TESTCO', '2026-07-30', '2026-07-01', 100, 200, 2.0, 1500, 1480)
        """)
        with pytest.raises(duckdb.ConstraintException):
            conn.execute("""
                INSERT INTO options_analytics VALUES
                ('STO', 'TESTCO', '2026-07-30', '2026-07-01', 999, 999, 1.0, 1500, 1480)
            """)
    finally:
        conn.close()


def test_futures_analytics_primary_key_rejects_raw_duplicate_insert(tmp_db):
    import api.db as db

    conn = db.get_conn()
    try:
        conn.execute("""
            INSERT INTO futures_analytics VALUES
            ('STF', 'TESTCO', '2026-07-30', '2026-07-01', 1.0, 1.0, 1.0, 'long_buildup', 0.5, 0.1, 0.01, 29)
        """)
        with pytest.raises(duckdb.ConstraintException):
            conn.execute("""
                INSERT INTO futures_analytics VALUES
                ('STF', 'TESTCO', '2026-07-30', '2026-07-01', 2.0, 2.0, 2.0, 'short_buildup', 0.6, 0.2, 0.02, 29)
            """)
    finally:
        conn.close()


def test_make_instrument_key_produces_primary_key_identity(tmp_db):
    import api.db as db

    key = make_instrument_key(
        instrument_type="STF",
        ticker="TESTCO",
        expiry="2026-07-30",
        strike=None,
        option_type=None,
        series="XX",
    )

    conn = db.get_conn()
    try:
        conn.execute("""
            INSERT INTO instruments VALUES
            (?, 'NSE', 'FO', 'STF', 1,
             'TESTCO', 'TESTCO-FUT',
             NULL, 'XX',
             '2026-07-30', '2026-07-30',
             NULL, NULL, 100)
        """, [key])

        with pytest.raises(duckdb.ConstraintException):
            conn.execute("""
                INSERT INTO instruments VALUES
                (?, 'NSE', 'FO', 'STF', 2,
                 'TESTCO', 'TESTCO-FUT-DUP',
                 NULL, 'XX',
                 '2026-07-30', '2026-07-30',
                 NULL, NULL, 100)
            """, [key])

    finally:
        conn.close()


def test_market_data_daily_primary_key_rejects_duplicate_trade_date_instrument(tmp_db):
    import api.db as db

    conn = db.get_conn()
    try:
        conn.execute("""
            INSERT INTO instruments VALUES
            (333, 'NSE', 'CM', 'EQ', NULL, 'TESTCO', 'TESTCO', NULL, 'EQ',
             NULL, NULL, NULL, NULL, NULL)
        """)
        conn.execute("""
            INSERT INTO market_data_daily
            (trade_date, instrument_key, open, high, low, close, last, prev_close,
             avg_price, volume, turnover, trade_count, open_interest, change_in_oi,
             settlement_price, underlying_price, delivery_qty, delivery_pct)
            VALUES ('2026-07-01', 333, 100, 105, 99, 102, 102, 101,
                     NULL, 1000, 100000, 50, NULL, NULL, NULL, NULL, NULL, NULL)
        """)
        with pytest.raises(duckdb.ConstraintException):
            conn.execute("""
                INSERT INTO market_data_daily
                (trade_date, instrument_key, open, high, low, close, last, prev_close,
                 avg_price, volume, turnover, trade_count, open_interest, change_in_oi,
                 settlement_price, underlying_price, delivery_qty, delivery_pct)
                VALUES ('2026-07-01', 333, 999, 999, 999, 999, 999, 999,
                         NULL, 1, 1, 1, NULL, NULL, NULL, NULL, NULL, NULL)
            """)
    finally:
        conn.close()


# ── post-ingestion integrity on real fixture data ─────────────────────────────

def test_market_data_daily_has_no_null_keys_after_real_ingestion(isolated_pipeline):
    from pipeline.processors import fo
    import api.db as db

    fo.process(DATE_ROLLOVER)

    conn = db.get_conn(read_only=True)
    try:
        null_count = conn.execute("""
            SELECT COUNT(*) FROM market_data_daily
            WHERE trade_date IS NULL OR instrument_key IS NULL
        """).fetchone()[0]
    finally:
        conn.close()
    assert null_count == 0


def test_instruments_has_no_null_ticker_or_instrument_type_after_real_ingestion(
    isolated_pipeline,
):
    from pipeline.processors import fo
    import api.db as db

    fo.process(DATE_ROLLOVER)

    conn = db.get_conn(read_only=True)
    try:
        null_count = conn.execute("""
            SELECT COUNT(*) FROM instruments
            WHERE ticker IS NULL OR instrument_type IS NULL
        """).fetchone()[0]
    finally:
        conn.close()
    assert null_count == 0


def test_options_analytics_pcr_and_keys_never_null_after_real_ingestion(isolated_pipeline):
    """
    pcr can legitimately be NaN-turned-NULL when ce_oi is 0 (division
    guarded in code), but the identity columns (ticker, expiry, trade_date,
    instrument_type) must never be NULL.
    """
    from pipeline.processors import fo
    import api.db as db

    fo.process(DATE_ROLLOVER)

    conn = db.get_conn(read_only=True)
    try:
        null_count = conn.execute("""
            SELECT COUNT(*) FROM options_analytics
            WHERE ticker IS NULL OR expiry IS NULL
               OR trade_date IS NULL OR instrument_type IS NULL
        """).fetchone()[0]
    finally:
        conn.close()
    assert null_count == 0
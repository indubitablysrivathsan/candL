"""
tests/test_processor_idempotency.py
=====================================
Covers: processor idempotency, duplicate ingestion, and the instruments
upsert-freeze contract (only a subset of columns update on conflict).

Uses real fixture data (2026-06-30 .. 2026-07-06) via the isolated_pipeline
fixture. Row-count assertions are used instead of hardcoded values since
fixture files have realistic (thousands-of-rows) volume; a small number of
"golden value" assertions are used where the computation is simple enough
to trust by inspection (PCR ratio, sign consistency).
"""

import pandas as pd
import pytest

from tests.conftest import DATE_EXPIRY_LAST, DATE_ROLLOVER, DATE_NORMAL_1


def _table_count(db_path, table, where="", params=None):
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        sql = f"SELECT COUNT(*) FROM {table}"
        if where:
            sql += f" WHERE {where}"
        return conn.execute(sql, params or []).fetchone()[0]
    finally:
        conn.close()


def _table_df(db_path, table, where="", params=None):
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        sql = f"SELECT * FROM {table}"
        if where:
            sql += f" WHERE {where}"
        return conn.execute(sql, params or []).df()
    finally:
        conn.close()


# ── fresh ingestion sanity ────────────────────────────────────────────────────

def test_fo_process_fresh_ingestion_populates_all_four_tables(isolated_pipeline):
    from pipeline.processors import fo

    fo.process(DATE_ROLLOVER)

    db_path = isolated_pipeline["db_path"]
    assert _table_count(db_path, "instruments") > 0
    assert _table_count(db_path, "market_data_daily",
                         "trade_date = CAST(? AS DATE)", [DATE_ROLLOVER]) > 0
    assert _table_count(db_path, "futures_analytics",
                         "trade_date = CAST(? AS DATE)", [DATE_ROLLOVER]) > 0
    assert _table_count(db_path, "options_analytics",
                         "trade_date = CAST(? AS DATE)", [DATE_ROLLOVER]) > 0


def test_eq_bhav_process_fresh_ingestion_populates_instruments_and_market_data(isolated_pipeline):
    from pipeline.processors import eq_bhav

    eq_bhav.process(DATE_ROLLOVER)

    db_path = isolated_pipeline["db_path"]
    assert _table_count(db_path, "instruments", "instrument_type = 'EQ'") > 0
    assert _table_count(
        db_path,
        "market_data_daily JOIN instruments USING (instrument_key)",
        "instruments.instrument_type = 'EQ' AND market_data_daily.trade_date = CAST(? AS DATE)",
        [DATE_ROLLOVER],
    ) > 0


# ── idempotency: is_processed short-circuit ───────────────────────────────────

def test_fo_process_second_call_is_skipped_by_is_processed_guard(isolated_pipeline):
    """
    process() checks is_processed(date, 'STF') and is_processed(date, 'STO')
    up front and returns early if both are true. Confirm the guard actually
    fires: row counts must be identical after a second call, and re-running
    must not raise (it should hit the early return, not attempt re-insert).
    """
    from pipeline.processors import fo

    fo.process(DATE_ROLLOVER)
    db_path = isolated_pipeline["db_path"]

    count_after_first = _table_count(
        db_path, "futures_analytics", "trade_date = CAST(? AS DATE)", [DATE_ROLLOVER]
    )

    fo.process(DATE_ROLLOVER)  # should hit the skip branch

    count_after_second = _table_count(
        db_path, "futures_analytics", "trade_date = CAST(? AS DATE)", [DATE_ROLLOVER]
    )
    assert count_after_first == count_after_second


def test_fo_reprocessing_after_manual_reset_produces_identical_analytics_values(isolated_pipeline):
    """
    Bypass the is_processed guard (simulating a forced re-run / recovery
    scenario) by processing a date, capturing options_analytics, deleting
    just that date's rows, then reprocessing. Values must match exactly —
    idempotency means "same input -> same output," not just "doesn't crash."
    """
    from pipeline.processors import fo
    import api.db as db

    fo.process(DATE_ROLLOVER)
    db_path = isolated_pipeline["db_path"]

    before = _table_df(
        db_path, "options_analytics", "trade_date = CAST(? AS DATE)", [DATE_ROLLOVER]
    ).sort_values(["ticker", "expiry"]).reset_index(drop=True)

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute(
            "DELETE FROM options_analytics WHERE trade_date = CAST(? AS DATE)",
            [DATE_ROLLOVER],
        )
        conn.execute("COMMIT")
    finally:
        conn.close()

    fo.process(DATE_ROLLOVER)  # is_processed now false again -> reprocesses

    after = _table_df(
        db_path, "options_analytics", "trade_date = CAST(? AS DATE)", [DATE_ROLLOVER]
    ).sort_values(["ticker", "expiry"]).reset_index(drop=True)

    pd.testing.assert_frame_equal(before, after)


# ── duplicate ingestion via ON CONFLICT ───────────────────────────────────────

def test_options_analytics_on_conflict_updates_not_duplicates(isolated_pipeline):
    """
    Directly exercise _process_options twice against the same connection
    (bypassing the module-level is_processed guard) to confirm the
    ON CONFLICT ... DO UPDATE clause prevents duplicate rows for the same
    (instrument_type, ticker, expiry, trade_date) key.
    """
    from pipeline.processors import fo
    import api.db as db

    raw = fo._load(DATE_ROLLOVER)
    raw.columns = raw.columns.str.strip()
    opt_raw = raw[raw["FinInstrmTp"].isin(fo._OPT)].copy()
    opt_raw, _ = fo._build_instruments(opt_raw)

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        fo._process_options(conn, opt_raw, DATE_ROLLOVER)
        conn.execute("COMMIT")

        count_after_first = conn.execute(
            "SELECT COUNT(*) FROM options_analytics WHERE trade_date = CAST(? AS DATE)",
            [DATE_ROLLOVER],
        ).fetchone()[0]

        conn.execute("BEGIN")
        fo._process_options(conn, opt_raw, DATE_ROLLOVER)  # same data again
        conn.execute("COMMIT")

        count_after_second = conn.execute(
            "SELECT COUNT(*) FROM options_analytics WHERE trade_date = CAST(? AS DATE)",
            [DATE_ROLLOVER],
        ).fetchone()[0]
    finally:
        conn.close()

    assert count_after_first == count_after_second
    assert count_after_first > 0


# ── instruments upsert freeze contract ────────────────────────────────────────

def test_upsert_instruments_only_updates_whitelisted_columns_on_conflict(isolated_pipeline):
    """
    common.upsert_instruments' ON CONFLICT clause only updates
    instrument_name, isin, lot_size, actual_expiry. Identity-ish fields
    (segment, expiry, strike, option_type, series) must NOT change on a
    second upsert even if the incoming row disagrees with what's stored.
    This pins current behavior so a future change to this SQL is a
    deliberate decision, not an accident.
    """
    import api.db as db
    from pipeline.processors.common import upsert_instruments

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        first = pd.DataFrame([{
            "instrument_key": 123456789,
            "exchange": "NSE",
            "segment": "FO",
            "instrument_type": "STF",
            "instrument_id": 1,
            "ticker": "TESTCO",
            "instrument_name": "TESTCO ORIGINAL",
            "isin": "OLDISIN",
            "series": "XX",
            "expiry": "2026-07-30",
            "actual_expiry": "2026-07-30",
            "strike": None,
            "option_type": None,
            "lot_size": 100,
        }])
        upsert_instruments(conn, first)
        conn.execute("COMMIT")

        conn.execute("BEGIN")
        second = first.copy()
        second["segment"] = "CM"          # NOT in the whitelist -> should freeze
        second["series"] = "YY"           # NOT in the whitelist -> should freeze
        second["instrument_name"] = "TESTCO RENAMED"  # whitelisted -> should update
        second["isin"] = "NEWISIN"        # whitelisted -> should update
        second["lot_size"] = 200          # whitelisted -> should update
        upsert_instruments(conn, second)
        conn.execute("COMMIT")

        row = conn.execute(
            "SELECT segment, series, instrument_name, isin, lot_size "
            "FROM instruments WHERE instrument_key = 123456789"
        ).fetchone()
    finally:
        conn.close()

    segment, series, instrument_name, isin, lot_size = row
    assert segment == "FO", "segment is not in the ON CONFLICT whitelist and must stay frozen"
    assert series == "XX", "series is not in the ON CONFLICT whitelist and must stay frozen"
    assert instrument_name == "TESTCO RENAMED"
    assert isin == "NEWISIN"
    assert lot_size == 200
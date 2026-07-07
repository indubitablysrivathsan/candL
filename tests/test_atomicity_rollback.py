"""
tests/test_atomicity_rollback.py
==================================
Covers: atomicity/rollback behavior and failed-processing recovery.

fo.py, eq_bhav.py, cm_bhav.py, fii.py, participant.py all use
conn.execute("BEGIN"/"COMMIT"/"ROLLBACK"). mkt_act.py uses
conn.begin()/conn.commit()/conn.rollback(). Both styles are tested here
since a DuckDB behavior difference between them would otherwise go
unnoticed until it broke something in production.

Recovery tests simulate a processor failing partway through and confirm:
  1. no partial rows are left in the DB (atomicity holds)
  2. a subsequent clean run succeeds and produces the same result as if
     the failure had never happened (recovery is not just "doesn't
     crash" but "converges to the correct state")
"""

import pandas as pd
import pytest

from tests.conftest import DATE_ROLLOVER, DATE_NORMAL_1


def _count(where=None, table="market_data_daily", params=None):
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        sql = f"SELECT COUNT(*) FROM {table}"
        if where:
            sql += f" WHERE {where}"
        return conn.execute(sql, params or []).fetchone()[0]
    finally:
        conn.close()


# ── fo.py atomicity (conn.execute("BEGIN"/"COMMIT"/"ROLLBACK") style) ────────

def test_fo_process_rolls_back_instruments_and_market_data_on_options_failure(
    isolated_pipeline, monkeypatch
):
    """
    _process_options runs after upsert_instruments/upsert_market_data inside
    the same transaction. If it raises, everything from this call — not
    just the options step — must be rolled back.
    """
    from pipeline.processors import fo

    original_process_options = fo._process_options

    def failing_process_options(conn, df, trade_date):
        original_process_options(conn, df, trade_date)  # let it actually insert
        raise RuntimeError("simulated failure after insert")

    monkeypatch.setattr(fo, "_process_options", failing_process_options)

    with pytest.raises(RuntimeError, match="simulated failure"):
        fo.process(DATE_ROLLOVER)

    # everything inserted earlier in the same transaction must be gone
    assert _count(
        "trade_date = CAST(? AS DATE)", "market_data_daily", [DATE_ROLLOVER]
    ) == 0
    assert _count(
        "trade_date = CAST(? AS DATE)", "options_analytics", [DATE_ROLLOVER]
    ) == 0
    assert _count(
        "trade_date = CAST(? AS DATE)", "futures_analytics", [DATE_ROLLOVER]
    ) == 0


def test_fo_process_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    """
    After a forced failure + rollback, a normal (unpatched) re-run must
    succeed and populate all four tables — recovery converges to the
    correct end state, not a stuck/partial one.
    """
    from pipeline.processors import fo

    original_process_options = fo._process_options
    monkeypatch.setattr(
        fo, "_process_options",
        lambda conn, df, trade_date: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        fo.process(DATE_ROLLOVER)

    assert _count("trade_date = CAST(? AS DATE)", "market_data_daily", [DATE_ROLLOVER]) == 0

    monkeypatch.setattr(fo, "_process_options", original_process_options)
    fo.process(DATE_ROLLOVER)  # clean retry

    assert _count("trade_date = CAST(? AS DATE)", "market_data_daily", [DATE_ROLLOVER]) > 0
    assert _count("trade_date = CAST(? AS DATE)", "options_analytics", [DATE_ROLLOVER]) > 0
    assert _count("trade_date = CAST(? AS DATE)", "futures_analytics", [DATE_ROLLOVER]) > 0


# ── eq_bhav.py atomicity ───────────────────────────────────────────────────────

def test_eq_bhav_process_rolls_back_instruments_on_market_data_failure(
    isolated_pipeline, monkeypatch
):
    """
    upsert_instruments runs before upsert_market_data in the same
    transaction. If upsert_market_data fails, the instruments insert from
    this same call must also be undone.
    """
    from pipeline.processors import eq_bhav

    def failing_upsert_market_data(conn, df):
        raise RuntimeError("simulated market_data failure")

    monkeypatch.setattr(eq_bhav, "upsert_market_data", failing_upsert_market_data)

    with pytest.raises(RuntimeError, match="simulated market_data failure"):
        eq_bhav.process(DATE_ROLLOVER)

    assert _count("instrument_type = 'EQ'", "instruments") == 0
    assert _count(
        "instruments.instrument_type = 'EQ' AND market_data_daily.trade_date = CAST(? AS DATE)",
        "market_data_daily JOIN instruments USING (instrument_key)",
        [DATE_ROLLOVER],
    ) == 0


def test_eq_bhav_process_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    from pipeline.processors import eq_bhav

    original = eq_bhav.upsert_market_data
    monkeypatch.setattr(
        eq_bhav, "upsert_market_data",
        lambda conn, df: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        eq_bhav.process(DATE_ROLLOVER)

    assert _count("instrument_type = 'EQ'", "instruments") == 0

    monkeypatch.setattr(eq_bhav, "upsert_market_data", original)
    eq_bhav.process(DATE_ROLLOVER)

    assert _count("instrument_type = 'EQ'", "instruments") > 0


# ── mkt_act.py atomicity (conn.begin()/commit()/rollback() style) ────────────

def test_mkt_act_process_rolls_back_summary_on_downstream_failure(isolated_pipeline, monkeypatch):
    """
    mkt_act.py uses conn.begin()/conn.commit()/conn.rollback() -- a
    different API surface than fo.py's conn.execute("BEGIN"). Confirm this
    style rolls back correctly too: _write inserts market_activity_summary
    first, then index rows, then breadth. Forcing a failure after the
    summary insert must undo the summary insert as well.
    """
    from pipeline.processors import mkt_act

    original_write = mkt_act._write

    def failing_write(conn, parsed, trade_date):
        original_write(conn, parsed, trade_date)  # real insert happens
        raise RuntimeError("simulated failure after write")

    monkeypatch.setattr(mkt_act, "_write", failing_write)

    with pytest.raises(RuntimeError, match="simulated failure"):
        mkt_act.process(DATE_ROLLOVER)

    assert _count(
        "trade_date = CAST(? AS DATE)", "market_activity_summary", [DATE_ROLLOVER]
    ) == 0
    assert _count(
        "trade_date = CAST(? AS DATE)", "market_activity_breadth", [DATE_ROLLOVER]
    ) == 0


def test_mkt_act_process_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    from pipeline.processors import mkt_act

    original_write = mkt_act._write
    monkeypatch.setattr(
        mkt_act, "_write",
        lambda conn, parsed, trade_date: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        mkt_act.process(DATE_ROLLOVER)

    assert _count(
        "trade_date = CAST(? AS DATE)", "market_activity_summary", [DATE_ROLLOVER]
    ) == 0

    monkeypatch.setattr(mkt_act, "_write", original_write)
    mkt_act.process(DATE_ROLLOVER)

    assert _count(
        "trade_date = CAST(? AS DATE)", "market_activity_summary", [DATE_ROLLOVER]
    ) > 0
    assert _count(
        "trade_date = CAST(? AS DATE)", "market_activity_breadth", [DATE_ROLLOVER]
    ) > 0


# ── manifest-level recovery: failed status is retried by is_processed check ──

def test_manifest_marked_failed_date_is_retried_and_succeeds(isolated_pipeline, tmp_manifest):
    """
    Simulates the real recovery path used by startup_sync: a date is marked
    'failed' in the manifest (e.g. after a crash), and DB state for that
    date is empty. A subsequent processor call must succeed and the
    manifest can then be updated to reflect success.
    """
    from pipeline.processors import fo
    import pipeline.manifest as m

    m.mark_failed(DATE_NORMAL_1)
    row = m.load_manifest()
    row = row[row["trade_date"] == DATE_NORMAL_1].iloc[0]
    assert row["status"] == "failed"

    # DB has nothing for this date yet (fixture manifest flags don't
    # actually gate the processor -- is_processed reads the DB directly)
    assert _count("trade_date = CAST(? AS DATE)", "market_data_daily", [DATE_NORMAL_1]) == 0

    fo.process(DATE_NORMAL_1)  # retry

    assert _count("trade_date = CAST(? AS DATE)", "market_data_daily", [DATE_NORMAL_1]) > 0

    m.mark_downloaded(DATE_NORMAL_1)
    row = m.load_manifest()
    row = row[row["trade_date"] == DATE_NORMAL_1].iloc[0]
    assert row["status"] == "complete"
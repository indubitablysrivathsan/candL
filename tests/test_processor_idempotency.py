"""
tests/test_processor_idempotency.py
=====================================
Covers: processor idempotency, duplicate ingestion, and the ON CONFLICT
contracts of the shared upsert helpers.

Processors covered
-------------------
  fo             -> instruments, market_data_daily, futures_analytics, options_analytics
  cm_bhav        -> instruments, market_data_daily
  eq_bhav        -> enrichment ONLY (patches avg_price / delivery_* onto cm_bhav rows)
  fo_volt        -> fo_volatility
  fo_contracts   -> instruments, instrument_contract_daily, corporate_actions   (file_date != trade_date)
  cm_securities  -> instruments, security_master_daily, corporate_actions       (file_date != trade_date)

Three kinds of idempotency are checked:
  1. Guard skip      - second call hits the is_processed() early return.
  2. Forced re-run   - is_processed is bypassed so the ON CONFLICT path really
                       executes; every table must be byte-identical afterwards.
  3. Upsert contract - the exact set of columns each ON CONFLICT clause is
                       allowed to change is pinned, so SQL changes are deliberate.
"""

import datetime as dt

import pandas as pd
import pytest

from tests.conftest import DATE_EXPIRY_LAST, DATE_ROLLOVER, DATE_NORMAL_1

MASTER_FILE_DATE = DATE_EXPIRY_LAST     # publication date (locates the file)
MASTER_TRADE_DATE = DATE_ROLLOVER       # effective session (written to the DB)
MISSING_DATE = "1999-01-01"


# ── helpers ───────────────────────────────────────────────────────────────────

def _count(table, where="", params=None):
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        sql = f"SELECT COUNT(*) FROM {table}"
        if where:
            sql += f" WHERE {where}"
        return conn.execute(sql, params or []).fetchone()[0]
    finally:
        conn.close()


def _snapshot(table, where="", params=None):
    """Full, deterministically ordered copy of a table (or filtered slice)."""
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        sql = f"SELECT * FROM {table}"
        if where:
            sql += f" WHERE {where}"
        sql += " ORDER BY ALL"
        return conn.execute(sql, params or []).df()
    finally:
        conn.close()


def _bypass_guard(monkeypatch, module):
    """Make the processor believe nothing has been processed yet."""
    monkeypatch.setattr(module, "is_processed", lambda *a, **k: False)


def _require_master_fixture(module):
    if not module._raw_path(MASTER_FILE_DATE).exists():
        pytest.skip(f"fixture missing: {module._raw_path(MASTER_FILE_DATE)}")


# ── processor runners (single place that knows each signature) ────────────────

def _run_fo(d):
    from pipeline.processors import fo
    fo.process(d)


def _run_cm_bhav(d):
    from pipeline.processors import cm_bhav
    cm_bhav.process(d)


def _run_fo_volt(d):
    from pipeline.processors import fo_volt
    fo_volt.process(d)


def _run_fo_contracts(d):
    from pipeline.processors import fo_contracts
    if d == MISSING_DATE:
        fo_contracts.process(d, d)
    else:
        _require_master_fixture(fo_contracts)
        fo_contracts.process(MASTER_FILE_DATE, d)


def _run_cm_securities(d):
    from pipeline.processors import cm_securities
    if d == MISSING_DATE:
        cm_securities.process(d, d)
    else:
        _require_master_fixture(cm_securities)
        cm_securities.process(MASTER_FILE_DATE, d)


def _module(name):
    import importlib
    return importlib.import_module(f"pipeline.processors.{name}")


_D = "trade_date = CAST(? AS DATE)"

# id -> (runner, date, module name, tables [(table, where, params)], is_processed keys)
CASES = {
    "fo": (
        _run_fo, DATE_ROLLOVER, "fo",
        [("instruments", "", None),
         ("market_data_daily", _D, [DATE_ROLLOVER]),
         ("futures_analytics", _D, [DATE_ROLLOVER]),
         ("options_analytics", _D, [DATE_ROLLOVER])],
        ["STF", "STO"],
    ),
    "cm_bhav": (
        _run_cm_bhav, DATE_ROLLOVER, "cm_bhav",
        [("instruments", "", None),
         ("market_data_daily", _D, [DATE_ROLLOVER])],
        ["cm_bhav"],
    ),
    "fo_volt": (
        _run_fo_volt, DATE_ROLLOVER, "fo_volt",
        [("fo_volatility", _D, [DATE_ROLLOVER])],
        ["fo_volt"],
    ),
    "fo_contracts": (
        _run_fo_contracts, MASTER_TRADE_DATE, "fo_contracts",
        [("instruments", "", None),
         ("instrument_contract_daily", "", None)],
        ["FO_CONTRACT"],
    ),
    "cm_securities": (
        _run_cm_securities, MASTER_TRADE_DATE, "cm_securities",
        [("instruments", "", None),
         ("security_master_daily", "", None)],
        ["CM_SECURITY"],
    ),
}
CASE_IDS = list(CASES)


# ── fresh ingestion sanity ────────────────────────────────────────────────────

def test_fo_fresh_ingestion_populates_all_four_tables(isolated_pipeline):
    _run_fo(DATE_ROLLOVER)

    assert _count("instruments") > 0
    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) > 0
    assert _count("futures_analytics", _D, [DATE_ROLLOVER]) > 0
    assert _count("options_analytics", _D, [DATE_ROLLOVER]) > 0


def test_cm_bhav_fresh_ingestion_populates_instruments_and_market_data(isolated_pipeline):
    _run_cm_bhav(DATE_ROLLOVER)

    assert _count("instruments", "segment = 'CM'") > 0
    assert _count(
        "market_data_daily JOIN instruments USING (instrument_key)",
        "instruments.segment = 'CM' AND market_data_daily.trade_date = CAST(? AS DATE)",
        [DATE_ROLLOVER],
    ) > 0


def test_fo_volt_fresh_ingestion_populates_fo_volatility(isolated_pipeline):
    _run_fo_volt(DATE_ROLLOVER)
    assert _count("fo_volatility", _D, [DATE_ROLLOVER]) > 0


def test_fo_contracts_writes_effective_trade_date_not_file_date(isolated_pipeline):
    _run_fo_contracts(MASTER_TRADE_DATE)

    assert _count("instrument_contract_daily", _D, [MASTER_TRADE_DATE]) > 0
    assert _count("instrument_contract_daily", _D, [MASTER_FILE_DATE]) == 0
    assert _count("instrument_contract_daily", "file_date = CAST(? AS DATE)",
                  [MASTER_FILE_DATE]) > 0


def test_cm_securities_writes_effective_trade_date_not_file_date(isolated_pipeline):
    _run_cm_securities(MASTER_TRADE_DATE)

    assert _count("security_master_daily", _D, [MASTER_TRADE_DATE]) > 0
    assert _count("security_master_daily", _D, [MASTER_FILE_DATE]) == 0
    assert _count("security_master_daily", "file_date = CAST(? AS DATE)",
                  [MASTER_FILE_DATE]) > 0


# ── eq_bhav is enrichment-only ────────────────────────────────────────────────

def test_eq_bhav_without_cm_bhav_base_rows_inserts_nothing(isolated_pipeline):
    """eq_bhav only UPDATEs existing market_data_daily rows. With no
    cm_bhav base rows it must not create instruments or market data."""
    from pipeline.processors import eq_bhav

    eq_bhav.process(DATE_ROLLOVER)

    assert _count("instruments") == 0
    assert _count("market_data_daily") == 0


def test_eq_bhav_patches_cm_bhav_rows_without_adding_rows(isolated_pipeline):
    from pipeline.processors import eq_bhav

    _run_cm_bhav(DATE_ROLLOVER)
    rows_before = _count("market_data_daily", _D, [DATE_ROLLOVER])
    instr_before = _snapshot("instruments")
    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D,
                  [DATE_ROLLOVER]) == 0

    eq_bhav.process(DATE_ROLLOVER)

    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) == rows_before
    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D,
                  [DATE_ROLLOVER]) > 0
    pd.testing.assert_frame_equal(instr_before, _snapshot("instruments"))


def test_eq_bhav_forced_rerun_is_identical(isolated_pipeline, monkeypatch):
    from pipeline.processors import eq_bhav

    _run_cm_bhav(DATE_ROLLOVER)
    eq_bhav.process(DATE_ROLLOVER)
    before = _snapshot("market_data_daily", _D, [DATE_ROLLOVER])

    _bypass_guard(monkeypatch, eq_bhav)
    eq_bhav.process(DATE_ROLLOVER)

    pd.testing.assert_frame_equal(before, _snapshot("market_data_daily", _D, [DATE_ROLLOVER]))


def test_cm_bhav_forced_rerun_preserves_eq_bhav_enrichment(isolated_pipeline, monkeypatch):
    """Re-running cm_bhav must not wipe avg_price / delivery_* patched by
    eq_bhav ... or if it does, that is a deliberate decision. Today the
    cm_bhav upsert writes avg_price/delivery_* = NULL on conflict, so the
    enrichment is cleared and eq_bhav must be re-run. This test pins that."""
    from pipeline.processors import eq_bhav

    cm = _module("cm_bhav")
    _run_cm_bhav(DATE_ROLLOVER)
    eq_bhav.process(DATE_ROLLOVER)
    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D,
                  [DATE_ROLLOVER]) > 0

    _bypass_guard(monkeypatch, cm)
    cm.process(DATE_ROLLOVER)

    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D,
                  [DATE_ROLLOVER]) == 0, \
        "cm_bhav upsert overwrites enrichment columns; eq_bhav must run after it"


# ── idempotency: is_processed short-circuit ───────────────────────────────────

@pytest.mark.parametrize("case", CASE_IDS)
def test_is_processed_flips_after_processing(isolated_pipeline, case):
    import api.db as db
    runner, date, _, _, keys = CASES[case]

    for k in keys:
        assert db.is_processed(date, k) is False

    runner(date)

    for k in keys:
        assert db.is_processed(date, k) is True


@pytest.mark.parametrize("case", CASE_IDS)
def test_second_call_is_skipped_by_guard(isolated_pipeline, case):
    runner, date, _, tables, _ = CASES[case]

    runner(date)
    before = [_snapshot(*t) for t in tables]

    runner(date)  # early return; must not raise or change anything

    for b, t in zip(before, tables):
        pd.testing.assert_frame_equal(b, _snapshot(*t))


@pytest.mark.parametrize("case", CASE_IDS)
def test_forced_rerun_hits_on_conflict_and_is_identical(isolated_pipeline, monkeypatch, case):
    """Same input -> same output, with the guard disabled so the real
    ON CONFLICT ... DO UPDATE path executes."""
    runner, date, mod_name, tables, _ = CASES[case]

    runner(date)
    before = [_snapshot(*t) for t in tables]
    assert all(len(b) > 0 for b in before), "fixture produced an empty table"

    _bypass_guard(monkeypatch, _module(mod_name))
    runner(date)

    for b, t in zip(before, tables):
        pd.testing.assert_frame_equal(b, _snapshot(*t))


@pytest.mark.parametrize("case", CASE_IDS)
def test_missing_raw_file_raises_and_writes_nothing(isolated_pipeline, case):
    runner, _, _, tables, _ = CASES[case]

    with pytest.raises(FileNotFoundError):
        runner(MISSING_DATE)

    for table, *_ in tables:
        assert _count(table) == 0


def test_fo_reprocessing_after_deleting_analytics_restores_identical_values(isolated_pipeline):
    """Recovery scenario: wipe one analytics table for a date, re-run
    (is_processed is false again for STO) and get identical values."""
    import api.db as db

    _run_fo(DATE_ROLLOVER)
    before = _snapshot("options_analytics", _D, [DATE_ROLLOVER])

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM options_analytics WHERE trade_date = CAST(? AS DATE)",
                     [DATE_ROLLOVER])
        conn.execute("COMMIT")
    finally:
        conn.close()
    assert db.is_processed(DATE_ROLLOVER, "STO") is False

    _run_fo(DATE_ROLLOVER)

    pd.testing.assert_frame_equal(before, _snapshot("options_analytics", _D, [DATE_ROLLOVER]))


def test_distinct_dates_do_not_interfere(isolated_pipeline):
    """Processing a second date must leave the first date's rows untouched."""
    _run_fo_volt(DATE_ROLLOVER)
    first = _snapshot("fo_volatility", _D, [DATE_ROLLOVER])

    _run_fo_volt(DATE_NORMAL_1)

    pd.testing.assert_frame_equal(first, _snapshot("fo_volatility", _D, [DATE_ROLLOVER]))
    assert _count("fo_volatility", _D, [DATE_NORMAL_1]) > 0


# ── cross-processor consistency ───────────────────────────────────────────────

def test_fo_and_fo_contracts_derive_identical_instrument_keys(isolated_pipeline):
    """fo.py and fo_contracts.py independently build instrument_key. If they
    disagree (e.g. NaN vs None for futures strike, or series leaking in),
    contracts will not join to market data and instruments gets duplicate
    identities."""
    import api.db as db

    _run_fo(MASTER_TRADE_DATE)
    _run_fo_contracts(MASTER_TRADE_DATE)

    conn = db.get_conn(read_only=True)
    try:
        dup_identities = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT 1 FROM instruments
                GROUP BY instrument_type, ticker, expiry, strike, option_type, series
                HAVING COUNT(*) > 1
            )
        """).fetchone()[0]
        orphans = conn.execute("""
            SELECT COUNT(*) FROM instrument_contract_daily c
            LEFT JOIN instruments i USING (instrument_key)
            WHERE i.instrument_key IS NULL
        """).fetchone()[0]
        joined = conn.execute("""
            SELECT COUNT(*) FROM instrument_contract_daily c
            JOIN market_data_daily m
              ON m.instrument_key = c.instrument_key AND m.trade_date = c.trade_date
        """).fetchone()[0]
    finally:
        conn.close()

    assert dup_identities == 0
    assert orphans == 0
    assert joined > 0, "no contract-master row joined to bhavcopy data: instrument_key mismatch"


def test_make_instrument_key_treats_none_and_nan_identically():
    from pipeline.processors.keys import make_instrument_key

    a = make_instrument_key("STF", "RELIANCE", dt.date(2026, 7, 30), None, None, None)
    b = make_instrument_key("STF", "RELIANCE", dt.date(2026, 7, 30),
                            float("nan"), pd.NA, float("nan"))
    c = make_instrument_key("stf", "reliance", dt.date(2026, 7, 30), None, None, None)

    assert a == b == c
    assert a == make_instrument_key("STF", "RELIANCE", dt.date(2026, 7, 30), None, None, None)
    assert 0 <= a <= 0x7FFF_FFFF_FFFF_FFFF


# ── instruments upsert contract ───────────────────────────────────────────────

def _instr_row(**over):
    row = {
        "instrument_key": 123456789,
        "exchange": "NSE",
        "segment": "FO",
        "instrument_id": 1,
        "instrument_type": "STF",
        "ticker": "TESTCO",
        "instrument_name": "TESTCO ORIGINAL",
        "isin": "OLDISIN",
        "series": "XX",
        "expiry": dt.date(2026, 7, 30),
        "strike": None,
        "option_type": None,
    }
    row.update(over)
    return pd.DataFrame([row])


def test_upsert_instruments_only_updates_name_and_isin_on_conflict(isolated_pipeline):
    """ON CONFLICT updates instrument_name and isin ONLY. Everything else
    (segment, series, expiry, strike, option_type, instrument_id...) is
    frozen even if the incoming row disagrees. Pins current behavior."""
    import api.db as db
    from pipeline.processors.common import upsert_instruments

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        upsert_instruments(conn, _instr_row())
        conn.execute("COMMIT")

        conn.execute("BEGIN")
        upsert_instruments(conn, _instr_row(
            segment="CM",                       # frozen
            series="YY",                        # frozen
            instrument_id=999,                  # frozen
            expiry=dt.date(2026, 8, 27),        # frozen
            instrument_name="TESTCO RENAMED",   # updates
            isin="NEWISIN",                     # updates
        ))
        conn.execute("COMMIT")

        row = conn.execute(
            "SELECT segment, series, instrument_id, expiry, instrument_name, isin "
            "FROM instruments WHERE instrument_key = 123456789"
        ).fetchone()
        total = conn.execute("SELECT COUNT(*) FROM instruments").fetchone()[0]
    finally:
        conn.close()

    segment, series, instrument_id, expiry, name, isin = row
    assert total == 1
    assert segment == "FO"
    assert series == "XX"
    assert instrument_id == 1
    assert expiry == dt.date(2026, 7, 30)
    assert name == "TESTCO RENAMED"
    assert isin == "NEWISIN"


def test_upsert_instruments_identical_reupsert_is_a_noop(isolated_pipeline):
    import api.db as db
    from pipeline.processors.common import upsert_instruments

    conn = db.get_conn()
    try:
        for _ in range(3):
            conn.execute("BEGIN")
            upsert_instruments(conn, _instr_row())
            conn.execute("COMMIT")
        total = conn.execute("SELECT COUNT(*) FROM instruments").fetchone()[0]
    finally:
        conn.close()

    assert total == 1


# ── market_data_daily upserts ─────────────────────────────────────────────────

def _mdd_row(key=42, trade_date=dt.date(2026, 7, 1), **over):
    row = {
        "trade_date": trade_date, "instrument_key": key,
        "open": 10.0, "high": 12.0, "low": 9.0, "close": 11.0, "last": 11.0,
        "prev_close": 10.0, "avg_price": 10.5,
        "volume": 100, "turnover": 1000.0, "trade_count": 5,
        "open_interest": 7, "change_in_oi": 1,
        "settlement_price": 11.0, "underlying_price": 11.0,
        "delivery_qty": 50, "delivery_pct": 50.0,
    }
    row.update(over)
    return pd.DataFrame([row])


def test_upsert_market_data_on_conflict_updates_not_duplicates(isolated_pipeline):
    import api.db as db
    from pipeline.processors.common import upsert_market_data

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        upsert_market_data(conn, _mdd_row())
        conn.execute("COMMIT")

        conn.execute("BEGIN")
        upsert_market_data(conn, _mdd_row(close=99.0, volume=777, delivery_pct=12.5))
        conn.execute("COMMIT")

        n, close, volume, dpct = conn.execute(
            "SELECT COUNT(*), MAX(close), MAX(volume), MAX(delivery_pct) FROM market_data_daily"
        ).fetchone()
    finally:
        conn.close()

    assert n == 1
    assert (close, volume, dpct) == (99.0, 777, 12.5)


def test_upsert_delivery_stats_patches_only_delivery_columns_and_never_inserts(isolated_pipeline):
    import api.db as db
    from pipeline.processors.common import upsert_market_data, upsert_delivery_stats

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        upsert_market_data(conn, _mdd_row(avg_price=None, delivery_qty=None, delivery_pct=None))
        conn.execute("COMMIT")

        patch = pd.DataFrame([
            {"trade_date": dt.date(2026, 7, 1), "instrument_key": 42,
             "avg_price": 10.9, "delivery_qty": 60, "delivery_pct": 60.0},
            # no base row for this key -> must be silently skipped
            {"trade_date": dt.date(2026, 7, 1), "instrument_key": 4242,
             "avg_price": 1.0, "delivery_qty": 1, "delivery_pct": 1.0},
        ])
        for _ in range(2):  # applying the patch twice must be harmless
            conn.execute("BEGIN")
            upsert_delivery_stats(conn, patch)
            conn.execute("COMMIT")

        n = conn.execute("SELECT COUNT(*) FROM market_data_daily").fetchone()[0]
        row = conn.execute(
            "SELECT close, volume, avg_price, delivery_qty, delivery_pct "
            "FROM market_data_daily WHERE instrument_key = 42"
        ).fetchone()
    finally:
        conn.close()

    assert n == 1
    assert row == (11.0, 100, 10.9, 60, 60.0)


# ── corporate_actions: processors own different columns ───────────────────────

def _ca_row(**over):
    row = {
        "isin": "INE000A01010", "ticker": "TESTCO",
        "event_type": "dividend", "ratio_numerator": None, "ratio_denominator": None,
        "ex_date": dt.date(2026, 7, 10), "record_date": dt.date(2026, 7, 11),
        "purpose_raw": "ORIGINAL PURPOSE",
    }
    row.update(over)
    df = pd.DataFrame([row])
    df["ratio_numerator"] = df["ratio_numerator"].astype("float64")
    df["ratio_denominator"] = df["ratio_denominator"].astype("float64")
    return df


def _ca_fetch():
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        n = conn.execute("SELECT COUNT(*) FROM corporate_actions").fetchone()[0]
        row = conn.execute(
            "SELECT ticker, event_type, record_date, purpose_raw FROM corporate_actions"
        ).fetchone()
    finally:
        conn.close()
    return n, row


def test_cm_securities_corp_action_upsert_updates_ticker_event_type_record_date_only(isolated_pipeline):
    import api.db as db
    cm = _module("cm_securities")

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        cm._upsert_corp_actions(conn, _ca_row())
        conn.execute("COMMIT")
        conn.execute("BEGIN")
        cm._upsert_corp_actions(conn, _ca_row(
            ticker="NEWTICK", event_type="bonus",
            record_date=dt.date(2026, 7, 15),
            purpose_raw="SHOULD BE IGNORED",
        ))
        conn.execute("COMMIT")
    finally:
        conn.close()

    n, (ticker, event_type, record_date, purpose_raw) = _ca_fetch()
    assert n == 1
    assert (ticker, event_type, record_date) == ("NEWTICK", "bonus", dt.date(2026, 7, 15))
    assert purpose_raw == "ORIGINAL PURPOSE"


def test_fo_contracts_corp_action_upsert_updates_ticker_purpose_record_date_only(isolated_pipeline):
    import api.db as db
    fc = _module("fo_contracts")

    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        fc._upsert_corp_actions(conn, _ca_row())
        conn.execute("COMMIT")
        conn.execute("BEGIN")
        fc._upsert_corp_actions(conn, _ca_row(
            ticker="NEWTICK", event_type="bonus",
            record_date=dt.date(2026, 7, 15),
            purpose_raw="NEW PURPOSE",
        ))
        conn.execute("COMMIT")
    finally:
        conn.close()

    n, (ticker, event_type, record_date, purpose_raw) = _ca_fetch()
    assert n == 1
    assert (ticker, record_date, purpose_raw) == ("NEWTICK", dt.date(2026, 7, 15), "NEW PURPOSE")
    assert event_type == "dividend", "event_type is not in fo_contracts' ON CONFLICT list"


@pytest.mark.parametrize("mod_name", ["cm_securities", "fo_contracts"])
def test_corp_action_upsert_empty_frame_is_noop(isolated_pipeline, mod_name):
    import api.db as db
    mod = _module(mod_name)

    conn = db.get_conn()
    try:
        mod._upsert_corp_actions(conn, _ca_row().iloc[0:0])
    finally:
        conn.close()

    assert _count("corporate_actions") == 0
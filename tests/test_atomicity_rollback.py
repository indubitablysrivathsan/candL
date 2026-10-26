"""
tests/test_atomicity_rollback.py
==================================
Covers: atomicity/rollback behavior and failed-processing recovery.

Transaction styles in the codebase
-----------------------------------
  conn.execute("BEGIN"/"COMMIT"/"ROLLBACK"):
      fo, cm_bhav, eq_bhav, fo_volt, fo_contracts, cm_securities (+ fii, participant)
  conn.begin()/commit()/rollback():
      mkt_act

Processor write order (what "partial" means for each)
-------------------------------------------------------
  fo             instruments -> market_data_daily -> options/futures analytics
  cm_bhav        instruments -> market_data_daily
  eq_bhav        UPDATE market_data_daily (avg_price / delivery_*)   [enrichment only]
  fo_volt        fo_volatility
  fo_contracts   instruments -> instrument_contract_daily -> corporate_actions
  cm_securities  instruments -> security_master_daily     -> corporate_actions

Two layers of tests
--------------------
  1. Generic, parametrized over every BEGIN/COMMIT processor: the real
     connection is wrapped so COMMIT raises. Whatever the processor wrote
     before that point must be fully undone, the DB must stay usable, and a
     clean retry must converge to the SAME state as a run that never failed.
  2. Targeted: a failure injected mid-pipeline (after earlier steps really
     executed) to prove earlier steps roll back with the later one.
"""

import importlib

import pandas as pd
import pytest

from tests.conftest import DATE_EXPIRY_LAST, DATE_ROLLOVER, DATE_NORMAL_1

MASTER_FILE_DATE = DATE_EXPIRY_LAST
MASTER_TRADE_DATE = DATE_ROLLOVER
_D = "trade_date = CAST(? AS DATE)"


# ── helpers ───────────────────────────────────────────────────────────────────

def _count(table, where=None, params=None):
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        sql = f"SELECT COUNT(*) FROM {table}"
        if where:
            sql += f" WHERE {where}"
        return conn.execute(sql, params or []).fetchone()[0]
    finally:
        conn.close()


def _snapshot(table, where=None, params=None):
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


def _module(name):
    return importlib.import_module(f"pipeline.processors.{name}")


def _require_master_fixture(mod_name):
    mod = _module(mod_name)
    if not mod._raw_path(MASTER_FILE_DATE).exists():
        pytest.skip(f"fixture missing: {mod._raw_path(MASTER_FILE_DATE)} "
                    f"(see conftest patch_raw_roots for the expected folder)")


class _FailOnCommit:
    """Delegates to a real DuckDB connection but raises on COMMIT, so
    everything the processor did inside its transaction is still pending
    when the failure hits its except/ROLLBACK path."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, *args, **kwargs):
        if isinstance(sql, str) and sql.strip().upper() == "COMMIT":
            raise RuntimeError("simulated commit failure")
        return self._conn.execute(sql, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _commit_fails(monkeypatch, mod_name):
    """Context manager: processor `mod_name` gets connections whose COMMIT fails."""
    mod = _module(mod_name)
    real = mod.get_conn
    ctx = monkeypatch.context()
    mp = ctx.__enter__()
    mp.setattr(mod, "get_conn", lambda *a, **k: _FailOnCommit(real(*a, **k)))
    return ctx


def _raise_after(monkeypatch, mod_name, attr):
    """Wrap `mod.attr` so the REAL function runs, then the call raises."""
    mod = _module(mod_name)
    original = getattr(mod, attr)

    def wrapper(*a, **k):
        original(*a, **k)
        raise RuntimeError(f"simulated failure after {attr}")

    monkeypatch.setattr(mod, attr, wrapper)
    return original


# ── processor cases ───────────────────────────────────────────────────────────

def _cm_bhav_run():
    _module("cm_bhav").process(DATE_ROLLOVER)


def _noop():
    pass


def _master_setup(mod_name):
    return lambda: _require_master_fixture(mod_name)


CASES = {
    "fo": dict(
        module="fo", setup=_noop,
        run=lambda: _module("fo").process(DATE_ROLLOVER),
        tables=[("instruments", None, None),
                ("market_data_daily", _D, [DATE_ROLLOVER]),
                ("futures_analytics", _D, [DATE_ROLLOVER]),
                ("options_analytics", _D, [DATE_ROLLOVER])],
        keys=["STF", "STO"],
    ),
    "cm_bhav": dict(
        module="cm_bhav", setup=_noop, run=_cm_bhav_run,
        tables=[("instruments", None, None),
                ("market_data_daily", _D, [DATE_ROLLOVER])],
        keys=["cm_bhav"],
    ),
    # eq_bhav is enrichment-only: it needs cm_bhav's base rows first, and its
    # only write is an UPDATE of avg_price / delivery_* on those rows.
    "eq_bhav": dict(
        module="eq_bhav", setup=_cm_bhav_run,
        run=lambda: _module("eq_bhav").process(DATE_ROLLOVER),
        tables=[("instruments", None, None),
                ("market_data_daily", _D, [DATE_ROLLOVER])],
        keys=["eq_bhav"],
    ),
    "fo_volt": dict(
        module="fo_volt", setup=_noop,
        run=lambda: _module("fo_volt").process(DATE_ROLLOVER),
        tables=[("fo_volatility", _D, [DATE_ROLLOVER])],
        keys=["fo_volt"],
    ),
    "fo_contracts": dict(
        module="fo_contracts", setup=_master_setup("fo_contracts"),
        run=lambda: _module("fo_contracts").process(MASTER_FILE_DATE, MASTER_TRADE_DATE),
        tables=[("instruments", None, None),
                ("instrument_contract_daily", None, None)],
        keys=["FO_CONTRACT"],
    ),
    "cm_securities": dict(
        module="cm_securities", setup=_master_setup("cm_securities"),
        run=lambda: _module("cm_securities").process(MASTER_FILE_DATE, MASTER_TRADE_DATE),
        tables=[("instruments", None, None),
                ("security_master_daily", None, None)],
        keys=["CM_SECURITY"],
    ),
}
CASE_IDS = list(CASES)


def _snapshots(case):
    return [_snapshot(*t) for t in CASES[case]["tables"]]


def _assert_snapshots_equal(a, b):
    assert len(a) == len(b)
    for x, y in zip(a, b):
        pd.testing.assert_frame_equal(x, y)


# ── generic: commit failure leaves the DB exactly as it was ───────────────────

@pytest.mark.parametrize("case", CASE_IDS)
def test_commit_failure_rolls_back_everything_and_leaves_db_usable(
    isolated_pipeline, monkeypatch, case
):
    import api.db as db
    c = CASES[case]

    c["setup"]()
    before = _snapshots(case)

    ctx = _commit_fails(monkeypatch, c["module"])
    try:
        with pytest.raises(RuntimeError, match="simulated commit failure"):
            c["run"]()
    finally:
        ctx.__exit__(None, None, None)

    # nothing from the failed run survives
    _assert_snapshots_equal(before, _snapshots(case))

    # not "processed" -> a retry will not be skipped by the guard
    for k in c["keys"]:
        assert db.is_processed(MASTER_TRADE_DATE if "contracts" in case or "securities" in case
                               else DATE_ROLLOVER, k) is False

    # write lock released, no dangling transaction
    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute("SELECT 1")
        conn.execute("COMMIT")
    finally:
        conn.close()


@pytest.mark.parametrize("case", CASE_IDS)
def test_recovery_converges_to_the_same_state_as_a_clean_run(
    isolated_pipeline, monkeypatch, tmp_path, case
):
    """Failure + retry must end in exactly the state a never-failed run
    produces, compared against an independent fresh database."""
    import api.db as db
    c = CASES[case]

    # run A: fail once, then retry
    c["setup"]()
    ctx = _commit_fails(monkeypatch, c["module"])
    try:
        with pytest.raises(RuntimeError, match="simulated commit failure"):
            c["run"]()
    finally:
        ctx.__exit__(None, None, None)
    c["run"]()
    recovered = _snapshots(case)
    assert all(len(s) > 0 for s in recovered), "retry produced an empty table"

    # run B: clean, in a brand new DB
    monkeypatch.setattr(db, "NSE_DB_PATH", tmp_path / "clean_nse.db")
    db.init_db()
    c["setup"]()
    c["run"]()
    clean = _snapshots(case)

    _assert_snapshots_equal(recovered, clean)


# ── fo: failure after earlier steps really executed ──────────────────────────
# Injected at the SQL level (no dependency on fo's private function names or
# signatures): the wrapped connection raises just before the first INSERT that
# targets `needle`, after every earlier statement has really executed.

def _fail_before_insert(monkeypatch, mod_name, needle):
    mod = _module(mod_name)
    real = mod.get_conn
    seen = []

    class _Proxy(_FailOnCommit):
        def execute(self, sql, *args, **kwargs):
            if isinstance(sql, str):
                low = sql.lower()
                if "insert" in low and needle in low:
                    raise RuntimeError(f"simulated failure before insert into {needle}")
                seen.append(low)
            return self._conn.execute(sql, *args, **kwargs)

    ctx = monkeypatch.context()
    mp = ctx.__enter__()
    mp.setattr(mod, "get_conn", lambda *a, **k: _Proxy(real(*a, **k)))
    return ctx, seen


def test_fo_rolls_back_everything_when_options_write_fails(isolated_pipeline, monkeypatch):
    ctx, seen = _fail_before_insert(monkeypatch, "fo", "options_analytics")
    try:
        with pytest.raises(RuntimeError, match="simulated failure"):
            _module("fo").process(DATE_ROLLOVER)
    finally:
        ctx.__exit__(None, None, None)

    # the test is only meaningful if earlier steps really ran first
    assert any("market_data_daily" in q for q in seen), seen

    assert _count("instruments") == 0
    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) == 0
    assert _count("options_analytics", _D, [DATE_ROLLOVER]) == 0
    assert _count("futures_analytics", _D, [DATE_ROLLOVER]) == 0


def test_fo_recovers_cleanly_after_options_write_failure(isolated_pipeline, monkeypatch):
    ctx, _ = _fail_before_insert(monkeypatch, "fo", "options_analytics")
    try:
        with pytest.raises(RuntimeError, match="simulated failure"):
            _module("fo").process(DATE_ROLLOVER)
    finally:
        ctx.__exit__(None, None, None)
    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) == 0

    _module("fo").process(DATE_ROLLOVER)  # clean retry

    assert _count("instruments") > 0
    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) > 0
    assert _count("options_analytics", _D, [DATE_ROLLOVER]) > 0
    assert _count("futures_analytics", _D, [DATE_ROLLOVER]) > 0


# ── cm_bhav: instruments -> market_data ──────────────────────────────────────

def test_cm_bhav_rolls_back_instruments_when_market_data_upsert_fails(
    isolated_pipeline, monkeypatch
):
    cm_bhav = _module("cm_bhav")
    monkeypatch.setattr(
        cm_bhav, "upsert_market_data",
        lambda conn, df: (_ for _ in ()).throw(RuntimeError("simulated market_data failure")),
    )

    with pytest.raises(RuntimeError, match="simulated market_data failure"):
        cm_bhav.process(DATE_ROLLOVER)

    assert _count("instruments") == 0
    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) == 0


def test_cm_bhav_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    cm_bhav = _module("cm_bhav")
    original = cm_bhav.upsert_market_data
    monkeypatch.setattr(
        cm_bhav, "upsert_market_data",
        lambda conn, df: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        cm_bhav.process(DATE_ROLLOVER)
    assert _count("instruments") == 0

    monkeypatch.setattr(cm_bhav, "upsert_market_data", original)
    cm_bhav.process(DATE_ROLLOVER)

    assert _count("instruments", "segment = 'CM'") > 0
    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) > 0


# ── eq_bhav: the UPDATE itself must roll back ────────────────────────────────

def test_eq_bhav_rolls_back_delivery_patch_when_failure_follows_real_update(
    isolated_pipeline, monkeypatch
):
    """eq_bhav only UPDATEs. Let the real UPDATE run, then fail: avg_price /
    delivery_* must go back to NULL on every row, and no rows may appear."""
    _cm_bhav_run()
    rows = _count("market_data_daily", _D, [DATE_ROLLOVER])
    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D, [DATE_ROLLOVER]) == 0

    _raise_after(monkeypatch, "eq_bhav", "upsert_delivery_stats")
    with pytest.raises(RuntimeError, match="simulated failure"):
        _module("eq_bhav").process(DATE_ROLLOVER)

    assert _count("market_data_daily", _D, [DATE_ROLLOVER]) == rows
    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D, [DATE_ROLLOVER]) == 0
    assert _count("market_data_daily", "delivery_qty IS NOT NULL AND " + _D, [DATE_ROLLOVER]) == 0


def test_eq_bhav_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    _cm_bhav_run()
    eq_bhav = _module("eq_bhav")
    original = eq_bhav.upsert_delivery_stats
    monkeypatch.setattr(
        eq_bhav, "upsert_delivery_stats",
        lambda conn, df: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        eq_bhav.process(DATE_ROLLOVER)
    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D, [DATE_ROLLOVER]) == 0

    monkeypatch.setattr(eq_bhav, "upsert_delivery_stats", original)
    eq_bhav.process(DATE_ROLLOVER)

    assert _count("market_data_daily", "avg_price IS NOT NULL AND " + _D, [DATE_ROLLOVER]) > 0


# ── fo_contracts / cm_securities: three-step transactions ────────────────────

def test_fo_contracts_rolls_back_instruments_and_contract_daily_when_corp_actions_fail(
    isolated_pipeline, monkeypatch
):
    _require_master_fixture("fo_contracts")
    _raise_after(monkeypatch, "fo_contracts", "_upsert_corp_actions")

    with pytest.raises(RuntimeError, match="simulated failure"):
        _module("fo_contracts").process(MASTER_FILE_DATE, MASTER_TRADE_DATE)

    assert _count("instruments") == 0
    assert _count("instrument_contract_daily") == 0
    assert _count("corporate_actions") == 0


def test_fo_contracts_rolls_back_instruments_when_contract_daily_fails(
    isolated_pipeline, monkeypatch
):
    _require_master_fixture("fo_contracts")
    _raise_after(monkeypatch, "fo_contracts", "_upsert_contract_daily")

    with pytest.raises(RuntimeError, match="simulated failure"):
        _module("fo_contracts").process(MASTER_FILE_DATE, MASTER_TRADE_DATE)

    assert _count("instruments") == 0
    assert _count("instrument_contract_daily") == 0


def test_fo_contracts_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    _require_master_fixture("fo_contracts")
    fc = _module("fo_contracts")
    original = fc._upsert_corp_actions
    monkeypatch.setattr(
        fc, "_upsert_corp_actions",
        lambda conn, df: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        fc.process(MASTER_FILE_DATE, MASTER_TRADE_DATE)

    monkeypatch.setattr(fc, "_upsert_corp_actions", original)
    fc.process(MASTER_FILE_DATE, MASTER_TRADE_DATE)

    assert _count("instrument_contract_daily", _D, [MASTER_TRADE_DATE]) > 0
    assert _count("instruments", "segment = 'FO'") > 0


def test_cm_securities_rolls_back_instruments_and_master_when_corp_actions_fail(
    isolated_pipeline, monkeypatch
):
    _require_master_fixture("cm_securities")
    _raise_after(monkeypatch, "cm_securities", "_upsert_corp_actions")

    with pytest.raises(RuntimeError, match="simulated failure"):
        _module("cm_securities").process(MASTER_FILE_DATE, MASTER_TRADE_DATE)

    assert _count("instruments") == 0
    assert _count("security_master_daily") == 0
    assert _count("corporate_actions") == 0


def test_cm_securities_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    _require_master_fixture("cm_securities")
    cs = _module("cm_securities")
    original = cs._upsert_corp_actions
    monkeypatch.setattr(
        cs, "_upsert_corp_actions",
        lambda conn, df: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        cs.process(MASTER_FILE_DATE, MASTER_TRADE_DATE)

    monkeypatch.setattr(cs, "_upsert_corp_actions", original)
    cs.process(MASTER_FILE_DATE, MASTER_TRADE_DATE)

    assert _count("security_master_daily", _D, [MASTER_TRADE_DATE]) > 0
    assert _count("instruments", "segment = 'CM'") > 0


# ── mkt_act.py (conn.begin()/commit()/rollback() style) ──────────────────────

def test_mkt_act_rolls_back_summary_on_downstream_failure(isolated_pipeline, monkeypatch):
    """mkt_act uses a different transaction API than the BEGIN/COMMIT
    processors. _write inserts summary, index rows, then breadth; failing
    after the real write must undo all of it."""
    mkt_act = _module("mkt_act")
    original_write = mkt_act._write

    def failing_write(conn, parsed, trade_date):
        original_write(conn, parsed, trade_date)
        raise RuntimeError("simulated failure after write")

    monkeypatch.setattr(mkt_act, "_write", failing_write)

    with pytest.raises(RuntimeError, match="simulated failure"):
        mkt_act.process(DATE_ROLLOVER)

    assert _count("market_activity_summary", _D, [DATE_ROLLOVER]) == 0
    assert _count("market_activity_index", _D, [DATE_ROLLOVER]) == 0
    assert _count("market_activity_breadth", _D, [DATE_ROLLOVER]) == 0


def test_mkt_act_recovers_cleanly_after_forced_failure(isolated_pipeline, monkeypatch):
    mkt_act = _module("mkt_act")
    original_write = mkt_act._write
    monkeypatch.setattr(
        mkt_act, "_write",
        lambda conn, parsed, trade_date: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(RuntimeError):
        mkt_act.process(DATE_ROLLOVER)
    assert _count("market_activity_summary", _D, [DATE_ROLLOVER]) == 0

    monkeypatch.setattr(mkt_act, "_write", original_write)
    mkt_act.process(DATE_ROLLOVER)

    assert _count("market_activity_summary", _D, [DATE_ROLLOVER]) > 0
    assert _count("market_activity_breadth", _D, [DATE_ROLLOVER]) > 0


# ── manifest-level recovery ──────────────────────────────────────────────────

def test_manifest_marked_failed_date_is_retried_and_succeeds(isolated_pipeline, tmp_manifest):
    """startup_sync recovery path: a date is marked 'failed' in the manifest,
    the DB has nothing for it, a processor retry succeeds, and the manifest
    can then be moved to success. The manifest does not gate the processor;
    is_processed reads the DB directly."""
    import pipeline.manifest as m

    m.mark_failed(DATE_NORMAL_1)
    row = m.load_manifest()
    row = row[row["trade_date"] == DATE_NORMAL_1].iloc[0]
    assert row["status"] == "failed"

    assert _count("market_data_daily", _D, [DATE_NORMAL_1]) == 0

    _module("fo").process(DATE_NORMAL_1)  # retry

    assert _count("market_data_daily", _D, [DATE_NORMAL_1]) > 0

    m.mark_downloaded(DATE_NORMAL_1)
    row = m.load_manifest()
    row = row[row["trade_date"] == DATE_NORMAL_1].iloc[0]
    assert row["status"] == "complete"
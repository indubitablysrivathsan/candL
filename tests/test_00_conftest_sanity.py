"""
tests/test_00_conftest_sanity.py
================================
Not a real feature test — a guard rail. Confirms the isolation fixtures in
conftest.py actually do what we think before any processor/manifest tests
are built on top of them. If this file fails, every other test's results
are suspect (they might be silently hitting the real data/nse.db or the
real raw/ directory instead of the fixtures).
"""

from pathlib import Path

import pandas as pd

from tests.conftest import FIXTURES_ROOT, DATE_ROLLOVER


def test_tmp_db_points_at_tmp_path_not_real_db(tmp_db):
    import api.db as db

    assert db.NSE_DB_PATH == tmp_db
    # must not be the real project DB
    assert "data" not in str(tmp_db.parent) or "tmp" in str(tmp_db).lower()
    assert tmp_db.exists()  # init_db() should have created the file


def test_tmp_db_has_expected_schema(tmp_db):
    import api.db as db

    conn = db.get_conn(read_only=True)
    try:
        tables = {
            row[0]
            for row in conn.execute("SHOW TABLES").fetchall()
        }
    finally:
        conn.close()

    expected = {
        "instruments", "market_data_daily", "participant_activity",
        "fii_stats", "fo_volatility", "market_activity_index",
        "market_activity_summary", "options_analytics",
        "futures_analytics", "market_activity_breadth",
    }
    assert expected.issubset(tables)


def test_tmp_db_is_empty_on_fresh_init(tmp_db):
    import api.db as db

    conn = db.get_conn(read_only=True)
    try:
        count = conn.execute("SELECT COUNT(*) FROM instruments").fetchone()[0]
    finally:
        conn.close()
    assert count == 0


def test_tmp_manifest_is_isolated_copy(tmp_manifest):
    import pipeline.manifest as manifest_mod

    assert manifest_mod.MANIFEST_PATH == tmp_manifest
    real_manifest = FIXTURES_ROOT / "manifest.csv"
    assert tmp_manifest != real_manifest
    assert tmp_manifest.exists()

    df = pd.read_csv(tmp_manifest, dtype=str)
    assert DATE_ROLLOVER in df["trade_date"].values


def test_mutating_tmp_manifest_does_not_touch_real_fixture(tmp_manifest):
    import pipeline.manifest as manifest_mod

    df = manifest_mod.load_manifest()
    df.loc[df["trade_date"] == DATE_ROLLOVER, "status"] = "MUTATED_BY_TEST"
    manifest_mod.save_manifest(df)

    real_df = pd.read_csv(FIXTURES_ROOT / "manifest.csv", dtype=str)
    real_status = real_df.loc[real_df["trade_date"] == DATE_ROLLOVER, "status"].iloc[0]
    assert real_status != "MUTATED_BY_TEST"


def test_patch_raw_roots_resolves_to_real_fixture_files(patch_raw_roots):
    import pipeline.processors.fo as fo_mod
    import pipeline.processors.eq_bhav as eq_bhav_mod
    import pipeline.processors.participant as participant_mod

    assert fo_mod.FO_RAW_ROOT == FIXTURES_ROOT / "fo"
    assert eq_bhav_mod.EQ_BHAV_ROOT == FIXTURES_ROOT / "eq_bhav"
    assert participant_mod.PART_OI_ROOT == FIXTURES_ROOT / "part_oi"
    assert participant_mod.PART_VOL_ROOT == FIXTURES_ROOT / "part_vol"

    fo_path = fo_mod._raw_path(DATE_ROLLOVER)
    assert fo_path.exists(), f"expected fixture file missing: {fo_path}"


def test_processor_module_root_is_not_the_real_project_raw_dir(patch_raw_roots):
    """
    Guards against the patch silently no-op'ing (e.g. wrong attribute name)
    and the processor falling back to config's real RAW_ROOT.
    """
    import pipeline.processors.fo as fo_mod

    assert "tests" in str(fo_mod.FO_RAW_ROOT).replace("\\", "/")
    assert "E:/Projects/candL/raw" not in str(fo_mod.FO_RAW_ROOT).replace("\\", "/")
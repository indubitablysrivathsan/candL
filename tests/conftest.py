"""
tests/conftest.py
==================
Shared fixtures for all pipeline/API tests.

Isolation strategy
-------------------
Every processor and api/db.py does `from config import X` — a direct name
binding at import time. Patching `config.X` after that point does nothing;
we must patch the attribute on each *importing* module instead
(e.g. `pipeline.processors.fo.FO_RAW_ROOT`, `api.db.NSE_DB_PATH`).

This conftest patches:
  - api.db.NSE_DB_PATH              -> tmp DuckDB file (fresh per test)
  - api.db.PART_OI_ROOT / PART_VOL_ROOT
        -> fixture dirs. api.db._PROCESS_CHECK uses these (via a lambda that
           reads the module global at call time) to decide whether
           part_oi / part_vol are "already processed" because their source
           file is absent. Unpatched, is_processed() would look at the REAL
           data directory and could silently skip a test's processing.
  - pipeline.manifest.MANIFEST_PATH -> tmp copy of the real fixture manifest
  - each processor's *_ROOT constant -> tests/fixtures/raw/<subdir>

Because tests/fixtures/raw already contains real bhavcopy-shaped files for
2026-06-30 .. 2026-07-06, no synthetic data generation is needed. The raw
fixture directory is read-only from the tests' perspective; only the DB and
the manifest copy are mutated, and both are torn down per test via tmp_path.
"""

import shutil
from pathlib import Path

import pytest

FIXTURES_ROOT = Path(__file__).parent / "fixtures" / "raw"


# ── DB isolation ──────────────────────────────────────────────────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """
    Point api.db.NSE_DB_PATH at a fresh file per test and initialize schema.
    Returns the Path for tests that want to open their own connection.
    """
    import api.db as db

    db_path = tmp_path / "test_nse.db"
    monkeypatch.setattr(db, "NSE_DB_PATH", db_path)
    db.init_db()
    return db_path


# ── Manifest isolation ────────────────────────────────────────────────────────

@pytest.fixture
def tmp_manifest(tmp_path, monkeypatch):
    """
    Copy the real fixture manifest.csv to a tmp location and point
    pipeline.manifest.MANIFEST_PATH at it, so tests can mutate freely.
    """
    import pipeline.manifest as manifest_mod

    src = FIXTURES_ROOT / "manifest.csv"
    dst = tmp_path / "manifest.csv"
    shutil.copy(src, dst)
    monkeypatch.setattr(manifest_mod, "MANIFEST_PATH", dst)
    return dst


# ── Raw data root isolation (per processor) ──────────────────────────────────
# Each processor module binds its ROOT constant at import time via
# `from config import X_ROOT`, so we patch the constant on the processor
# module itself, not on `config`.

@pytest.fixture
def patch_raw_roots(monkeypatch):
    """
    Point every processor's *_ROOT constant at tests/fixtures/raw/<subdir>.
    Import processor modules lazily so this fixture doesn't hard-fail if a
    module has an unrelated import error unrelated to the test at hand.
    """
    import api.db as db_mod
    import pipeline.processors.fo as fo_mod
    import pipeline.processors.fo_contracts as fo_contracts_mod
    import pipeline.processors.cm_securities as cm_securities_mod
    import pipeline.processors.eq_bhav as eq_bhav_mod
    import pipeline.processors.cm_bhav as cm_bhav_mod
    import pipeline.processors.fii as fii_mod
    import pipeline.processors.participant as participant_mod
    import pipeline.processors.fo_volt as fo_volt_mod
    import pipeline.processors.mkt_act as mkt_act_mod

    monkeypatch.setattr(fo_mod, "FO_RAW_ROOT", FIXTURES_ROOT / "fo")
    monkeypatch.setattr(eq_bhav_mod, "EQ_BHAV_ROOT", FIXTURES_ROOT / "eq_bhav")
    monkeypatch.setattr(cm_bhav_mod, "CM_BHAV_ROOT", FIXTURES_ROOT / "cm_bhav")
    monkeypatch.setattr(fii_mod, "FII_STATS_ROOT", FIXTURES_ROOT / "fii_stats")
    monkeypatch.setattr(participant_mod, "PART_OI_ROOT", FIXTURES_ROOT / "part_oi")
    monkeypatch.setattr(participant_mod, "PART_VOL_ROOT", FIXTURES_ROOT / "part_vol")
    monkeypatch.setattr(fo_volt_mod, "FO_VOLT_ROOT", FIXTURES_ROOT / "fo_volt")
    monkeypatch.setattr(mkt_act_mod, "MKT_ACT_ROOT", FIXTURES_ROOT / "mkt_act")

    # Forward-looking master files (file_date != trade_date).
    # NOTE: the fixture subdirectory names below are ASSUMED — adjust if your
    # tests/fixtures/raw layout differs.
    monkeypatch.setattr(fo_contracts_mod, "FO_CONTRACT_ROOT", FIXTURES_ROOT / "fo_contracts")
    monkeypatch.setattr(cm_securities_mod, "CM_SECURITY_ROOT", FIXTURES_ROOT / "cm_security")

    # api.db._PROCESS_CHECK looks these up as module globals at call time.
    monkeypatch.setattr(db_mod, "PART_OI_ROOT", FIXTURES_ROOT / "part_oi")
    monkeypatch.setattr(db_mod, "PART_VOL_ROOT", FIXTURES_ROOT / "part_vol")


# ── Combined fixture for most processor tests ────────────────────────────────

@pytest.fixture
def isolated_pipeline(tmp_db, tmp_manifest, patch_raw_roots):
    """
    Convenience fixture: fresh DB + fresh manifest copy + raw roots pointed
    at the real fixture files. Most processor tests should depend on this
    rather than composing the three fixtures manually.
    """
    return {
        "db_path": tmp_db,
        "manifest_path": tmp_manifest,
    }


# ── Known-good sample dates from the fixture set ─────────────────────────────
# 2026-06-30 = last day of old expiry cycle
# 2026-07-01 = first day of new expiry cycle (rollover boundary)
# 2026-07-02, 2026-07-03 = normal consecutive days
# 2026-07-04/05 = market_closed (weekend) — present in manifest, no raw files
# 2026-07-06 = normal day after the weekend gap

DATE_EXPIRY_LAST = "2026-06-30"
DATE_ROLLOVER    = "2026-07-01"
DATE_NORMAL_1    = "2026-07-02"
DATE_NORMAL_2    = "2026-07-03"
DATE_CLOSED_1    = "2026-07-04"
DATE_CLOSED_2    = "2026-07-05"
DATE_AFTER_GAP   = "2026-07-06"

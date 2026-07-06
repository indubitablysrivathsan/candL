"""
tests/test_manifest_transitions.py
===================================
Covers pipeline/manifest.py in isolation (no DB, no raw files) and
pipeline/trading_dates.get_missing_dates against the real fixture manifest,
which conveniently includes a market_closed weekend gap and a status
mix worth exercising.
"""

import pandas as pd
import pytest

from tests.conftest import (
    DATE_EXPIRY_LAST, DATE_ROLLOVER, DATE_NORMAL_1, DATE_NORMAL_2,
    DATE_CLOSED_1, DATE_CLOSED_2, DATE_AFTER_GAP,
)


# ── _upsert / status setters ──────────────────────────────────────────────────

def test_mark_downloaded_on_new_date_appends_single_row(tmp_manifest):
    import pipeline.manifest as m

    new_date = "2026-07-10"
    before = m.load_manifest()
    assert new_date not in before["trade_date"].values

    m.mark_downloaded(new_date)

    after = m.load_manifest()
    matching = after[after["trade_date"] == new_date]
    assert len(matching) == 1
    assert matching.iloc[0]["status"] == "complete"
    assert matching.iloc[0]["fo_dl"] == 1


def test_mark_downloaded_on_existing_date_updates_in_place_no_duplicate(tmp_manifest):
    """
    _upsert's existing-row branch must UPDATE, not append. A second call for
    the same trade_date should never result in two rows for that date.
    """
    import pipeline.manifest as m

    before = m.load_manifest()
    row_count_before = len(before)

    m.mark_downloaded(DATE_ROLLOVER)  # already exists in fixture manifest

    after = m.load_manifest()
    assert len(after) == row_count_before  # no new row
    matching = after[after["trade_date"] == DATE_ROLLOVER]
    assert len(matching) == 1


def test_mark_failed_sets_status_and_clears_fo_dl(tmp_manifest):
    import pipeline.manifest as m

    m.mark_failed(DATE_NORMAL_1)

    row = m.load_manifest()
    row = row[row["trade_date"] == DATE_NORMAL_1].iloc[0]
    assert row["status"] == "failed"
    assert row["fo_dl"] == 0


def test_mark_market_closed_sets_status_and_clears_fo_dl(tmp_manifest):
    import pipeline.manifest as m

    m.mark_market_closed(DATE_NORMAL_2)

    row = m.load_manifest()
    row = row[row["trade_date"] == DATE_NORMAL_2].iloc[0]
    assert row["status"] == "market_closed"
    assert row["fo_dl"] == 0


# ── individual flag setters ───────────────────────────────────────────────────

def test_set_flag_on_new_date_defaults_other_flags_to_zero(tmp_manifest):
    import pipeline.manifest as m

    new_date = "2026-07-11"
    m.mark_eq_bhav_downloaded(new_date)

    row = m.load_manifest()
    row = row[row["trade_date"] == new_date].iloc[0]
    assert row["eq_bhav_dl"] == 1
    # every other flag column should still be 0, not NaN or missing
    other_flag_cols = [c for c in m._FLAG_COLS if c != "eq_bhav_dl"]
    assert all(row[c] == 0 for c in other_flag_cols)


def test_set_flag_on_existing_date_does_not_disturb_other_flags(tmp_manifest):
    import pipeline.manifest as m

    before = m.load_manifest()
    before_row = before[before["trade_date"] == DATE_EXPIRY_LAST].iloc[0]
    assert before_row["sto_pr"] == 1  # fixture has this already set

    m.mark_fo_volt_processed(DATE_EXPIRY_LAST)

    after = m.load_manifest()
    after_row = after[after["trade_date"] == DATE_EXPIRY_LAST].iloc[0]
    assert after_row["fo_volt_pr"] == 1
    assert after_row["sto_pr"] == 1  # untouched by the unrelated flag set


# ── unprocessed-date getters ───────────────────────────────────────────────────

def test_get_unprocessed_dates_excludes_fully_processed_fixture_dates(tmp_manifest):
    import pipeline.manifest as m

    # All fixture dates have both fo_dl=1 and sto_pr=1 already
    unprocessed = m.get_stock_options_unprocessed_dates()
    assert DATE_ROLLOVER not in unprocessed
    assert DATE_NORMAL_1 not in unprocessed


def test_get_unprocessed_dates_includes_downloaded_but_unprocessed_date(tmp_manifest):
    import pipeline.manifest as m

    # Simulate: downloaded but not yet processed
    m._set_flag(DATE_NORMAL_1, "sto_pr", 0)

    unprocessed = m.get_stock_options_unprocessed_dates()
    assert DATE_NORMAL_1 in unprocessed


# ── get_missing_dates against the real fixture manifest ──────────────────────

def test_missing_dates_excludes_market_closed_days(tmp_manifest):
    import pipeline.manifest as m
    from pipeline.trading_dates import get_missing_dates

    manifest = m.load_manifest()
    missing = get_missing_dates(manifest, DATE_EXPIRY_LAST, DATE_AFTER_GAP)

    assert DATE_CLOSED_1 not in missing
    assert DATE_CLOSED_2 not in missing


def test_missing_dates_excludes_dates_with_complete_status(tmp_manifest):
    import pipeline.manifest as m
    from pipeline.trading_dates import get_missing_dates

    manifest = m.load_manifest()
    missing = get_missing_dates(manifest, DATE_EXPIRY_LAST, DATE_AFTER_GAP)

    for d in (DATE_EXPIRY_LAST, DATE_ROLLOVER, DATE_NORMAL_1, DATE_NORMAL_2, DATE_AFTER_GAP):
        assert d not in missing


def test_missing_dates_reincludes_failed_status(tmp_manifest):
    """
    get_missing_dates treats status == 'failed' as still-missing so
    startup_sync retries it, even though the date exists in the manifest.
    """
    import pipeline.manifest as m
    from pipeline.trading_dates import get_missing_dates

    m.mark_failed(DATE_NORMAL_1)

    manifest = m.load_manifest()
    missing = get_missing_dates(manifest, DATE_EXPIRY_LAST, DATE_AFTER_GAP)

    assert DATE_NORMAL_1 in missing


def test_missing_dates_reincludes_partial_status(tmp_manifest):
    import pipeline.manifest as m
    from pipeline.trading_dates import get_missing_dates

    df = m.load_manifest()
    df.loc[df["trade_date"] == DATE_NORMAL_2, "status"] = "partial"
    m.save_manifest(df)

    manifest = m.load_manifest()
    missing = get_missing_dates(manifest, DATE_EXPIRY_LAST, DATE_AFTER_GAP)

    assert DATE_NORMAL_2 in missing


def test_missing_dates_includes_dates_beyond_fixture_range(tmp_manifest):
    """
    Dates past the last manifest row (e.g. a date the pipeline has never
    seen) must show up as missing so startup_sync will attempt to download.
    """
    import pipeline.manifest as m
    from pipeline.trading_dates import get_missing_dates

    manifest = m.load_manifest()
    missing = get_missing_dates(manifest, DATE_EXPIRY_LAST, "2026-07-08")

    assert "2026-07-07" in missing
    assert "2026-07-08" in missing
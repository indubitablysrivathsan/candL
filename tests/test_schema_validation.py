"""
tests/test_schema_validation.py
=================================
Covers: raw file schema validation and malformed-input handling.

These processors trust NSE's file format implicitly (pd.read_csv with no
explicit dtype/column validation), so "schema validation" here mostly
means: confirm that malformed input fails LOUDLY (a clear exception) rather
than silently ingesting garbage, and pin the known-fragile behaviors
(fo_volt's position-based column mapping) so a future NSE format change is
caught by a failing test instead of silently corrupting data.
"""

import pandas as pd
import pytest

from tests.conftest import DATE_ROLLOVER


def _write_csv(path, df):
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)


# ── fo.py: missing required column fails loudly ──────────────────────────────

def test_fo_process_missing_required_column_raises_keyerror(
    isolated_pipeline, monkeypatch, tmp_path
):
    """
    fo.py's _build_instruments accesses columns like XpryDt, StrkPric,
    NewBrdLotQty directly with no existence check. A malformed source file
    missing one of these must fail with a clear KeyError, not silently
    produce a DataFrame with NaNs for that field.
    """
    from pipeline.processors import fo

    bad_dir = tmp_path / "bad_fo"
    monkeypatch.setattr(fo, "FO_RAW_ROOT", bad_dir)

    df = pd.DataFrame([{
        "FinInstrmTp": "STF",
        "TckrSymb": "TESTCO",
        # XpryDt intentionally omitted
        "FininstrmActlXpryDt": "2026-07-30",
        "StrkPric": "",
        "NewBrdLotQty": "100",
        "TradDt": DATE_ROLLOVER,
        "OpnPric": "100", "HghPric": "105", "LwPric": "99", "ClsPric": "102",
        "LastPric": "102", "PrvsClsgPric": "101", "TtlTradgVol": "1000",
        "TtlTrfVal": "100000", "TtlNbOfTxsExctd": "50", "OpnIntrst": "500",
        "ChngInOpnIntrst": "10", "SttlmPric": "102", "UndrlygPric": "100",
        "Sgmt": "FO", "FinInstrmId": "1", "FinInstrmNm": "TESTCO-FUT",
        "ISIN": "", "SctySrs": "",
    }])
    _write_csv(bad_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv", df)

    with pytest.raises(KeyError):
        fo.process(DATE_ROLLOVER)


def test_fo_process_missing_raw_file_raises_filenotfounderror(isolated_pipeline, monkeypatch, tmp_path):
    from pipeline.processors import fo

    empty_dir = tmp_path / "empty_fo"
    empty_dir.mkdir()
    monkeypatch.setattr(fo, "FO_RAW_ROOT", empty_dir)

    with pytest.raises(FileNotFoundError):
        fo.process("2026-01-01")  # no file exists for this date


# ── numeric coercion: garbage values become NULL, not a crash ────────────────

def test_fo_process_non_numeric_price_field_coerces_to_null_not_exception(
    isolated_pipeline, monkeypatch, tmp_path
):
    """
    pd.to_numeric(..., errors="coerce") is used throughout _build_market_data.
    A garbage string in a numeric column must become NULL in the DB, not
    raise and not silently become 0.
    """
    from pipeline.processors import fo
    import api.db as db

    bad_dir = tmp_path / "garbage_fo"
    monkeypatch.setattr(fo, "FO_RAW_ROOT", bad_dir)

    df = pd.DataFrame([{
        "FinInstrmTp": "STF", "TckrSymb": "TESTCO",
        "XpryDt": "2026-07-30", "FininstrmActlXpryDt": "2026-07-30",
        "StrkPric": "", "NewBrdLotQty": "100",
        "TradDt": DATE_ROLLOVER,
        "OpnPric": "NOT_A_NUMBER",  # garbage
        "HghPric": "105", "LwPric": "99", "ClsPric": "102",
        "LastPric": "102", "PrvsClsgPric": "101", "TtlTradgVol": "1000",
        "TtlTrfVal": "100000", "TtlNbOfTxsExctd": "50", "OpnIntrst": "500",
        "ChngInOpnIntrst": "10", "SttlmPric": "102", "UndrlygPric": "100",
        "Sgmt": "FO", "FinInstrmId": "1", "FinInstrmNm": "TESTCO-FUT",
        "ISIN": "", "SctySrs": "", "OptnTp": "",
    }])
    _write_csv(bad_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv", df)

    fo.process(DATE_ROLLOVER)  # must not raise

    conn = db.get_conn(read_only=True)
    try:
        row = conn.execute(
            "SELECT open FROM market_data_daily WHERE trade_date = CAST(? AS DATE)",
            [DATE_ROLLOVER],
        ).fetchone()
    finally:
        conn.close()
    assert row[0] is None


# ── fo_volt.py: position-based column mapping is fragile by design ──────────

def test_fo_volt_column_mapping_trusts_position_not_header_text(
    isolated_pipeline, monkeypatch, tmp_path
):
    """
    fo_volt._COL_MAP renames columns by *position*, explicitly ignoring
    header text (per its own docstring, NSE headers are unreliable formula
    strings). This test pins that: even with header text that doesn't
    match the real NSE format at all, values land in the DB according to
    position. This is documenting a known fragility, not asserting it's
    correct — if NSE ever reorders columns, this processor will silently
    mislabel every field, and this test is the tripwire for that.
    """
    from pipeline.processors import fo_volt

    volt_dir = tmp_path / "fo_volt_positional"
    monkeypatch.setattr(fo_volt, "FO_VOLT_ROOT", volt_dir)

    # 16 columns matching _COL_MAP's expected positions, header text
    # deliberately wrong/generic to prove position (not name) drives mapping
    header = [f"col{i}" for i in range(16)]
    row = [
        DATE_ROLLOVER, "TESTCO",     # 0 date, 1 ticker
        "100", "99", "0.01",         # 2-4 underlying close/prev/logret
        "0.02", "0.15", "0.30",      # 5-7 prev/daily/annual vol
        "101", "100", "0.01",        # 8-10 futures close/prev/logret
        "0.02", "0.16", "0.31",      # 11-13 futures vol
        "0.155", "0.305",            # 14-15 applicable vol
    ]
    df = pd.DataFrame([row], columns=header)
    _write_csv(volt_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv", df)

    fo_volt.process(DATE_ROLLOVER)

    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        result = conn.execute(
            "SELECT ticker, underlying_daily_vol FROM fo_volatility "
            "WHERE trade_date = CAST(? AS DATE)",
            [DATE_ROLLOVER],
        ).fetchone()
    finally:
        conn.close()

    assert result[0] == "TESTCO"
    assert result[1] == pytest.approx(0.15)


def test_fo_volt_process_empty_parsed_result_does_not_raise(
    isolated_pipeline, monkeypatch, tmp_path
):
    """A file with header only (no data rows) must be a no-op, not a crash."""
    from pipeline.processors import fo_volt

    volt_dir = tmp_path / "fo_volt_empty"
    monkeypatch.setattr(fo_volt, "FO_VOLT_ROOT", volt_dir)

    header = [f"col{i}" for i in range(16)]
    df = pd.DataFrame(columns=header)
    _write_csv(volt_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv", df)

    fo_volt.process(DATE_ROLLOVER)  # must not raise
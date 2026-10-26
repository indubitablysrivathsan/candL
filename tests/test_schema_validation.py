"""
tests/test_schema_validation.py
=================================
Covers: raw file schema validation, malformed-input handling, and DB schema
pinning.

These processors trust NSE's file format implicitly (pd.read_csv with no
explicit dtype/column validation), so "schema validation" here mostly
means: confirm that malformed input fails LOUDLY (a clear exception) rather
than silently ingesting garbage, and pin the known-fragile behaviors
(fo_volt's position-based column mapping) so a future NSE format change is
caught by a failing test instead of silently corrupting data.

Updated for the current DDL:
  * fo_volatility no longer stores underlying/futures close, prev close or
    prev-day vol. Only log return, daily vol, annual vol (per underlying and
    futures) plus the applicable vols are kept. The raw file still has 16
    positional columns; the processor must drop the ones the table doesn't hold.
  * market_data_daily is keyed by (trade_date, instrument_key) and has no
    ticker column, so lookups go through `instruments`.
  * market_data_daily gained avg_price / delivery_qty / delivery_pct, which
    F&O files do not populate (must be NULL).
"""

import pandas as pd
import pytest

from tests.conftest import DATE_ROLLOVER


def _write_csv(path, df):
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)


def _fo_row(**overrides):
    """A fully valid single-row NSE F&O bhavcopy record; override fields per test."""
    row = {
        "FinInstrmTp": "STF", "TckrSymb": "TESTCO",
        "XpryDt": "2026-07-30", "FininstrmActlXpryDt": "2026-07-30",
        "StrkPric": "", "NewBrdLotQty": "100",
        "TradDt": DATE_ROLLOVER,
        "OpnPric": "100", "HghPric": "105", "LwPric": "99", "ClsPric": "102",
        "LastPric": "102", "PrvsClsgPric": "101", "TtlTradgVol": "1000",
        "TtlTrfVal": "100000", "TtlNbOfTxsExctd": "50", "OpnIntrst": "500",
        "ChngInOpnIntrst": "10", "SttlmPric": "102", "UndrlygPric": "100",
        "Sgmt": "FO", "FinInstrmId": "1", "FinInstrmNm": "TESTCO-FUT",
        "ISIN": "", "SctySrs": "", "OptnTp": "",
    }
    row.update(overrides)
    return row


def _columns(table):
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        rows = conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
            [table],
        ).fetchall()
    finally:
        conn.close()
    return {r[0] for r in rows}


# ── fo.py: missing required column fails loudly ──────────────────────────────

# Every one of these is accessed with df["col"] in fo.py (_drop_blank_rows,
# _build_instruments, _build_market_data) with no existence check, so each must
# raise KeyError. SctySrs is deliberately absent: fo.py never reads it.
_REQUIRED_FO_COLUMNS = [
    "FinInstrmTp", "TckrSymb", "FinInstrmNm", "FinInstrmId", "Sgmt", "ISIN",
    "XpryDt", "FininstrmActlXpryDt", "StrkPric", "OptnTp", "NewBrdLotQty",
    "TradDt", "OpnPric", "ClsPric", "UndrlygPric", "OpnIntrst",
]


@pytest.mark.parametrize("missing_col", _REQUIRED_FO_COLUMNS)
def test_fo_process_missing_required_column_raises_keyerror(
    isolated_pipeline, monkeypatch, tmp_path, missing_col
):
    """
    A malformed source file missing a required column must fail with a clear
    KeyError naming that column, not silently produce NaNs for that field.
    The fixture is otherwise complete, so the error can only come from the
    column removed.
    """
    from pipeline.processors import fo

    bad_dir = tmp_path / "bad_fo"
    monkeypatch.setattr(fo, "FO_RAW_ROOT", bad_dir)

    row = _fo_row()
    del row[missing_col]
    _write_csv(bad_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv", pd.DataFrame([row]))

    with pytest.raises(KeyError) as excinfo:
        fo.process(DATE_ROLLOVER)
    assert missing_col in str(excinfo.value)


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

    market_data_daily has no ticker column, so the row is located via a join
    on instruments (this also confirms the instrument_key linkage worked).
    """
    from pipeline.processors import fo
    import api.db as db

    bad_dir = tmp_path / "garbage_fo"
    monkeypatch.setattr(fo, "FO_RAW_ROOT", bad_dir)

    _write_csv(
        bad_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv",
        pd.DataFrame([_fo_row(OpnPric="NOT_A_NUMBER")]),
    )

    fo.process(DATE_ROLLOVER)  # must not raise

    conn = db.get_conn(read_only=True)
    try:
        row = conn.execute(
            """
            SELECT m.open, m.high, m.close
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.ticker = 'TESTCO'
              AND m.trade_date = CAST(? AS DATE)
            """,
            [DATE_ROLLOVER],
        ).fetchone()
    finally:
        conn.close()

    assert row is not None, "market_data_daily row was not written"
    assert row[0] is None                  # garbage -> NULL (not 0, not a crash)
    assert row[1] == pytest.approx(105.0)  # neighbouring valid fields unaffected
    assert row[2] == pytest.approx(102.0)


def test_fo_process_leaves_cash_market_only_columns_null(
    isolated_pipeline, monkeypatch, tmp_path
):
    """
    market_data_daily now carries delivery_qty / delivery_pct / avg_price.
    F&O bhavcopy has no such data, so those must be NULL for F&O rows
    rather than 0 (0% delivery would be a false statement).
    """
    from pipeline.processors import fo
    import api.db as db

    fo_dir = tmp_path / "fo_cm_only_cols"
    monkeypatch.setattr(fo, "FO_RAW_ROOT", fo_dir)
    _write_csv(fo_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv", pd.DataFrame([_fo_row()]))

    fo.process(DATE_ROLLOVER)

    conn = db.get_conn(read_only=True)
    try:
        row = conn.execute(
            """
            SELECT m.delivery_qty, m.delivery_pct
            FROM market_data_daily m
            JOIN instruments i USING (instrument_key)
            WHERE i.ticker = 'TESTCO'
              AND m.trade_date = CAST(? AS DATE)
            """,
            [DATE_ROLLOVER],
        ).fetchone()
    finally:
        conn.close()

    assert row is not None
    assert row == (None, None)


def test_fo_process_future_instrument_has_null_series_strike_option_type(
    isolated_pipeline, monkeypatch, tmp_path
):
    """
    fo.py always writes series=NULL for F&O (SctySrs is unreliable) and it is
    part of the idx_instr_identity unique index. A future also has no strike
    or option type. Pins that contract on the `instruments` table.
    """
    from pipeline.processors import fo
    import api.db as db

    fo_dir = tmp_path / "fo_instr_nulls"
    monkeypatch.setattr(fo, "FO_RAW_ROOT", fo_dir)
    _write_csv(
        fo_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv",
        pd.DataFrame([_fo_row(SctySrs="XX")]),  # junk series must be ignored
    )

    fo.process(DATE_ROLLOVER)

    conn = db.get_conn(read_only=True)
    try:
        row = conn.execute(
            """
            SELECT exchange, segment, instrument_type, series, strike, option_type
            FROM instruments WHERE ticker = 'TESTCO'
            """
        ).fetchone()
    finally:
        conn.close()

    assert row is not None
    assert row == ("NSE", "FO", "STF", None, None, None)


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

    Every stored field gets a DISTINCT value so a swapped/shifted mapping
    can't pass by coincidence. Positions 2, 3, 5, 8, 9 and 11 (closes, prev
    closes, prev-day vols) exist in the raw file but are no longer stored.
    """
    from pipeline.processors import fo_volt
    import api.db as db

    volt_dir = tmp_path / "fo_volt_positional"
    monkeypatch.setattr(fo_volt, "FO_VOLT_ROOT", volt_dir)

    # 16 columns in NSE's positional order; header text deliberately generic
    header = [f"col{i}" for i in range(16)]
    row = [
        DATE_ROLLOVER, "TESTCO",     # 0 date, 1 ticker
        "100", "99", "0.011",        # 2 close (dropped), 3 prev close (dropped), 4 underlying log return
        "0.02", "0.15", "0.30",      # 5 prev vol (dropped), 6 underlying daily vol, 7 underlying annual vol
        "101", "100", "0.012",       # 8 fut close (dropped), 9 fut prev close (dropped), 10 futures log return
        "0.021", "0.16", "0.31",     # 11 fut prev vol (dropped), 12 futures daily vol, 13 futures annual vol
        "0.155", "0.305",            # 14 applicable daily vol, 15 applicable annual vol
    ]
    _write_csv(volt_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv",
               pd.DataFrame([row], columns=header))

    fo_volt.process(DATE_ROLLOVER)

    conn = db.get_conn(read_only=True)
    try:
        result = conn.execute(
            """
            SELECT ticker,
                   underlying_log_return, underlying_daily_vol, underlying_annual_vol,
                   futures_log_return,    futures_daily_vol,    futures_annual_vol,
                   applicable_daily_vol,  applicable_annual_vol
            FROM fo_volatility
            WHERE trade_date = CAST(? AS DATE)
            """,
            [DATE_ROLLOVER],
        ).fetchone()
    finally:
        conn.close()

    assert result is not None, "fo_volatility row was not written"
    assert result[0] == "TESTCO"
    assert result[1:] == pytest.approx(
        (0.011, 0.15, 0.30, 0.012, 0.16, 0.31, 0.155, 0.305)
    )


def test_fo_volt_process_empty_parsed_result_does_not_raise(
    isolated_pipeline, monkeypatch, tmp_path
):
    """A file with header only (no data rows) must be a no-op, not a crash."""
    from pipeline.processors import fo_volt
    import api.db as db

    volt_dir = tmp_path / "fo_volt_empty"
    monkeypatch.setattr(fo_volt, "FO_VOLT_ROOT", volt_dir)

    header = [f"col{i}" for i in range(16)]
    df = pd.DataFrame(columns=header)
    _write_csv(volt_dir / "2026" / "07" / f"{DATE_ROLLOVER}.csv", df)

    fo_volt.process(DATE_ROLLOVER)  # must not raise

    conn = db.get_conn(read_only=True)
    try:
        n = conn.execute(
            "SELECT COUNT(*) FROM fo_volatility WHERE trade_date = CAST(? AS DATE)",
            [DATE_ROLLOVER],
        ).fetchone()[0]
    finally:
        conn.close()
    assert n == 0


# ── DB schema pinning ────────────────────────────────────────────────────────

def test_fo_volatility_table_has_exactly_the_expected_columns(isolated_pipeline):
    """
    Tripwire for DDL drift: if someone re-adds the dropped close/prev/prev-vol
    columns (or renames one), fo_volt's positional mapping needs revisiting.
    """
    assert _columns("fo_volatility") == {
        "trade_date", "ticker",
        "underlying_log_return", "underlying_daily_vol", "underlying_annual_vol",
        "futures_log_return", "futures_daily_vol", "futures_annual_vol",
        "applicable_daily_vol", "applicable_annual_vol",
    }


def test_market_data_daily_has_no_ticker_column(isolated_pipeline):
    """Ticker lives in `instruments`; market_data_daily is keyed by instrument_key."""
    cols = _columns("market_data_daily")
    assert "ticker" not in cols
    assert {"trade_date", "instrument_key", "delivery_qty", "delivery_pct", "avg_price"} <= cols
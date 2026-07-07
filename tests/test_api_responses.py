"""
tests/test_api_responses.py
=============================
Representative API response tests via FastAPI's TestClient.

Two things must be neutralized before the app boots, or tests will try to
hit the network / real DB:
  1. api.db.NSE_DB_PATH -> isolated tmp DB (same pattern as other tests)
  2. pipeline.startup_sync.run_startup_sync -> no-op (main.py's lifespan
     imports and calls this on startup; it downloads real files over the
     network otherwise, which must never happen in a test run)

Tickers are discovered dynamically from the ingested fixture data rather
than hardcoded, so these tests don't silently break if fixture tickers
change.
"""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import DATE_ROLLOVER, DATE_NORMAL_1


@pytest.fixture
def api_client(tmp_db, tmp_manifest, patch_raw_roots, monkeypatch):
    """
    Populates the isolated tmp DB with real fixture data (eq_bhav + fo for
    one date) then boots the FastAPI app against it, with startup_sync
    disabled.
    """
    from pipeline.processors import eq_bhav, fo
    import pipeline.startup_sync as startup_sync_mod

    eq_bhav.process(DATE_ROLLOVER)
    fo.process(DATE_ROLLOVER)

    monkeypatch.setattr(startup_sync_mod, "run_startup_sync", lambda: None)

    import api.main as main_mod
    with TestClient(main_mod.app) as client:
        yield client


def _get_known_eq_ticker(tmp_db):
    import api.db as db
    conn = db.get_conn(read_only=True)
    try:
        row = conn.execute(
            "SELECT ticker FROM instruments WHERE instrument_type = 'EQ' LIMIT 1"
        ).fetchone()
    finally:
        conn.close()
    assert row is not None, "fixture must contain at least one EQ instrument"
    return row[0]


# ── health / root — no DB dependency ──────────────────────────────────────────

def test_health_endpoint_returns_ok(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_root_endpoint_returns_expected_shape(api_client):
    resp = api_client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert "message" in body
    assert "docs" in body
    assert "version" in body


# ── stocks router — representative real-data path ─────────────────────────────

def test_stocks_tickers_returns_ticker_list_including_ingested_ticker(api_client, tmp_db):
    ticker = _get_known_eq_ticker(tmp_db)

    resp = api_client.get("/api/v1/stocks/tickers")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert ticker in body


def test_stocks_ohlc_valid_ticker_and_range_returns_rows(api_client, tmp_db):
    ticker = _get_known_eq_ticker(tmp_db)

    resp = api_client.get(
        f"/api/v1/stocks/{ticker}/ohlc",
        params={"start_date": DATE_ROLLOVER, "end_date": DATE_ROLLOVER},
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert len(rows) >= 1
    first = rows[0]
    assert first["trade_date"] == DATE_ROLLOVER
    assert "close" in first
    assert "volume" in first


def test_stocks_ohlc_unknown_ticker_returns_404(api_client):
    resp = api_client.get(
        "/api/v1/stocks/ZZZZNOTAREALTICKER/ohlc",
        params={"start_date": DATE_ROLLOVER, "end_date": DATE_ROLLOVER},
    )
    assert resp.status_code == 404


def test_stocks_ohlc_valid_ticker_but_date_range_with_no_data_returns_404(api_client, tmp_db):
    ticker = _get_known_eq_ticker(tmp_db)

    resp = api_client.get(
        f"/api/v1/stocks/{ticker}/ohlc",
        params={"start_date": "2019-01-01", "end_date": "2019-01-02"},
    )
    assert resp.status_code == 404


def test_stocks_snapshot_valid_date_returns_records_with_trade_date_field(api_client):
    resp = api_client.get(
        "/api/v1/stocks/snapshot", params={"trade_date": DATE_ROLLOVER}
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert len(rows) >= 1
    assert rows[0]["trade_date"] == DATE_ROLLOVER


def test_stocks_snapshot_date_with_no_data_returns_404(api_client):
    resp = api_client.get(
        "/api/v1/stocks/snapshot", params={"trade_date": DATE_NORMAL_1}
    )
    # DATE_NORMAL_1 was never processed by the api_client fixture
    assert resp.status_code == 404


def test_stocks_snapshot_respects_limit_query_param(api_client):
    resp = api_client.get(
        "/api/v1/stocks/snapshot",
        params={"trade_date": DATE_ROLLOVER, "limit": 5},
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) <= 5


def test_stocks_snapshot_rejects_limit_above_max(api_client):
    resp = api_client.get(
        "/api/v1/stocks/snapshot",
        params={"trade_date": DATE_ROLLOVER, "limit": 5000},
    )
    assert resp.status_code == 422  # FastAPI query validation, le=500
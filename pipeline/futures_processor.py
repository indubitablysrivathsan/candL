"""
NSE Platform — Futures bhav copy processor
===========================================
Filters FinInstrmTp == "STF", groups by (TckrSymb, XpryDt),
computes per-group analytics and writes:

  data/futures/TICKER/EXPIRY/history.csv      — full raw rows, append/dedup
  data/futures/TICKER/EXPIRY/analytics.csv    — one aggregated row per date
  data/futures/rollup.db                      — DuckDB table, one row per
                                                (trade_date, ticker, expiry),
                                                primary key upsert
"""

from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import FUTURES_ROOT, FO_RAW_ROOT, ROLLUP_DB_PATH


# ── Constants ─────────────────────────────────────────────────────────────────

KEEP_COLS = [
    "TradDt", "FinInstrmId", "TckrSymb", "XpryDt",
    "OpnPric", "HghPric", "LwPric", "ClsPric", "LastPric",
    "PrvsClsgPric", "UndrlygPric", "SttlmPric",
    "OpnIntrst", "ChngInOpnIntrst",
    "TtlTradgVol", "TtlTrfVal", "TtlNbOfTxsExctd", "NewBrdLotQty",
]

QUADRANT_MAP = {
    (True,  True):  "long_buildup",    # +OI  +Price
    (True,  False): "short_covering",  # +OI  −Price
    (False, True):  "short_buildup",   # −OI  +Price
    (False, False): "long_unwinding",  # −OI  −Price
}

# DDL run once per write connection — idempotent
_CREATE_ROLLUP_TABLE = """
CREATE TABLE IF NOT EXISTS futures_rollup (
    trade_date      DATE,
    ticker          VARCHAR,
    expiry          VARCHAR,
    close           DOUBLE,
    prev_close      DOUBLE,
    chng_in_price   DOUBLE,
    chng_price_per  DOUBLE,
    chng_in_oi      DOUBLE,
    chng_oi_per     DOUBLE,
    open_int        DOUBLE,
    underlying      DOUBLE,
    quadrant        VARCHAR,
    basis           DOUBLE,
    cost_of_carry   DOUBLE,
    volume_oi_ratio DOUBLE,
    days_to_expiry  INTEGER,
    PRIMARY KEY (trade_date, ticker, expiry)
)
"""

_UPSERT_ROLLUP_ROW = """
INSERT INTO futures_rollup VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (trade_date, ticker, expiry) DO UPDATE SET
    close           = excluded.close,
    prev_close      = excluded.prev_close,
    chng_in_price   = excluded.chng_in_price,
    chng_price_per  = excluded.chng_price_per,
    chng_in_oi      = excluded.chng_in_oi,
    chng_oi_per     = excluded.chng_oi_per,
    open_int        = excluded.open_int,
    underlying      = excluded.underlying,
    quadrant        = excluded.quadrant,
    basis           = excluded.basis,
    cost_of_carry   = excluded.cost_of_carry,
    volume_oi_ratio = excluded.volume_oi_ratio,
    days_to_expiry  = excluded.days_to_expiry
"""


# ── Pure computation helpers ──────────────────────────────────────────────────

def classify_quadrant(chng_oi: float, chng_price: float) -> str:
    return QUADRANT_MAP[(chng_oi >= 0, chng_price >= 0)]


def compute_cost_of_carry(futures_price: float, spot_price: float, days_to_expiry: int) -> float:
    if spot_price == 0 or days_to_expiry <= 0:
        return np.nan
    return (futures_price - spot_price) / spot_price * (365 / days_to_expiry)


# ── File path helper ──────────────────────────────────────────────────────────

def get_raw_fo_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_RAW_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


# ── Reconciliation ────────────────────────────────────────────────────────────

def already_futures_processed(trade_date: str) -> bool:
    """
    Check the rollup DB for the given date.
    Replaces the old glob-over-600-files approach — this is a single
    indexed query and returns in microseconds.
    """
    if not ROLLUP_DB_PATH.exists():
        return False
    trade_date_str = pd.to_datetime(trade_date).strftime("%Y-%m-%d")
    conn = duckdb.connect(str(ROLLUP_DB_PATH), read_only=True)
    try:
        result = conn.execute(
            "SELECT COUNT(*) FROM futures_rollup WHERE trade_date = CAST(? AS DATE)",
            [trade_date_str],
        ).fetchone()
        return result[0] > 0
    except Exception:
        # Table doesn't exist yet, or DB is empty
        return False
    finally:
        conn.close()


# ── CSV writers (kept as reference files) ────────────────────────────────────

def _update_history(base: Path, g: pd.DataFrame, date: str):
    path = base / "history.csv"
    g = g.copy()

    if path.exists():
        existing = pd.read_csv(path)
        updated = pd.concat([existing, g], ignore_index=True)
        updated = updated.drop_duplicates(subset=["TradDt"], keep="last")
    else:
        updated = g

    updated["TradDt"] = pd.to_datetime(updated["TradDt"])
    updated.sort_values("TradDt").to_csv(path, index=False)


def _update_analytics(base: Path, row: dict):
    """Upsert one aggregated row into analytics.csv, keyed on trade_date."""
    path    = base / "analytics.csv"
    new_row = pd.DataFrame([row])

    if path.exists():
        existing = pd.read_csv(path)
        updated  = pd.concat([existing, new_row], ignore_index=True)
        updated  = updated.drop_duplicates(subset=["trade_date"], keep="last")
    else:
        updated = new_row

    updated["trade_date"] = pd.to_datetime(updated["trade_date"])
    updated.sort_values("trade_date").to_csv(path, index=False)


# ── DuckDB rollup writer ──────────────────────────────────────────────────────

def _update_rollup_db(rows: list[dict]):
    """
    Upsert a batch of rollup rows into the persistent DuckDB file.
    One connection opened and closed per processed file — not per row.
    The CREATE TABLE is idempotent so it's safe to run on every call.
    """
    if not rows:
        return

    ROLLUP_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(ROLLUP_DB_PATH))
    try:
        conn.execute(_CREATE_ROLLUP_TABLE)
        for r in rows:
            conn.execute(_UPSERT_ROLLUP_ROW, [
                r["trade_date"],    r["ticker"],          r["expiry"],
                r["close"],         r["prev_close"],      r["chng_in_price"],
                r["chng_price_per"],r["chng_in_oi"],      r["chng_oi_per"],
                r["open_int"],      r["underlying"],      r["quadrant"],
                r["basis"],         r["cost_of_carry"],   r["volume_oi_ratio"],
                r["days_to_expiry"],
            ])
    finally:
        conn.close()


# ── Main processor ────────────────────────────────────────────────────────────

def process_futures_trade_date(trade_date: str):
    raw_file = get_raw_fo_path(trade_date)
    if not raw_file.exists():
        raise FileNotFoundError(raw_file)
    process_futures_file(str(raw_file))


def process_futures_file(file: str, target_ticker: str | None = None):
    df   = pd.read_csv(file)
    date = pd.to_datetime(df["TradDt"].iloc[0]).strftime("%Y-%m-%d")

    df   = df[df["FinInstrmTp"] == "STF"].copy()
    cols = [c for c in KEEP_COLS if c in df.columns]
    df   = df[cols]

    if target_ticker:
        df = df[df["TckrSymb"] == target_ticker]

    for col in [
        "OpnPric", "HghPric", "LwPric", "ClsPric", "LastPric",
        "PrvsClsgPric", "UndrlygPric", "SttlmPric",
        "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol",
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    trade_dt     = pd.to_datetime(date)
    rollup_batch = []   # collected then written in one DB connection

    for (ticker, expiry), g in df.groupby(["TckrSymb", "XpryDt"]):
        base = FUTURES_ROOT / str(ticker) / str(expiry)
        base.mkdir(parents=True, exist_ok=True)

        # ── Aggregate ─────────────────────────────────────────────────────────
        close      = float(g["ClsPric"].mean())
        prev_close = float(g["PrvsClsgPric"].mean())
        underlying = float(g["UndrlygPric"].mean())
        chng_in_oi = float(g["ChngInOpnIntrst"].sum())
        total_vol  = float(g["TtlTradgVol"].sum())
        open_int   = float(g["OpnIntrst"].sum())

        chng_in_price   = close - prev_close
        prev_oi         = open_int - chng_in_oi
        basis           = close - underlying
        days_to_expiry  = max((pd.to_datetime(expiry) - trade_dt).days, 0)
        cost_of_carry   = compute_cost_of_carry(close, underlying, days_to_expiry)
        volume_oi_ratio = total_vol / open_int if open_int > 0 else np.nan
        quadrant        = classify_quadrant(chng_in_oi, chng_in_price)
        chng_price_per = (chng_in_price / prev_close) * 100 if prev_close else np.nan
        chng_oi_per    = (chng_in_oi / prev_oi) * 100 if prev_oi else np.nan

        analytics_row = {
            "trade_date":      date,
            "close":           close,
            "prev_close":      prev_close,
            "chng_in_price":   chng_in_price,
            "chng_price_per":  chng_price_per,
            "chng_in_oi":      chng_in_oi,
            "chng_oi_per":     chng_oi_per,
            "open_int":        open_int,
            "underlying":      underlying,
            "quadrant":        quadrant,
            "basis":           basis,
            "cost_of_carry":   cost_of_carry,
            "volume_oi_ratio": volume_oi_ratio,
            "days_to_expiry":  days_to_expiry,
        }

        # ── Write CSV reference files ─────────────────────────────────────────
        _update_history(base, g, date)
        _update_analytics(base, analytics_row)

        # ── Collect for batch rollup write ────────────────────────────────────
        rollup_batch.append({
            **analytics_row,
            "ticker":   str(ticker),
            "expiry":   str(expiry),
            "open_int": open_int,
        })

        print(f"  ✓ {ticker} / {expiry} / {date}  [{quadrant}]")

    # Write all rollup rows for this file in a single DB connection
    _update_rollup_db(rollup_batch)
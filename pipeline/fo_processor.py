"""
NSE Platform — Unified F&O bhav copy processor
===============================================
Single file read → dispatch on FinInstrmTp:

  STF / IDF  →  futures pipeline
  STO / IDO  →  options pipeline

Output layout is unchanged:

  Futures
  -------
  data/futures/TICKER/EXPIRY/history.csv
  data/futures/TICKER/EXPIRY/analytics.csv
  data/index_futures/TICKER/EXPIRY/history.csv
  data/index_futures/TICKER/EXPIRY/analytics.csv
  data/futures/rollup.db  (DuckDB, upsert)

  Options
  -------
  data/options/TICKER/EXPIRY/DATA/YYYY-MM-DD.csv
  data/options/TICKER/EXPIRY/analytics.csv
  data/index_options/TICKER/EXPIRY/DATA/YYYY-MM-DD.csv
  data/index_options/TICKER/EXPIRY/analytics.csv
"""

from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import glob as _glob

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    FUTURES_ROOT, INDEX_FUTURES_ROOT,
    OPTIONS_ROOT, INDEX_OPTIONS_ROOT,
    FO_RAW_ROOT, ROLLUP_DB_PATH,
)


# ── Column lists ──────────────────────────────────────────────────────────────

_FUTURES_KEEP_COLS = [
    "TradDt", "FinInstrmTp", "FinInstrmId", "TckrSymb", "XpryDt",  # ← added
    "OpnPric", "HghPric", "LwPric", "ClsPric", "LastPric",
    "PrvsClsgPric", "UndrlygPric", "SttlmPric",
    "OpnIntrst", "ChngInOpnIntrst",
    "TtlTradgVol", "TtlTrfVal", "TtlNbOfTxsExctd", "NewBrdLotQty",
]

_OPTIONS_KEEP_COLS = [
    "TradDt", "FinInstrmTp", "FinInstrmId", "TckrSymb", "XpryDt", "StrkPric", "OptnTp",
    "OpnPric", "HghPric", "LwPric", "ClsPric", "LastPric", "PrvsClsgPric",
    "UndrlygPric", "SttlmPric", "OpnIntrst", "ChngInOpnIntrst",
    "TtlTradgVol", "TtlTrfVal", "TtlNbOfTxsExctd", "NewBrdLotQty",
]

_FUTURES_TYPES = {"STF", "IDF"}
_OPTIONS_TYPES = {"STO", "IDO"}


# ── Futures constants ─────────────────────────────────────────────────────────

QUADRANT_MAP = {
    (True,  True):  "long_buildup",
    (False,  True): "short_covering",
    (True, False):  "short_buildup",
    (False, False): "long_unwinding",
}

_CREATE_ROLLUP_TABLE = """
CREATE TABLE IF NOT EXISTS futures_rollup (
    trade_date      DATE,
    ticker          VARCHAR,
    expiry          VARCHAR,
    instrument_type VARCHAR,
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
INSERT INTO futures_rollup VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (trade_date, ticker, expiry) DO UPDATE SET
    instrument_type = excluded.instrument_type,
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


# ── Shared path helper ────────────────────────────────────────────────────────

def get_raw_fo_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_RAW_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


# ── Reconciliation checks ─────────────────────────────────────────────────────

def already_stock_futures_processed(trade_date: str) -> bool:
    """
    Checks whether STF contracts for this date
    already exist in futures_rollup.
    """

    if not ROLLUP_DB_PATH.exists():
        return False

    trade_date = pd.to_datetime(trade_date).strftime("%Y-%m-%d")

    conn = duckdb.connect(str(ROLLUP_DB_PATH), read_only=True)

    try:
        result = conn.execute(
            """
            SELECT COUNT(*)
            FROM futures_rollup
            WHERE
                trade_date = CAST(? AS DATE)
                AND instrument_type = 'STF'
            """,
            [trade_date],
        ).fetchone()

        return result[0] > 0

    except Exception:
        return False

    finally:
        conn.close()


def already_index_futures_processed(trade_date: str) -> bool:
    """
    Checks whether IDF contracts for this date
    already exist in futures_rollup.
    """

    if not ROLLUP_DB_PATH.exists():
        return False

    trade_date = pd.to_datetime(trade_date).strftime("%Y-%m-%d")

    conn = duckdb.connect(str(ROLLUP_DB_PATH), read_only=True)

    try:
        result = conn.execute(
            """
            SELECT COUNT(*)
            FROM futures_rollup
            WHERE
                trade_date = CAST(? AS DATE)
                AND instrument_type = 'IDF'
            """,
            [trade_date],
        ).fetchone()

        return result[0] > 0

    except Exception:
        return False

    finally:
        conn.close()


def already_stock_options_processed(trade_date: str) -> bool:
    """
    Checks whether STO contracts for this date
    already exist in data/options/.
    """

    pattern = (
        OPTIONS_ROOT
        / "*"
        / "*"
        / "DATA"
        / f"{trade_date}.csv"
    )

    matches = _glob.glob(str(pattern))

    return len(matches) > 0


def already_index_options_processed(trade_date: str) -> bool:
    """
    Checks whether IDO contracts for this date
    already exist in data/index_options/.
    """

    pattern = (
        INDEX_OPTIONS_ROOT
        / "*"
        / "*"
        / "DATA"
        / f"{trade_date}.csv"
    )

    matches = _glob.glob(str(pattern))

    return len(matches) > 0


# ── Futures helpers ───────────────────────────────────────────────────────────

def classify_quadrant(chng_oi: float, chng_price: float) -> str:
    return QUADRANT_MAP[(chng_oi >= 0, chng_price >= 0)]


def compute_cost_of_carry(futures_price: float, spot_price: float, days_to_expiry: int) -> float:
    if spot_price == 0 or days_to_expiry <= 0:
        return np.nan
    return (futures_price - spot_price) / spot_price * (365 / days_to_expiry)


def _get_futures_root(instr: str) -> Path:
    return INDEX_FUTURES_ROOT if instr == "IDF" else FUTURES_ROOT


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


def _update_futures_analytics(base: Path, row: dict):
    path = base / "analytics.csv"
    new_row = pd.DataFrame([row])
    if path.exists():
        existing = pd.read_csv(path)
        updated = pd.concat([existing, new_row], ignore_index=True)
        updated = updated.drop_duplicates(subset=["trade_date"], keep="last")
    else:
        updated = new_row
    updated["trade_date"] = pd.to_datetime(
        updated["trade_date"],
        errors="coerce",
        format="mixed",
    )
    updated = updated.dropna(subset=["trade_date"])
    updated.sort_values("trade_date").to_csv(path, index=False)


def _update_rollup_db(rows: list[dict]):
    if not rows:
        return
    ROLLUP_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(ROLLUP_DB_PATH))
    try:
        conn.execute(_CREATE_ROLLUP_TABLE)
        for r in rows:
            conn.execute(_UPSERT_ROLLUP_ROW, [
                r["trade_date"],     r["ticker"],          r["expiry"],
                r["instrument_type"],
                r["close"],          r["prev_close"],      r["chng_in_price"],
                r["chng_price_per"], r["chng_in_oi"],      r["chng_oi_per"],
                r["open_int"],       r["underlying"],      r["quadrant"],
                r["basis"],          r["cost_of_carry"],   r["volume_oi_ratio"],
                r["days_to_expiry"],
            ])
    finally:
        conn.close()


def _process_futures(df: pd.DataFrame, date: str):
    """Process all STF/IDF rows for one trade date."""
    cols = [c for c in _FUTURES_KEEP_COLS if c in df.columns]
    df = df[cols].copy()

    for col in [
        "OpnPric", "HghPric", "LwPric", "ClsPric", "LastPric",
        "PrvsClsgPric", "UndrlygPric", "SttlmPric",
        "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol",
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    trade_dt = pd.to_datetime(date)
    rollup_batch = []

    for (ticker, expiry, instr), g in df.groupby(["TckrSymb", "XpryDt", "FinInstrmTp"]):
        base = _get_futures_root(instr) / str(ticker) / str(expiry)
        base.mkdir(parents=True, exist_ok=True)

        close      = float(g["ClsPric"].mean())
        prev_close = float(g["PrvsClsgPric"].mean())
        underlying = float(g["UndrlygPric"].mean())
        chng_in_oi = float(g["ChngInOpnIntrst"].sum())
        total_vol  = float(g["TtlTradgVol"].sum())
        open_int   = float(g["OpnIntrst"].sum())

        chng_in_price  = close - prev_close
        prev_oi        = open_int - chng_in_oi
        basis          = close - underlying
        days_to_expiry = max((pd.to_datetime(expiry) - trade_dt).days, 0)
        cost_of_carry  = compute_cost_of_carry(close, underlying, days_to_expiry)
        volume_oi_ratio = total_vol / open_int if open_int > 0 else np.nan
        quadrant       = classify_quadrant(chng_in_oi, chng_in_price)
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

        _update_history(base, g, date)
        _update_futures_analytics(base, analytics_row)

        rollup_batch.append({
            **analytics_row,
            "ticker":          str(ticker),
            "expiry":          str(expiry),
            "open_int":        open_int,
            "instrument_type": instr,
        })

        print(f"  ✓ [F] {ticker} / {expiry} / {date}  [{quadrant}]")

    _update_rollup_db(rollup_batch)


# ── Options helpers ───────────────────────────────────────────────────────────

def _get_options_root(instr: str) -> Path:
    return INDEX_OPTIONS_ROOT if instr == "IDO" else OPTIONS_ROOT


def compute_pcr(df: pd.DataFrame):
    ce  = df[df["OptnTp"] == "CE"]["OpnIntrst"].sum()
    pe  = df[df["OptnTp"] == "PE"]["OpnIntrst"].sum()
    pcr = pe / ce if ce != 0 else np.nan
    return pe, ce, pcr


def compute_max_pain(df: pd.DataFrame) -> float:
    strikes = sorted(df["StrkPric"].dropna().unique())
    pain = {}
    for strike in strikes:
        total = 0.0
        for _, row in df.iterrows():
            oi = row["OpnIntrst"]
            k  = row["StrkPric"]
            if row["OptnTp"] == "CE":
                total += max(0, strike - k) * oi
            else:
                total += max(0, k - strike) * oi
        pain[strike] = total
    return float(min(pain, key=pain.get))


def _update_options_analytics(base: Path, date: str, pe, ce, pcr, underlying, max_pain):
    file_path = base / "analytics.csv"
    new_row = pd.DataFrame([{
        "trade_date": date, "pe": pe, "ce": ce,
        "pcr": pcr, "underlying": underlying, "max_pain": max_pain,
    }])
    if file_path.exists():
        existing = pd.read_csv(file_path)
        updated  = pd.concat([existing, new_row], ignore_index=True)
        updated  = updated.drop_duplicates(subset=["trade_date"], keep="last")
    else:
        updated = new_row
    updated["trade_date"] = pd.to_datetime(
        updated["trade_date"],
        errors="coerce",
        format="mixed",
    )
    updated = updated.dropna(subset=["trade_date"])
    updated.sort_values("trade_date").to_csv(file_path, index=False)


def _process_options(df: pd.DataFrame, date: str):
    """Process all STO/IDO rows for one trade date."""
    cols = [c for c in _OPTIONS_KEEP_COLS if c in df.columns]
    df = df[cols].copy()

    for col in ["StrkPric", "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    for (ticker, expiry, instr), g in df.groupby(["TckrSymb", "XpryDt", "FinInstrmTp"]):
        root = _get_options_root(instr)
        base = root / str(ticker) / str(expiry)
        (base / "DATA").mkdir(parents=True, exist_ok=True)

        pe, ce, pcr = compute_pcr(g)
        max_pain    = compute_max_pain(g)
        underlying  = g["UndrlygPric"].mean()

        g.to_csv(base / "DATA" / f"{date}.csv", index=False)
        _update_options_analytics(base, date, pe, ce, pcr, underlying, max_pain)

        print(f"  ✓ [O] {ticker} / {expiry} / {date}")


# ── Unified entry points ──────────────────────────────────────────────────────

def process_file(file: str, target_ticker: str | None = None):
    """
    Read the raw bhav CSV once, split by instrument type,
    and run both pipelines in a single call.
    """
    df   = pd.read_csv(file)
    date = pd.to_datetime(df["TradDt"].iloc[0]).strftime("%Y-%m-%d")

    if target_ticker:
        df = df[df["TckrSymb"] == target_ticker]

    futures_df = df[df["FinInstrmTp"].isin(_FUTURES_TYPES)]
    options_df = df[df["FinInstrmTp"].isin(_OPTIONS_TYPES)]

    if not futures_df.empty:
        _process_futures(futures_df, date)

    if not options_df.empty:
        _process_options(options_df, date)


def process_trade_date(trade_date: str, target_ticker: str | None = None):
    """Options-style entry point (kept for backward compatibility)."""
    raw_file = get_raw_fo_path(trade_date)
    if not raw_file.exists():
        raise FileNotFoundError(raw_file)
    process_file(str(raw_file), target_ticker)


def process_futures_trade_date(trade_date: str):
    """Futures-style entry point (kept for backward compatibility)."""
    process_trade_date(trade_date)


# ── CLI (mirrors original options processor CLI) ──────────────────────────────

if __name__ == "__main__":
    import argparse
    import glob
    import os

    parser = argparse.ArgumentParser(description="NSE F&O bhav copy processor")
    parser.add_argument("--input",  required=True, help="Folder containing raw bhav CSVs")
    parser.add_argument("--ticker", default=None,  help="Process only this ticker (optional)")
    args = parser.parse_args()

    files = glob.glob(os.path.join(args.input, "*.csv"))
    if not files:
        print(f"No CSV files found in {args.input}")
    else:
        print(f"Processing {len(files)} file(s) from {args.input}")
        for f in sorted(files):
            print(f"→ {Path(f).name}")
            process_file(f, args.ticker)
        print("Done.")
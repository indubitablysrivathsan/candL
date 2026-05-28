"""
fii processor — fii_stats_DD-Mon-YYYY.xls
→ fii_stats
"""

import pandas as pd
from pathlib import Path

from config import FII_STATS_ROOT
from api.db import get_conn, is_processed


# Rows we care about — map display label → instrument key stored in DB
_INSTRUMENT_MAP = {
    "INDEX FUTURES":  "INDEX FUTURES",
    "INDEX OPTIONS":  "INDEX OPTIONS",
    "STOCK FUTURES":  "STOCK FUTURES",
    "STOCK OPTIONS":  "STOCK OPTIONS",
    # sub-rows (optional enrichment)
    "BANKNIFTY FUTURES":   "BANKNIFTY FUTURES",
    "FINNIFTY FUTURES":    "FINNIFTY FUTURES",
    "MIDCPNIFTY FUTURES":  "MIDCPNIFTY FUTURES",
    "NIFTY FUTURES":       "NIFTY FUTURES",
    "NIFTYNXT50 FUTURES":  "NIFTYNXT50 FUTURES",
    "BANKNIFTY OPTIONS":   "BANKNIFTY OPTIONS",
    "FINNIFTY OPTIONS":    "FINNIFTY OPTIONS",
    "MIDCPNIFTY OPTIONS":  "MIDCPNIFTY OPTIONS",
    "NIFTY OPTIONS":       "NIFTY OPTIONS",
    "NIFTYNXT50 OPTIONS":  "NIFTYNXT50 OPTIONS",
}


def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FII_STATS_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.xls"


def _parse(path: Path, trade_date: str) -> pd.DataFrame:
    # Skip the header rows — row 0 is title, row 1 is blank, rows 2-3 are col headers
    raw = pd.read_excel(path, header=None)

    rows = []
    for _, row in raw.iterrows():
        label = str(row.iloc[0]).strip().upper()
        if label not in _INSTRUMENT_MAP:
            continue
        try:
            rows.append({
                "trade_date":     trade_date,
                "instrument":     _INSTRUMENT_MAP[label],
                "buy_contracts":  int(row.iloc[1])   if pd.notna(row.iloc[1]) else None,
                "buy_amount_cr":  float(row.iloc[2]) if pd.notna(row.iloc[2]) else None,
                "sell_contracts": int(row.iloc[3])   if pd.notna(row.iloc[3]) else None,
                "sell_amount_cr": float(row.iloc[4]) if pd.notna(row.iloc[4]) else None,
                "oi_contracts":   int(row.iloc[5])   if pd.notna(row.iloc[5]) else None,
                "oi_amount_cr":   float(row.iloc[6]) if pd.notna(row.iloc[6]) else None,
            })
        except (ValueError, IndexError):
            continue
    return pd.DataFrame(rows)


def process(trade_date: str):
    if is_processed(trade_date, "fii"):
        print(f"[fii] {trade_date} already processed, skipping")
        return

    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = _parse(p, trade_date)
    if df.empty:
        print(f"[fii] {trade_date} — no rows parsed")
        return

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        conn.register("_fii_stage", df)
        conn.execute("""
            INSERT INTO fii_stats
            SELECT
                TRY_CAST(trade_date AS DATE),
                instrument,
                buy_contracts, buy_amount_cr,
                sell_contracts, sell_amount_cr,
                oi_contracts, oi_amount_cr
            FROM _fii_stage
            ON CONFLICT (trade_date, instrument) DO UPDATE SET
                buy_contracts  = excluded.buy_contracts,
                buy_amount_cr  = excluded.buy_amount_cr,
                sell_contracts = excluded.sell_contracts,
                sell_amount_cr = excluded.sell_amount_cr,
                oi_contracts   = excluded.oi_contracts,
                oi_amount_cr   = excluded.oi_amount_cr
        """)
        conn.unregister("_fii_stage")
        conn.execute("COMMIT")
        print(f"[fii] {trade_date} — {len(df)} rows")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
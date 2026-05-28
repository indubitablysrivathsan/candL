"""
market_activity processor — MA{DDMMYY}.csv
→ market_activity_summary  (one row per trade_date)
→ market_activity_index    (one row per trade_date × index_name)

File layout (all values in a single sheet, no fixed header row):
  Row 0  : date string in column B (index 1), rest blank
  Row 1  : narrative text
  Row 2  : blank separator
  Row 3  : "Traded Value (Rs. In Crores)"   → col B
  Row 4  : "Traded Quantity (in Lakhs)"      → col B
  Row 5  : "Number of Trades"                → col B
  Row 6  : "Total Market Capitalisation ..."  → col B
  Row 7  : blank separator
  Row 8  : header row  (INDEX | PREVIOUS CLOSE | OPEN | HIGH | LOW | CLOSE | GAIN/LOSS)
  Row 9+ : index data rows
"""

import re
import pandas as pd
from pathlib import Path

from config import MKT_ACTIVITY_ROOT
from api.db import get_conn, is_processed


# ── Path helper ───────────────────────────────────────────────────────────────

def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    # NSE names these MA{DDMMYY}.csv  e.g. MA260526.csv
    fname = f"MA{dt.strftime('%d%m%y')}.csv"
    return Path(MKT_ACTIVITY_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / fname


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_float(val) -> float | None:
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _to_int(val) -> int | None:
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


# ── Parser ────────────────────────────────────────────────────────────────────

def _parse(path: Path, trade_date: str) -> tuple[dict, pd.DataFrame]:
    """
    Returns:
        summary  : dict  matching market_activity_summary columns
        idx_df   : DataFrame matching market_activity_index columns
    """
    raw = pd.read_csv(path, header=None, dtype=str)

    # ── Locate key rows by scanning column A labels ──────────────────────────
    summary = {
        "trade_date":      trade_date,
        "traded_value_cr": None,
        "traded_qty_lacs": None,
        "num_trades":      None,
        "market_cap_cr":   None,
    }

    index_header_row = None   # row index where INDEX/PREVIOUS CLOSE header sits

    for i, row in raw.iterrows():
        label = str(row.iloc[1] if len(row) > 1 else "").strip()   # col B
        label_upper = label.upper()

        if "TRADED VALUE" in label_upper:
            summary["traded_value_cr"] = _to_float(row.iloc[2] if len(row) > 2 else None)
        elif "TRADED QUANTITY" in label_upper:
            summary["traded_qty_lacs"] = _to_float(row.iloc[2] if len(row) > 2 else None)
        elif "NUMBER OF TRADES" in label_upper:
            summary["num_trades"] = _to_int(row.iloc[2] if len(row) > 2 else None)
        elif "MARKET CAPITALISATION" in label_upper or "MARKET CAP" in label_upper:
            summary["market_cap_cr"] = _to_float(row.iloc[2] if len(row) > 2 else None)
        elif label_upper == "INDEX":
            index_header_row = i

    # ── Parse index rows ──────────────────────────────────────────────────────
    idx_rows = []
    if index_header_row is not None:
        for i in range(index_header_row + 1, len(raw)):
            row = raw.iloc[i]
            name = str(row.iloc[1] if len(row) > 1 else "").strip()
            if not name or name.upper() in ("", "NAN", "INDEX"):
                continue
            # Stop if we hit another section header or trailing blank block
            if re.match(r"^\s*$", name):
                continue

            idx_rows.append({
                "trade_date":  trade_date,
                "index_name":  name,
                "prev_close":  _to_float(row.iloc[2] if len(row) > 2 else None),
                "open":        _to_float(row.iloc[3] if len(row) > 3 else None),
                "high":        _to_float(row.iloc[4] if len(row) > 4 else None),
                "low":         _to_float(row.iloc[5] if len(row) > 5 else None),
                "close":       _to_float(row.iloc[6] if len(row) > 6 else None),
                "gain_loss":   _to_float(row.iloc[7] if len(row) > 7 else None),
            })

    idx_df = pd.DataFrame(idx_rows)
    return summary, idx_df


# ── Processor ─────────────────────────────────────────────────────────────────

def process(trade_date: str):
    if is_processed(trade_date, "mkt_act"):
        print(f"[mkt_act] {trade_date} already processed, skipping")
        return

    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    summary, idx_df = _parse(p, trade_date)

    conn = get_conn()
    try:
        conn.execute("BEGIN")

        # ── market_activity_summary ──────────────────────────────────────────
        conn.execute("""
            INSERT INTO market_activity_summary
                (trade_date, traded_value_cr, traded_qty_lacs, num_trades, market_cap_cr)
            VALUES (CAST(? AS DATE), ?, ?, ?, ?)
            ON CONFLICT (trade_date) DO UPDATE SET
                traded_value_cr = excluded.traded_value_cr,
                traded_qty_lacs = excluded.traded_qty_lacs,
                num_trades      = excluded.num_trades,
                market_cap_cr   = excluded.market_cap_cr
        """, [
            summary["trade_date"],
            summary["traded_value_cr"],
            summary["traded_qty_lacs"],
            summary["num_trades"],
            summary["market_cap_cr"],
        ])

        # ── market_activity_index ────────────────────────────────────────────
        if not idx_df.empty:
            idx_df["trade_date"] = pd.to_datetime(idx_df["trade_date"]).dt.date
            for c in ("prev_close", "open", "high", "low", "close", "gain_loss"):
                idx_df[c] = pd.to_numeric(idx_df[c], errors="coerce")

            conn.register("_mkt_idx_stage", idx_df)
            conn.execute("""
                INSERT INTO market_activity_index
                SELECT
                    CAST(trade_date AS DATE),
                    index_name,
                    prev_close, open, high, low, close, gain_loss
                FROM _mkt_idx_stage
                ON CONFLICT (trade_date, index_name) DO UPDATE SET
                    prev_close = excluded.prev_close,
                    open       = excluded.open,
                    high       = excluded.high,
                    low        = excluded.low,
                    close      = excluded.close,
                    gain_loss  = excluded.gain_loss
            """)
            conn.unregister("_mkt_idx_stage")

        conn.execute("COMMIT")
        print(
            f"[mkt_act] {trade_date} — summary OK, "
            f"{len(idx_df)} index rows inserted/updated"
        )

    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
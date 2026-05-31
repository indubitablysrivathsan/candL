"""
processors/mkt_act.py
==============================
Parses the full MA{DDMMYY}.csv file from NSE and loads all five data sections:

  1. market_activity_summary    — traded value / qty / trades / market cap
  2. market_activity_index      — all index OHLC rows
  3. market_activity_breadth    — advances / declines / unchanged / price-band hits
  4. market_activity_top_stocks — top-25 by value, top-5 gainers, top-5 losers
  5. market_activity_security   — every symbol's close / traded value / qty

File layout (single-column CSV, no fixed header row):
  Row 0  : date string in col B (index 1), rest blank
  Row 1  : narrative text (intraday range blurb) — skip
  Row 2  : blank separator
  Row 3  : "Traded Value (Rs. In Crores)"     → col B = label, col C = value
  Row 4  : "Traded Quantity (in Lakhs)"        → col B = label, col C = value
  Row 5  : "Number of Trades"                  → col B = label, col C = value
  Row 6  : "Total Market Capitalisation ..."   → col B = label, col C = value
  Row 7  : blank separator
  Row 8  : INDEX header row
  Row 9+ : index rows  (until blank / next section)
  ...
  After indices:
    ",ADVANCES,<n>"
    ",DECLINES,<n>"
    ",UNCHANGED,<n>"
    blank
    ",Total securities that have hit their price bands today,<n>"
    blank
    ",TOP 25 Securities Today :"
    ",SYMBOL,SERIES,PREV. CLOSE,CLOSE PRICE,%VAR,VALUE(Rs Crs)"
    25 rows …
    blank
    ",Top Five Nifty 50 Gainers:"
    ",SYMBOL,SERIES,CLOSE PRICE,PREV.CLOSE,%CHANGE"
    5 rows …
    blank
    ",Top Five Nifty 50 Losers:"
    5 rows …
    blank
    ",Securities Price Volume Data in Normal market"
    ",SYMBOL,SERIES,CLOSE PRICE,TRADED VALUE,TRADED QUANTITY"
    … many thousands of rows …
"""

from __future__ import annotations

import re
import pandas as pd
from pathlib import Path

from config import MKT_ACT_ROOT
from api.db import get_conn, is_processed


# ── Path helper ───────────────────────────────────────────────────────────────

def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(MKT_ACT_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


# ── Value coercions ───────────────────────────────────────────────────────────

def _float(val) -> float | None:
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _int(val) -> int | None:
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        v = _float(val)
        return int(v) if v is not None else None


def _str(val) -> str | None:
    s = str(val).strip()
    return s if s and s.lower() != "nan" else None


# ── Section detector helpers ──────────────────────────────────────────────────

def _is_blank(row: pd.Series) -> bool:
    return all(str(v).strip() in ("", "nan") for v in row)


def _col(row: pd.Series, idx: int):
    """Safe column access."""
    return row.iloc[idx] if len(row) > idx else None


# ── Main parser ───────────────────────────────────────────────────────────────

def _parse(path: Path, trade_date: str) -> dict:
    raw = pd.read_csv(
        path,
        header=None,
        dtype=str,
        names=range(12),
        on_bad_lines="skip",
        engine="python",
    )

    summary = {
        "trade_date":      trade_date,
        "traded_value_cr": None,
        "traded_qty_lacs": None,
        "num_trades":      None,
        "market_cap_cr":   None,
    }
    breadth = {
        "trade_date":      trade_date,
        "advances":        None,
        "declines":        None,
        "unchanged":       None,
        "price_band_hits": None,
    }
    index_rows: list[dict] = []

    mode = "PREAMBLE"

    for _, row in raw.iterrows():
        b = _str(_col(row, 1)) or ""
        c = _col(row, 2)
        b_upper = b.upper()

        if _is_blank(row):
            continue

        if "TRADED VALUE" in b_upper:
            summary["traded_value_cr"] = _float(c)
            continue
        if "TRADED QUANTITY" in b_upper:
            summary["traded_qty_lacs"] = _float(c)
            continue
        if "NUMBER OF TRADES" in b_upper:
            summary["num_trades"] = _int(c)
            continue
        if "MARKET CAPITALISATION" in b_upper or "MARKET CAP" in b_upper:
            summary["market_cap_cr"] = _float(c)
            continue

        if b_upper == "INDEX":
            mode = "INDEX"
            continue

        if mode == "INDEX":
            if b_upper in ("ADVANCES", "DECLINES", "UNCHANGED"):
                mode = "POST_INDEX"
                # fall through to breadth handling
            else:
                index_rows.append({
                    "trade_date": trade_date,
                    "index_name": b,
                    "prev_close": _float(_col(row, 2)),
                    "open":       _float(_col(row, 3)),
                    "high":       _float(_col(row, 4)),
                    "low":        _float(_col(row, 5)),
                    "close":      _float(_col(row, 6)),
                    "gain_loss":  _float(_col(row, 7)),
                })
                continue

        if mode == "POST_INDEX":
            if b_upper == "ADVANCES":
                breadth["advances"] = _int(c)
            elif b_upper == "DECLINES":
                breadth["declines"] = _int(c)
            elif b_upper == "UNCHANGED":
                breadth["unchanged"] = _int(c)
            elif "PRICE BAND" in b_upper:
                breadth["price_band_hits"] = _int(c)
                break  # done — nothing useful after this
            continue

        # handle the fall-through from INDEX -> POST_INDEX for the first breadth row
        if mode == "INDEX" and b_upper in ("ADVANCES", "DECLINES", "UNCHANGED"):
            mode = "POST_INDEX"
            if b_upper == "ADVANCES":
                breadth["advances"] = _int(c)
            elif b_upper == "DECLINES":
                breadth["declines"] = _int(c)
            elif b_upper == "UNCHANGED":
                breadth["unchanged"] = _int(c)

    return {
        "summary":    summary,
        "index_rows": index_rows,
        "breadth":    breadth,
    }


def _write(conn, parsed: dict, trade_date: str) -> None:
    s   = parsed["summary"]
    b   = parsed["breadth"]
    idx = pd.DataFrame(parsed["index_rows"])

    conn.execute("""
        INSERT INTO market_activity_summary
            (trade_date, traded_value_cr, traded_qty_lacs, num_trades, market_cap_cr)
        VALUES (CAST(? AS DATE), ?, ?, ?, ?)
        ON CONFLICT (trade_date) DO UPDATE SET
            traded_value_cr = excluded.traded_value_cr,
            traded_qty_lacs = excluded.traded_qty_lacs,
            num_trades      = excluded.num_trades,
            market_cap_cr   = excluded.market_cap_cr
    """, [s["trade_date"], s["traded_value_cr"], s["traded_qty_lacs"],
          s["num_trades"], s["market_cap_cr"]])

    if not idx.empty:
        for c in ("prev_close", "open", "high", "low", "close", "gain_loss"):
            idx[c] = pd.to_numeric(idx[c], errors="coerce")
        conn.register("_mkt_idx_stage", idx)
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

    conn.execute("""
        INSERT INTO market_activity_breadth
            (trade_date, advances, declines, unchanged, price_band_hits)
        VALUES (CAST(? AS DATE), ?, ?, ?, ?)
        ON CONFLICT (trade_date) DO UPDATE SET
            advances        = excluded.advances,
            declines        = excluded.declines,
            unchanged       = excluded.unchanged,
            price_band_hits = excluded.price_band_hits
    """, [b["trade_date"], b["advances"], b["declines"],
          b["unchanged"], b["price_band_hits"]])

# ── Public entry point ────────────────────────────────────────────────────────

def process(trade_date: str) -> None:
    if is_processed(trade_date, "mkt_act"):
        print(f"[mkt_act] {trade_date} already processed, skipping")
        return

    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    parsed = _parse(p, trade_date)

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        _write(conn, parsed, trade_date)
        conn.execute("COMMIT")

        n_idx = len(parsed["index_rows"])
        n_ts  = len(parsed["top_stocks"])
        n_sec = len(parsed["security_rows"])
        print(
            f"[mkt_act] {trade_date} — "
            f"summary OK | "
            f"{len(parsed['index_rows'])} index rows | "
            f"breadth OK"
        )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
"""
processors/mkt_act.py
==============================
Parses MA{DDMMYY}.csv from NSE and loads three sections:

  1. market_activity_summary  — traded value / qty / trades / market cap
  2. market_activity_index    — all index OHLC rows
  3. market_activity_breadth  — advances / declines / unchanged / price-band hits

Stops parsing after the price-band-hits row — top-stocks and securities
sections are intentionally ignored.
"""

from __future__ import annotations

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_blank(row: pd.Series) -> bool:
    return all(str(v).strip() in ("", "nan") for v in row)


def _col(row: pd.Series, idx: int):
    return row.iloc[idx] if len(row) > idx else None


# ── Parser ────────────────────────────────────────────────────────────────────

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

    # Actual CSV columns (0-indexed):
    #   col 0  : always empty (leading comma)
    #   col 1  : label / index name
    #   col 2+ : values
    #
    # INDEX data row layout:
    #   col1=name, col2=prev_close, col3=open, col4=high, col5=low, col6=close, col7=gain_loss

    mode = "PREAMBLE"

    for _, row in raw.iterrows():
        if _is_blank(row):
            continue

        b = _str(_col(row, 1)) or ""
        b_upper = b.upper().strip()
        c = _col(row, 2)

        # ── Summary scalars ──────────────────────────────────────────────────
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

        # ── Index section header: ",INDEX,PREVIOUS CLOSE,..." ────────────────
        if b_upper == "INDEX":
            mode = "INDEX"
            continue

        # ── Index data rows ───────────────────────────────────────────────────
        if mode == "INDEX":
            # Transition to breadth when we hit ADVANCES
            if b_upper == "ADVANCES":
                mode = "BREADTH"
                breadth["advances"] = _int(c)
                continue

            # Skip the column-header row that sometimes appears after INDEX
            if b_upper in ("SYMBOL", "PREVIOUS CLOSE", "PREV. CLOSE"):
                continue

            # Real index row
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

        # ── Breadth rows ──────────────────────────────────────────────────────
        if mode == "BREADTH":
            if b_upper == "ADVANCES":
                breadth["advances"] = _int(c)
            elif b_upper == "DECLINES":
                breadth["declines"] = _int(c)
            elif b_upper == "UNCHANGED":
                breadth["unchanged"] = _int(c)
            elif "PRICE BAND" in b_upper:
                breadth["price_band_hits"] = _int(c)
                break  # done — stop reading, ignore rest of file
            continue

    return {
        "summary":    summary,
        "index_rows": index_rows,
        "breadth":    breadth,
    }


# ── DB writer ─────────────────────────────────────────────────────────────────

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
        for col in ("prev_close", "open", "high", "low", "close", "gain_loss"):
            idx[col] = pd.to_numeric(idx[col], errors="coerce")
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
        conn.begin()       # DuckDB: use begin() not execute("BEGIN")
        _write(conn, parsed, trade_date)
        conn.commit()

        print(
            f"[mkt_act] {trade_date} — "
            f"summary OK | "
            f"{len(parsed['index_rows'])} index rows | "
            f"breadth OK "
            f"(A={parsed['breadth']['advances']} "
            f"D={parsed['breadth']['declines']} "
            f"U={parsed['breadth']['unchanged']} "
            f"PB={parsed['breadth']['price_band_hits']})"
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
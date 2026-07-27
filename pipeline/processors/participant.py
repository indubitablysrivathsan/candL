"""
participant processor — fao_participant_oi + fao_participant_vol
→ participant_activity

Both files have identical structure, processed together.
"""

import pandas as pd
from pathlib import Path

from config import PART_OI_ROOT, PART_VOL_ROOT
from api.db import get_conn, is_processed


# Column → (asset_class, direction, option_side)
_COL_META = {
    "Future Index Long":       ("INDEX",        "long",  "NA"),
    "Future Index Short":      ("INDEX",        "short", "NA"),
    "Future Stock Long":       ("STOCK",        "long",  "NA"),
    "Future Stock Short":      ("STOCK",        "short", "NA"),
    "Option Index Call Long":  ("INDEX",        "long",  "CE"),
    "Option Index Put Long":   ("INDEX",        "long",  "PE"),
    "Option Index Call Short": ("INDEX",        "short", "CE"),
    "Option Index Put Short":  ("INDEX",        "short", "PE"),
    "Option Stock Call Long":  ("STOCK",        "long",  "CE"),
    "Option Stock Put Long":   ("STOCK",        "long",  "PE"),
    "Option Stock Call Short": ("STOCK",        "short", "CE"),
    "Option Stock Put Short":  ("STOCK",        "short", "PE"),
}

_PARTICIPANTS = {"Client", "DII", "FII", "Pro"}


def _raw_path(root, trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(root) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def _find_header_row(path: Path, max_lines: int = 3) -> int:
    """Return the row index (0-based) where the real header lives."""
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for i in range(max_lines):
            line = f.readline()
            if not line:
                break
            if line.strip().startswith("Client Type"):
                return i
    raise ValueError(f"{path}: could not locate header row (no 'Client Type' in first {max_lines} lines)")


def _parse_file(path: Path, trade_date: str, metric_type: str) -> pd.DataFrame:
    header_row = _find_header_row(path)
    raw = pd.read_csv(path, header=header_row)
    raw.columns = [str(c).strip() for c in raw.columns]

    # Strip column names and filter to known participants
    raw["Client Type"] = raw["Client Type"].str.strip()
    raw = raw[raw["Client Type"].isin(_PARTICIPANTS)]

    rows = []
    for _, r in raw.iterrows():
        participant = r["Client Type"]
        for col, (asset_class, direction, option_side) in _COL_META.items():
            if col not in raw.columns:
                continue
            raw_val = r.get(col)

            if isinstance(raw_val, str):
                raw_val = raw_val.replace(",", "").strip()

            val = pd.to_numeric(raw_val, errors="coerce")

            if pd.isna(val):
                continue
            rows.append({
                "trade_date":      trade_date,
                "participant_type": participant,
                "metric_type":     metric_type,
                "asset_class":     asset_class,
                "direction":       direction,
                "option_side":     option_side,
                "contracts":       int(val),
            })
    return pd.DataFrame(rows)


def process(trade_date: str):
    oi_done  = is_processed(trade_date, "part_oi")
    vol_done = is_processed(trade_date, "part_vol")

    if oi_done and vol_done:
        print(f"[participant] {trade_date} already processed, skipping")
        return

    frames = []

    # OI
    if not oi_done:
        p = _raw_path(PART_OI_ROOT, trade_date)
        if p.exists():
            df = _parse_file(p, trade_date, "OI")
            if not df.empty:
                frames.append(df)
        else:
            print(f"[participant] {trade_date} — OI file missing")

    # VOL
    if not vol_done:
        p = _raw_path(PART_VOL_ROOT, trade_date)
        if p.exists():
            df = _parse_file(p, trade_date, "VOL")
            if not df.empty:
                frames.append(df)
        else:
            print(f"[participant] {trade_date} — VOL file missing")

    if not frames:
        print(f"[participant] {trade_date} — nothing to process")
        return

    df = pd.concat(frames, ignore_index=True)

    conn = get_conn()
    try:
        conn.execute("BEGIN")
        conn.register("_part_stage", df)
        conn.execute("""
            INSERT INTO participant_activity
            SELECT
                TRY_CAST(trade_date AS DATE),
                participant_type, metric_type, asset_class,
                direction, option_side,
                contracts
            FROM _part_stage
            ON CONFLICT (trade_date, participant_type, metric_type, asset_class, direction, option_side)
            DO UPDATE SET contracts = excluded.contracts
        """)
        conn.unregister("_part_stage")
        conn.execute("COMMIT")
        print(f"[participant] {trade_date} — {len(df)} rows")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
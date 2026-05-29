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


def _parse_file(path: Path, trade_date: str, metric_type: str) -> pd.DataFrame:
    raw = pd.read_csv(path, header=None, skiprows=1)
    # First row after skip is the header
    raw.columns = [str(c).strip() for c in raw.iloc[0]]
    raw = raw[1:].reset_index(drop=True)

    # Strip column names and filter to known participants
    raw["Client Type"] = raw["Client Type"].str.strip()
    raw = raw[raw["Client Type"].isin(_PARTICIPANTS)]

    rows = []
    for _, r in raw.iterrows():
        participant = r["Client Type"]
        for col, (asset_class, direction, option_side) in _COL_META.items():
            if col not in raw.columns:
                continue
            val = pd.to_numeric(r.get(col), errors="coerce")
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
    if not oi_done:
        p = _raw_path(PART_OI_ROOT, trade_date)
        if not p.exists():
            raise FileNotFoundError(p)
        frames.append(_parse_file(p, trade_date, "OI"))

    if not vol_done:
        p = _raw_path(PART_VOL_ROOT, trade_date)
        if not p.exists():
            raise FileNotFoundError(p)
        frames.append(_parse_file(p, trade_date, "VOL"))

    df = pd.concat(frames, ignore_index=True)
    if df.empty:
        print(f"[participant] {trade_date} — no rows parsed")
        return

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
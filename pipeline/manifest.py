from pathlib import Path
import pandas as pd

from config import MANIFEST_PATH

# Download flags  → 1 = file on disk
# Process flags   → 1 = ingested into DB

COLUMNS = [
    "trade_date",
    "status",

    # F&O bhavcopy (existing, renamed fo → fo_dl)
    "fo_dl",
    "sto_pr",          # stock options processed
    "ido_pr",          # index options processed
    "stf_pr",          # stock futures processed
    "idf_pr",          # index futures processed

    # New download flags
    "eq_bhav_dl",
    "cm_bhav_dl",
    "fii_dl",
    "part_oi_dl",
    "part_vol_dl",
    "fo_volt_dl",
    "mkt_act_dl",

    # New process flags
    "eq_bhav_pr",
    "cm_bhav_pr",
    "fii_pr",
    "part_oi_pr",
    "part_vol_pr",
    "fo_volt_pr",
    "mkt_act_pr",
]

_FLAG_COLS = [c for c in COLUMNS if c not in ("trade_date", "status")]

# ── old column name → new column name (for auto-upgrade) ──────────────────────
_RENAMES = {
    "fo": "fo_dl",
}


def ensure_manifest_exists():
    path = Path(MANIFEST_PATH)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(columns=COLUMNS).to_csv(path, index=False)


def load_manifest() -> pd.DataFrame:
    ensure_manifest_exists()

    df = pd.read_csv(MANIFEST_PATH, dtype={"trade_date": str})

    if not df.empty:
        df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.strftime("%Y-%m-%d")

    if df.empty:
        return pd.DataFrame(columns=COLUMNS)

    # Rename legacy columns (fo → fo_dl)
    df = df.rename(columns=_RENAMES)

    # Add any missing columns introduced in newer schema
    for col in COLUMNS:
        if col not in df.columns:
            df[col] = "" if col in ("trade_date", "status") else 0

    # Coerce all flag columns to int8
    for col in _FLAG_COLS:
        df[col] = (
            pd.to_numeric(df[col], errors="coerce")
            .fillna(0)
            .astype("int8")
        )

    return df[COLUMNS]


def save_manifest(df: pd.DataFrame):
    df = df.sort_values("trade_date")
    df.to_csv(MANIFEST_PATH, index=False)


# ── helpers ───────────────────────────────────────────────────────────────────

def has_date(trade_date: str) -> bool:
    return trade_date in load_manifest()["trade_date"].values


def get_status(trade_date: str):
    df = load_manifest()
    row = df[df["trade_date"] == trade_date]
    return None if row.empty else row.iloc[0]["status"]


def _upsert(trade_date: str, status: str, **flag_updates):
    """
    Insert or update a manifest row.
    Pass flag columns as kwargs, e.g. fo_dl=1, eq_bhav_dl=1.
    """
    df = load_manifest()

    if trade_date not in df["trade_date"].values:
        new_row = {c: 0 for c in _FLAG_COLS}
        new_row["trade_date"] = trade_date
        new_row["status"]     = status
        new_row.update(flag_updates)
        df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    else:
        df.loc[df["trade_date"] == trade_date, "status"] = status
        for col, val in flag_updates.items():
            df.loc[df["trade_date"] == trade_date, col] = val

    save_manifest(df)


def _set_flag(trade_date: str, col: str, val: int = 1):
    df = load_manifest()

    if trade_date not in df["trade_date"].values:
        new_row = {c: 0 for c in _FLAG_COLS}
        new_row["trade_date"] = trade_date
        new_row["status"] = ""
        new_row[col] = val
        df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    else:
        df.loc[df["trade_date"] == trade_date, col] = val

    save_manifest(df)


# ── status setters ────────────────────────────────────────────────────────────

def mark_downloaded(trade_date: str):
    _upsert(trade_date, status="complete", fo_dl=1)

def mark_market_closed(trade_date: str):
    _upsert(trade_date, status="market_closed", fo_dl=0)

def mark_failed(trade_date: str):
    _upsert(trade_date, status="failed", fo_dl=0)


# ── download flag setters ─────────────────────────────────────────────────────

def mark_eq_bhav_downloaded(trade_date: str):   _set_flag(trade_date, "eq_bhav_dl")
def mark_cm_bhav_downloaded(trade_date: str):   _set_flag(trade_date, "cm_bhav_dl")
def mark_fii_downloaded(trade_date: str):       _set_flag(trade_date, "fii_dl")
def mark_part_oi_downloaded(trade_date: str):   _set_flag(trade_date, "part_oi_dl")
def mark_part_vol_downloaded(trade_date: str):  _set_flag(trade_date, "part_vol_dl")
def mark_fo_volt_downloaded(trade_date: str):   _set_flag(trade_date, "fo_volt_dl")
def mark_mkt_act_downloaded(trade_date: str):   _set_flag(trade_date, "mkt_act_dl")


# ── process flag setters ──────────────────────────────────────────────────────

# FO (existing)
def mark_stock_options_processed(trade_date: str):  _set_flag(trade_date, "sto_pr")
def mark_index_options_processed(trade_date: str):  _set_flag(trade_date, "ido_pr")
def mark_stock_futures_processed(trade_date: str):  _set_flag(trade_date, "stf_pr")
def mark_index_futures_processed(trade_date: str):  _set_flag(trade_date, "idf_pr")

# New
def mark_eq_bhav_processed(trade_date: str):    _set_flag(trade_date, "eq_bhav_pr")
def mark_cm_bhav_processed(trade_date: str):    _set_flag(trade_date, "cm_bhav_pr")
def mark_fii_processed(trade_date: str):        _set_flag(trade_date, "fii_pr")
def mark_part_oi_processed(trade_date: str):    _set_flag(trade_date, "part_oi_pr")
def mark_part_vol_processed(trade_date: str):   _set_flag(trade_date, "part_vol_pr")
def mark_fo_volt_processed(trade_date: str):    _set_flag(trade_date, "fo_volt_pr")
def mark_mkt_act_processed(trade_date: str):    _set_flag(trade_date, "mkt_act_pr")


# ── unprocessed date getters ──────────────────────────────────────────────────

def _unprocessed(dl_col: str, pr_col: str) -> list[str]:
    df = load_manifest()
    return df[(df[dl_col] == 1) & (df[pr_col] != 1)]["trade_date"].tolist()

# FO (existing)
def get_stock_options_unprocessed_dates():  return _unprocessed("fo_dl", "sto_pr")
def get_index_options_unprocessed_dates():  return _unprocessed("fo_dl", "ido_pr")
def get_stock_futures_unprocessed_dates():  return _unprocessed("fo_dl", "stf_pr")
def get_index_futures_unprocessed_dates():  return _unprocessed("fo_dl", "idf_pr")

# New
def get_eq_bhav_unprocessed_dates():    return _unprocessed("eq_bhav_dl",  "eq_bhav_pr")
def get_cm_bhav_unprocessed_dates():    return _unprocessed("cm_bhav_dl",  "cm_bhav_pr")
def get_fii_unprocessed_dates():        return _unprocessed("fii_dl",      "fii_pr")
def get_part_oi_unprocessed_dates():    return _unprocessed("part_oi_dl",  "part_oi_pr")
def get_part_vol_unprocessed_dates():   return _unprocessed("part_vol_dl", "part_vol_pr")
def get_fo_volt_unprocessed_dates():    return _unprocessed("fo_volt_dl",  "fo_volt_pr")
def get_mkt_act_unprocessed_dates():    return _unprocessed("mkt_act_dl",  "mkt_act_pr")
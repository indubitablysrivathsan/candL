from pathlib import Path
import pandas as pd
from datetime import datetime

from config import MANIFEST_PATH

COLUMNS = [
    "trade_date",
    "status",
    "fo",
    "fo_process",
]


def ensure_manifest_exists():
    """
    Create manifest.csv if missing.
    """
    path = Path(MANIFEST_PATH)

    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)

        df = pd.DataFrame(columns=COLUMNS)
        df.to_csv(path, index=False)


def load_manifest() -> pd.DataFrame:
    """
    Load manifest CSV safely.
    """
    ensure_manifest_exists()

    df = pd.read_csv(
        MANIFEST_PATH,
        dtype={"trade_date": str}
    )

    df["trade_date"] = (
        pd.to_datetime(df["trade_date"])
        .dt.strftime("%Y-%m-%d")
    )

    if df.empty:
        return pd.DataFrame(columns=COLUMNS)
    
    # Auto-upgrade older manifest schemas
    for col in COLUMNS:

        if col not in df.columns:

            if col.endswith("_process"):
                df[col] = 0
            else:
                df[col] = ""

    df = df[COLUMNS]

    return df


def save_manifest(df: pd.DataFrame):
    """
    Persist manifest to disk.
    """
    df = df.sort_values("trade_date")
    df.to_csv(MANIFEST_PATH, index=False)


def has_date(trade_date: str) -> bool:
    """
    Check whether date already exists in manifest.
    """
    df = load_manifest()

    return trade_date in df["trade_date"].values


def get_status(trade_date: str):
    """
    Get status for a given date.
    """
    df = load_manifest()

    row = df[df["trade_date"] == trade_date]

    if row.empty:
        return None

    return row.iloc[0]["status"]


def update_date(
    trade_date: str,
    status: str,
    fo: int = 0,
    fo_process: int = 0,
):
    """
    Insert or update a manifest row.
    """
    df = load_manifest()

    new_row = {
        "trade_date": trade_date,
        "status": status,
        "fo": fo,
        "fo_process": 0,
    }

    if trade_date in df["trade_date"].values:
        df.loc[df["trade_date"] == trade_date, list(new_row.keys())] = list(
            new_row.values()
        )
    else:
        df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)

    save_manifest(df)


def mark_downloaded(trade_date: str):
    update_date(
        trade_date=trade_date,
        status="complete",
        fo=1,
        fo_process=0
    )

def mark_processed(trade_date: str):

    df = load_manifest()

    df.loc[
        df["trade_date"] == trade_date,
        "fo_process"
    ] = 1

    save_manifest(df)

def mark_market_closed(trade_date: str):
    update_date(
        trade_date=trade_date,
        status="market_closed",
        fo=0,
    )


def mark_failed(trade_date: str):
    update_date(
        trade_date=trade_date,
        status="failed",
        fo=0,
    )

def get_unprocessed_dates():

    df = load_manifest()

    rows = df[
        (df["fo"] == 1) &
        (df["fo_process"] != 1)
    ]

    return rows["trade_date"].tolist()
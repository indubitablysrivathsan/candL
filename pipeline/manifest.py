from pathlib import Path
import pandas as pd
from datetime import datetime

from config import MANIFEST_PATH

COLUMNS = [
    "trade_date",
    "status",

    "fo",
    "sto",
    "ido",
    "stf",
    "idf",
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

            if col in ["fo", "sto", "ido", "stf", "idf"]:
                df[col] = 0
            else:
                df[col] = ""

    for col in ["fo", "sto", "ido", "stf", "idf"]:
        df[col] = (
            pd.to_numeric(df[col], errors="coerce")
            .fillna(0)
            .astype("int8")
        )

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
    fo: int | None = None,
):
    """
    Insert or update a manifest row safely.
    """
    df = load_manifest()

    if trade_date not in df["trade_date"].values:

        new_row = {
            "trade_date": trade_date,
            "status": status,

            "fo": 0,

            "sto": 0,
            "ido": 0,

            "stf": 0,
            "idf": 0,
        }

        if fo is not None:
            new_row["fo"] = fo

        df = pd.concat(
            [df, pd.DataFrame([new_row])],
            ignore_index=True,
        )

    else:
        df.loc[df["trade_date"] == trade_date, "status"] = status
        if fo is not None:
            df.loc[df["trade_date"] == trade_date, "fo"] = fo

    save_manifest(df)


def mark_downloaded(trade_date: str):
    update_date(
        trade_date=trade_date,
        status="complete",
        fo=1,
    )

def mark_stock_options_processed(trade_date: str):
    df = load_manifest()
    df.loc[df["trade_date"] == trade_date, "sto"] = 1
    save_manifest(df)


def mark_index_options_processed(trade_date: str):
    df = load_manifest()
    df.loc[df["trade_date"] == trade_date, "ido"] = 1
    save_manifest(df)


def mark_stock_futures_processed(trade_date: str):
    df = load_manifest()
    df.loc[df["trade_date"] == trade_date, "stf"] = 1
    save_manifest(df)


def mark_index_futures_processed(trade_date: str):
    df = load_manifest()
    df.loc[df["trade_date"] == trade_date, "idf"] = 1
    save_manifest(df)


def get_stock_options_unprocessed_dates():
    df = load_manifest()
    rows = df[
        (df["fo"] == 1)
        & (df["sto"] != 1)
    ]
    return rows["trade_date"].tolist()


def get_index_options_unprocessed_dates():
    df = load_manifest()
    rows = df[
        (df["fo"] == 1)
        & (df["ido"] != 1)
    ]
    return rows["trade_date"].tolist()


def get_stock_futures_unprocessed_dates():
    df = load_manifest()
    rows = df[
        (df["fo"] == 1)
        & (df["stf"] != 1)
    ]
    return rows["trade_date"].tolist()


def get_index_futures_unprocessed_dates():
    df = load_manifest()
    rows = df[
        (df["fo"] == 1)
        & (df["idf"] != 1)
    ]
    return rows["trade_date"].tolist()


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
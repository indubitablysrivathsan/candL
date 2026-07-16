from datetime import datetime, timedelta
import pandas as pd

def generate_date_range(start_date: str, end_date: str):
    """
    Generate inclusive YYYY-MM-DD date range.
    """

    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")

    current = start

    dates = []

    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)

    return dates


def get_missing_dates(manifest_df, start_date: str, end_date: str):
    expected = generate_date_range(start_date, end_date)

    if manifest_df.empty:
        return expected

    existing = set(manifest_df["trade_date"].values)

    failed = set(
        manifest_df.loc[
            manifest_df["status"] == "failed",
            "trade_date"
        ]
    )

    partial = set(
        manifest_df.loc[
            manifest_df["status"] == "partial",
            "trade_date"
        ]
    )

    return [
        d for d in expected
        if d not in existing or d in failed or d in partial
    ]

def get_next_confirmed_trading_date(manifest_df, file_date: str):
    """
    Returns the earliest trade_date in the manifest strictly after
    file_date that has confirmed market data (fo_dl or eq_bhav_dl == 1).
    Returns None if no later confirmed date exists yet — meaning
    file_date is still the 'latest' file and its effective trade_date
    (file_date + 1 trading day) is unconfirmed.
    """
    later = manifest_df[manifest_df["trade_date"] > file_date]
    confirmed = later[(later["fo_dl"] == 1) | (later["eq_bhav_dl"] == 1)]
    if confirmed.empty:
        return None
    return confirmed["trade_date"].min()

def get_previous_trading_date(manifest: pd.DataFrame, trade_date: str) -> str | None:
    """Latest trade_date strictly before `trade_date` with a real (non
    market-closed) session — used to check the prior day's masters are done."""
    earlier = manifest[
        (manifest["trade_date"] < trade_date) &
        (manifest["status"] != "market_closed")
    ].sort_values("trade_date")
    return None if earlier.empty else earlier.iloc[-1]["trade_date"]
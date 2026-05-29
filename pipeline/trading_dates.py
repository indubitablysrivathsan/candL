from datetime import datetime, timedelta


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
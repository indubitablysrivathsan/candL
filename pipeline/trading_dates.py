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
    """
    Compare manifest against expected dates.
    """

    expected = generate_date_range(start_date, end_date)

    existing = set(manifest_df["trade_date"].values)

    missing = [
        d for d in expected
        if d not in existing
    ]

    return missing
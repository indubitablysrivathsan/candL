from pathlib import Path
from datetime import datetime
import requests
import zipfile
import io

from config import FO_RAW_ROOT

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 "
        "(KHTML, like Gecko) "
        "Chrome/136.0 Safari/537.36"
    )
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

def build_fo_url(trade_date: str) -> str:
    """
    Build NSE FO bhavcopy archive URL.

    Input:
        2026-05-20

    Output:
        https://...20260520...
    """

    compact = trade_date.replace("-", "")

    return (
        "https://nsearchives.nseindia.com/content/fo/"
        f"BhavCopy_NSE_FO_0_0_0_{compact}_F_0000.csv.zip"
    )


def get_fo_output_path(trade_date: str) -> Path:
    """
    Create raw FO folder structure:

    raw/fo/2026/05/2026-05-20.csv
    """

    dt = datetime.strptime(trade_date, "%Y-%m-%d")

    year = dt.strftime("%Y")
    month = dt.strftime("%m")

    folder = Path(FO_RAW_ROOT) / year / month

    folder.mkdir(parents=True, exist_ok=True)

    return folder / f"{trade_date}.csv"


def extract_csv_from_zip(content: bytes) -> bytes:
    """
    Extract first CSV from NSE zip payload.
    """

    with zipfile.ZipFile(io.BytesIO(content)) as zf:

        csv_files = [
            f for f in zf.namelist()
            if f.lower().endswith(".csv")
        ]

        if not csv_files:
            raise Exception("No CSV inside ZIP")

        first_csv = csv_files[0]

        return zf.read(first_csv)

def is_today(trade_date: str) -> bool:

    today = datetime.today().strftime("%Y-%m-%d")

    return trade_date == today

def download_fo_bhav(trade_date: str) -> str:
    """
    Download one FO bhavcopy.

    Returns:
        complete
        market_closed
        failed
    """

    url = build_fo_url(trade_date)

    output_path = get_fo_output_path(trade_date)

    try:

        response = SESSION.get(
            url,
            timeout=30,
        )

        # NSE returns 404 for weekends/holidays
        if response.status_code == 404:

            # NSE may not have uploaded today's file yet
            if is_today(trade_date):
                return "failed"

            return "market_closed"

        response.raise_for_status()

        csv_bytes = extract_csv_from_zip(response.content)

        with open(output_path, "wb") as f:
            f.write(csv_bytes)

        return "complete"

    except requests.HTTPError as e:

        print(f"HTTP Error: {e}")

        return "failed"

    except Exception as e:

        print(f"Download Error: {e}")

        return "failed"
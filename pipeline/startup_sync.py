from datetime import datetime, timedelta

from config import (
    SYNC_START_DATE,
)

from pipeline.manifest import (
    load_manifest,
    mark_downloaded,
    mark_options_processed,
    mark_futures_processed,
    mark_market_closed,
    mark_failed,
    get_options_unprocessed_dates,
    get_futures_unprocessed_dates,
)

from pipeline.options_processor import (
    process_trade_date,
    already_processed,
)

from pipeline.futures_processor import (
    process_futures_trade_date,
    already_futures_processed,
)

from pipeline.trading_dates import get_missing_dates

from pipeline.downloader import download_fo_bhav


def run_startup_sync():

    print("────────────── NSE STARTUP SYNC ──────────────\n")

    manifest = load_manifest()

    start_date = SYNC_START_DATE

    today = datetime.today().strftime("%Y-%m-%d")

    missing_dates = get_missing_dates(
        manifest,
        start_date,
        today,
    )

    if not missing_dates:
        print("✓ No missing dates.")

    print(f"Found {len(missing_dates)} missing dates.\n")

    for trade_date in missing_dates:

        print(f"Downloading {trade_date} ...")

        result = download_fo_bhav(trade_date)

        if result == "complete":
            mark_downloaded(trade_date)
            print(f"✓ Complete: {trade_date}")

        elif result == "market_closed":
            mark_market_closed(trade_date)
            print(f"• Market Closed: {trade_date}")

        else:
            if trade_date == today:

                print(f"⟳ Pending NSE upload: {trade_date}")

            else:

                mark_failed(trade_date)

                print(f"✗ Failed: {trade_date}")

    print("\nChecking options processing state...\n")

    for trade_date in get_options_unprocessed_dates():
        try:
            if already_processed(trade_date):
                print(f"✓ Already processed (options): {trade_date}")
                mark_options_processed(trade_date)
                continue
            print(f"Processing options {trade_date} ...")
            process_trade_date(trade_date)
            mark_options_processed(trade_date)
            print(f"✓ Options processed: {trade_date}")
        except Exception as e:
            print(f"✗ Options processing failed: {trade_date}")
            print(e)

    print("\nChecking futures processing state...\n")

    for trade_date in get_futures_unprocessed_dates():
        try:
            if already_futures_processed(trade_date):
                print(f"✓ Already processed (futures): {trade_date}")
                mark_futures_processed(trade_date)
                continue
            print(f"Processing futures {trade_date} ...")
            process_futures_trade_date(trade_date)
            mark_futures_processed(trade_date)
            print(f"✓ Futures processed: {trade_date}")
        except Exception as e:
            print(f"✗ Futures processing failed: {trade_date}")
            print(e)

    print("\n✓ Startup sync complete.\n")
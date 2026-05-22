from datetime import datetime

from config import SYNC_START_DATE

from pipeline.manifest import (
    load_manifest,
    mark_downloaded,

    mark_stock_options_processed,
    mark_index_options_processed,

    mark_stock_futures_processed,
    mark_index_futures_processed,

    mark_market_closed,
    mark_failed,

    get_stock_options_unprocessed_dates,
    get_index_options_unprocessed_dates,

    get_stock_futures_unprocessed_dates,
    get_index_futures_unprocessed_dates,
)

from pipeline.fo_processor import (
    process_trade_date,

    already_stock_options_processed,
    already_index_options_processed,

    already_stock_futures_processed,
    already_index_futures_processed,
)

from pipeline.trading_dates import get_missing_dates
from pipeline.downloader import download_fo_bhav


def run_startup_sync():

    print("────────────── NSE STARTUP SYNC ──────────────\n")

    manifest   = load_manifest()
    today      = datetime.today().strftime("%Y-%m-%d")

    missing_dates = get_missing_dates(manifest, SYNC_START_DATE, today)

    if not missing_dates:
        print("✓ No missing dates.")
    else:
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

    print("\nChecking processing state...\n")

    all_dates = set()

    all_dates.update(get_stock_options_unprocessed_dates())
    all_dates.update(get_index_options_unprocessed_dates())

    all_dates.update(get_stock_futures_unprocessed_dates())
    all_dates.update(get_index_futures_unprocessed_dates())

    for trade_date in sorted(all_dates):

        try:

            stock_opt_done = already_stock_options_processed(trade_date)
            index_opt_done = already_index_options_processed(trade_date)

            stock_fut_done = already_stock_futures_processed(trade_date)
            index_fut_done = already_index_futures_processed(trade_date)

            missing = []

            if not stock_opt_done:
                missing.append("STO")

            if not index_opt_done:
                missing.append("IDO")

            if not stock_fut_done:
                missing.append("STF")

            if not index_fut_done:
                missing.append("IDF")

            # ── Nothing missing ─────────────────────────────────────────────

            if not missing:

                print(f"✓ Already fully processed: {trade_date}")

                mark_stock_options_processed(trade_date)
                mark_index_options_processed(trade_date)

                mark_stock_futures_processed(trade_date)
                mark_index_futures_processed(trade_date)

                continue

            # ── Process once ───────────────────────────────────────────────

            print(
                f"Processing {trade_date} "
                f"(missing: {', '.join(missing)}) ..."
            )

            process_trade_date(trade_date)

            # ── Re-check after processing ──────────────────────────────────

            if already_stock_options_processed(trade_date):
                mark_stock_options_processed(trade_date)

            if already_index_options_processed(trade_date):
                mark_index_options_processed(trade_date)

            if already_stock_futures_processed(trade_date):
                mark_stock_futures_processed(trade_date)

            if already_index_futures_processed(trade_date):
                mark_index_futures_processed(trade_date)

            print(f"✓ Processing complete: {trade_date}")

        except Exception as e:

            print(f"✗ Processing failed: {trade_date}")
            print(e)

    print("\n✓ Startup sync complete.\n")
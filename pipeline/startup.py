"""
NSE Platform — Startup Pipeline
=================================
Called once when the FastAPI app starts.

Flow:
  1. Find dates in processed_dates.json
  2. Download bhav copies for any missing weekday dates up to yesterday
  3. Process each downloaded file through the options processor
  4. Mark each date as processed

This means every time you launch the app it silently catches up —
no scheduler, no manual runs, no server required.
"""

import logging
from datetime import date
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.downloader import download_missing, mark_processed, get_processed_dates
from pipeline.processor  import process_file

log = logging.getLogger(__name__)


def run_startup_pipeline():
    log.info("=" * 55)
    log.info("NSE Platform — startup pipeline")
    log.info("=" * 55)

    already = get_processed_dates()
    log.info(f"Already processed: {len(already)} date(s)")

    # Step 1: download everything missing
    downloaded = download_missing()

    if not downloaded:
        log.info("Nothing new to process. Dashboard is up to date.")
        return

    # Step 2: process each downloaded CSV
    succeeded = []
    failed    = []

    for csv_path in downloaded:
        # Extract YYYY-MM-DD from the parent folder name
        trade_date_str = csv_path.parent.name   # e.g. "2026-01-23"
        log.info(f"Processing {trade_date_str}…")
        try:
            process_file(str(csv_path))
            mark_processed(trade_date_str)
            succeeded.append(trade_date_str)
            log.info(f"  ✓ {trade_date_str} complete")
        except Exception as e:
            failed.append(trade_date_str)
            log.error(f"  ✗ {trade_date_str} failed: {e}")

    log.info("-" * 55)
    log.info(f"Pipeline done — {len(succeeded)} processed, {len(failed)} failed")
    if failed:
        log.warning(f"Failed dates: {failed}")
    log.info("=" * 55)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
    run_startup_pipeline()

"""
NSE Platform — Scheduler
=========================
Runs the downloader + processor automatically after market close.

Usage (keep running in background):
    python pipeline/scheduler.py

Requires the downloader.py to be implemented first.
"""

from apscheduler.schedulers.blocking import BlockingScheduler
from pathlib import Path
import sys, logging

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import SCHEDULER_HOUR, SCHEDULER_MINUTE

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

scheduler = BlockingScheduler(timezone="Asia/Kolkata")


@scheduler.scheduled_job("cron", hour=SCHEDULER_HOUR, minute=SCHEDULER_MINUTE)
def daily_pipeline():
    log.info("▶ Starting daily pipeline...")
    # TODO: implement downloader.py then wire it in here
    # from pipeline.downloader import download_bhav
    # from pipeline.processor  import run as process
    # folder = download_bhav()
    # process(folder)
    log.info("✓ Pipeline complete.")


if __name__ == "__main__":
    log.info(f"Scheduler started — will run at {SCHEDULER_HOUR:02d}:{SCHEDULER_MINUTE:02d} IST daily")
    scheduler.start()

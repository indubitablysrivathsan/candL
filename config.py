"""
NSE Platform — Central Configuration
=====================================
Edit DATA_ROOT to point at your output folder.
Everything else is derived from it automatically.
"""

from pathlib import Path

# ─── DATA ─────────────────────────────────────────────────────────────────────
DATA_ROOT = Path(r"D:\candL\data")   # <── change to your path

# Asset sub-roots
OPTIONS_ROOT = DATA_ROOT / "options"   # options/TICKER/EXPIRY/DATA/*.csv
FUTURES_ROOT = DATA_ROOT / "futures"   # futures/TICKER/EXPIRY/DATA/*.csv
STOCKS_ROOT  = DATA_ROOT / "stocks"    # stocks/TICKER/DATA/*.csv
INDEXES_ROOT = DATA_ROOT / "indexes"   # indexes/TICKER/DATA/*.csv

# ─── RAW DATA ─────────────────────────────────────────────────────────────────

RAW_ROOT = "raw"

FO_RAW_ROOT = f"{RAW_ROOT}/fo"

MANIFEST_PATH = f"{RAW_ROOT}/manifest.csv"


# ─── STARTUP SYNC ─────────────────────────────────────────────────────────────

SYNC_ON_STARTUP = True

SYNC_START_DATE = "2026-01-01"


# ─── DOWNLOAD ─────────────────────────────────────────────────────────────────

NSE_BASE_URL = "https://nsearchives.nseindia.com"


# ─── PROCESSING ───────────────────────────────────────────────────────────────

AUTO_PROCESS_AFTER_DOWNLOAD = False

# ──────────────────────────────────────────────────────────────────────────────

# API
API_HOST = "127.0.0.1"
API_PORT = 8000
API_PREFIX = "/api/v1"

# CORS origins for the React dev server
CORS_ORIGINS = [
    "http://localhost:5173",   # Vite default
    "http://localhost:3000",   # CRA default
]

# DuckDB — in-memory (":memory:") is fastest for read-only analytics.
# Change to a file path e.g. Path("cache.db") to persist between restarts.
DUCKDB_PATH = ":memory:"

# Scheduler — time (24-hr) to auto-download + process bhav copy
SCHEDULER_HOUR   = 18
SCHEDULER_MINUTE = 15

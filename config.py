"""
NSE Platform — Central Configuration
=====================================
DATA_ROOT is derived relative to this file automatically.
No manual path editing needed across devices.
"""

from pathlib import Path

# ─── ROOT ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent

# ─── DATA ─────────────────────────────────────────────────────────────────────
DATA_ROOT = PROJECT_ROOT / "data"

# ─── RAW DATA ─────────────────────────────────────────────────────────────────
RAW_ROOT         = PROJECT_ROOT / "raw"
FO_RAW_ROOT      = RAW_ROOT / "fo"
EQ_BHAV_ROOT     = RAW_ROOT / "eq_bhav"
CM_BHAV_ROOT     = RAW_ROOT / "cm_bhav"
FII_STATS_ROOT   = RAW_ROOT / "fii_stats"
PART_OI_ROOT     = RAW_ROOT / "part_oi"
PART_VOL_ROOT    = RAW_ROOT / "part_vol"
FO_VOLT_ROOT     = RAW_ROOT / "fo_volt"
MKT_ACT_ROOT     = RAW_ROOT / "mkt_act"

MANIFEST_PATH    = RAW_ROOT / "manifest.csv"

# ─── STARTUP SYNC ─────────────────────────────────────────────────────────────
SYNC_ON_STARTUP = True
SYNC_START_DATE = "2026-05-01"

# ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
NSE_BASE_URL = "https://nsearchives.nseindia.com"

# ─── PROCESSING ───────────────────────────────────────────────────────────────
AUTO_PROCESS_AFTER_DOWNLOAD = False

# ─── API ──────────────────────────────────────────────────────────────────────
API_HOST   = "127.0.0.1"
API_PORT   = 8000
API_PREFIX = "/api/v1"

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]

# ─── DUCKDB ───────────────────────────────────────────────────────────────────
NSE_DB_PATH = DATA_ROOT / "nse.db"
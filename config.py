"""
NSE Platform — Central Configuration
=====================================
DATA_ROOT is derived relative to this file automatically.
No manual path editing needed across devices.
"""

from pathlib import Path
from dotenv import load_dotenv
import os

# ─── ROOT ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent

env_file = PROJECT_ROOT / ".env"

if env_file.exists():
    load_dotenv(env_file)

# ─── DATA ─────────────────────────────────────────────────────────────────────
DATA_ROOT = PROJECT_ROOT / "data"

# ─── RAW DATA ─────────────────────────────────────────────────────────────────
RAW_ROOT         = PROJECT_ROOT / "raw"

FO_RAW_ROOT       = RAW_ROOT / "fo"
FO_LEGACY_RAW_ROOT = RAW_ROOT / "fo_legacy"
EQ_BHAV_ROOT      = RAW_ROOT / "eq_bhav"
CM_BHAV_ROOT      = RAW_ROOT / "cm_bhav"
CM_BHAV_LEGACY_ROOT = RAW_ROOT / "cm_bhav_legacy"
FII_STATS_ROOT    = RAW_ROOT / "fii_stats"
PART_OI_ROOT      = RAW_ROOT / "part_oi"
PART_VOL_ROOT     = RAW_ROOT / "part_vol"
FO_VOLT_ROOT      = RAW_ROOT / "fo_volt"
MKT_ACT_ROOT      = RAW_ROOT / "mkt_act"

FO_CONTRACT_ROOT  = RAW_ROOT / "fo_contracts"
CM_SECURITY_ROOT  = RAW_ROOT / "cm_security"

MANIFEST_PATH     = RAW_ROOT / "manifest.csv"

# ─── RESEARCH ─────────────────────────────────────────────────────────────────
RESEARCH_ROOT    = PROJECT_ROOT / "research"

# ─── STARTUP SYNC ─────────────────────────────────────────────────────────────
SYNC_ON_STARTUP = os.getenv("SYNC_ON_STARTUP", "True").lower() == "true"
SYNC_START_DATE = "2026-06-10"

# ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
NSE_BASE_URL = "https://nsearchives.nseindia.com"
NSE_HIST_BASE_URL = "https://archives.nseindia.com/content/historical"

# ─── PROCESSING ───────────────────────────────────────────────────────────────
AUTO_PROCESS_AFTER_DOWNLOAD = False

# ─── API ──────────────────────────────────────────────────────────────────────
API_HOST   = "127.0.0.1"
API_PORT   = 8000
API_PREFIX = "/api/v1"

CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:8000"
).split(",")

# ─── DUCKDB ───────────────────────────────────────────────────────────────────
db_name = os.getenv("DB_FILE", "nse.db")
NSE_DB_PATH = DATA_ROOT / db_name
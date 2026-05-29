from pathlib import Path
from datetime import datetime
from typing import Any
import requests
import zipfile
import io

from config import FO_RAW_ROOT, EQ_BHAV_ROOT, CM_BHAV_ROOT, FII_STATS_ROOT, PART_OI_ROOT, PART_VOL_ROOT, FO_VOLT_ROOT, MKT_ACT_ROOT, NSE_BASE_URL

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


# ── URL builders ──────────────────────────────────────────────────────────────

def build_fo_url(trade_date: str) -> str:
    """2026-05-27 → .../BhavCopy_NSE_FO_0_0_0_20260527_F_0000.csv.zip"""
    compact = trade_date.replace("-", "")
    return f"{NSE_BASE_URL}/content/fo/BhavCopy_NSE_FO_0_0_0_{compact}_F_0000.csv.zip"

def build_eq_bhav_url(trade_date: str) -> str:
    """2026-05-27 → .../sec_bhavdata_full_27052026.csv"""
    dmy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/products/content/sec_bhavdata_full_{dmy}.csv"

def build_cm_bhav_url(trade_date: str) -> str:
    """2026-05-27 → .../BhavCopy_NSE_CM_0_0_0_20260527_F_0000.csv.zip"""
    compact = trade_date.replace("-", "")
    return f"{NSE_BASE_URL}/content/cm/BhavCopy_NSE_CM_0_0_0_{compact}_F_0000.csv.zip"

def build_fii_url(trade_date: str) -> str:
    """2026-05-27 → .../fii_stats_27-May-2026.xls"""
    display = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d-%b-%Y")
    return f"{NSE_BASE_URL}/content/fo/fii_stats_{display}.xls"

def build_part_oi_url(trade_date: str) -> str:
    dmy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/nsccl/fao_participant_oi_{dmy}.csv"

def build_part_vol_url(trade_date: str) -> str:
    dmy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/nsccl/fao_participant_vol_{dmy}.csv"

def build_fo_volt_url(trade_date: str) -> str:
    dmy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/archives/nsccl/volt/FOVOLT_{dmy}.csv"

def build_mkt_act_url(trade_date: str) -> str:
    """2026-05-27 → .../MA270526.csv  (note: 2-digit year)"""
    ddmmyy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%y")
    return f"{NSE_BASE_URL}/archives/equities/mkt/MA{ddmmyy}.csv"


# ── output path builder ───────────────────────────────────────────────────────

def _output_path(root, trade_date: str, ext: str = "csv") -> Path:
    """
    raw/<root>/YYYY/MM/YYYY-MM-DD.<ext>
    Creates the folder if needed.
    """
    dt = datetime.strptime(trade_date, "%Y-%m-%d")
    folder = Path(root) / dt.strftime("%Y") / dt.strftime("%m")
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{trade_date}.{ext}"


# ── low-level fetch helpers ───────────────────────────────────────────────────

def _extract_csv_from_zip(content: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        csv_files = [f for f in zf.namelist() if f.lower().endswith(".csv")]
        if not csv_files:
            raise ValueError("No CSV found inside ZIP")
        return zf.read(csv_files[0])


def _is_today(trade_date: str) -> bool:
    return trade_date == datetime.today().strftime("%Y-%m-%d")


def _fetch(url: str, trade_date: str) -> tuple[bytes | None, str]:
    """
    GET url → (content_bytes, status)
    status: complete | market_closed | failed
    """
    try:
        r = SESSION.get(url, timeout=30)

        if r.status_code == 404:
            return None, "failed" if _is_today(trade_date) else "market_closed"

        r.raise_for_status()
        return r.content, "complete"

    except requests.HTTPError as e:
        print(f"[downloader] HTTP error {url}: {e}")
        return None, "failed"
    except Exception as e:
        print(f"[downloader] Error {url}: {e}")
        return None, "failed"


# ── public download functions ─────────────────────────────────────────────────

def download_fo_bhav(trade_date: str) -> str:
    content, status = _fetch(build_fo_url(trade_date), trade_date)
    if status == "complete":
        csv_bytes = _extract_csv_from_zip(content)
        _output_path(FO_RAW_ROOT, trade_date).write_bytes(csv_bytes)
    return status


def download_eq_bhav(trade_date: str) -> str:
    content, status = _fetch(build_eq_bhav_url(trade_date), trade_date)
    if status == "complete":
        _output_path(EQ_BHAV_ROOT, trade_date).write_bytes(content)
    return status


def download_cm_bhav(trade_date: str) -> str:
    content, status = _fetch(build_cm_bhav_url(trade_date), trade_date)
    if status == "complete":
        csv_bytes = _extract_csv_from_zip(content)
        _output_path(CM_BHAV_ROOT, trade_date).write_bytes(csv_bytes)
    return status


def download_fii(trade_date: str) -> str:
    content, status = _fetch(build_fii_url(trade_date), trade_date)
    if status == "complete":
        _output_path(FII_STATS_ROOT, trade_date, ext="xls").write_bytes(content)
    return status


def download_part_oi(trade_date: str) -> str:
    content, status = _fetch(build_part_oi_url(trade_date), trade_date)
    if status == "complete":
        _output_path(PART_OI_ROOT, trade_date).write_bytes(content)
    return status


def download_part_vol(trade_date: str) -> str:
    content, status = _fetch(build_part_vol_url(trade_date), trade_date)
    if status == "complete":
        _output_path(PART_VOL_ROOT, trade_date).write_bytes(content)
    return status


def download_fo_volt(trade_date: str) -> str:
    content, status = _fetch(build_fo_volt_url(trade_date), trade_date)
    if status == "complete":
        _output_path(FO_VOLT_ROOT, trade_date).write_bytes(content)
    return status


def download_mkt_act(trade_date: str) -> str:
    content, status = _fetch(build_mkt_act_url(trade_date), trade_date)
    if status == "complete":
        _output_path(MKT_ACT_ROOT, trade_date).write_bytes(content)
    return status


# ── coordinator ───────────────────────────────────────────────────────────────

# Maps each file type to (download_fn, manifest_dl_setter)
# Imported and used by startup.py / startup_sync.py
DOWNLOAD_REGISTRY: dict[str, dict[str, Any]] = {
    "fo": {
        "download": download_fo_bhav,
        "manifest_col": "fo_dl",
        "root": FO_RAW_ROOT,
    },
    "eq_bhav": {
        "download": download_eq_bhav,
        "manifest_col": "eq_bhav_dl",
        "root": EQ_BHAV_ROOT,
    },
    "cm_bhav": {
        "download": download_cm_bhav,
        "manifest_col": "cm_bhav_dl",
        "root": CM_BHAV_ROOT,
    },
    "fii": {
        "download": download_fii,
        "manifest_col": "fii_dl",
        "root": FII_STATS_ROOT,
    },
    "part_oi": {
        "download": download_part_oi,
        "manifest_col": "part_oi_dl",
        "root": PART_OI_ROOT,
    },
    "part_vol": {
        "download": download_part_vol,
        "manifest_col": "part_vol_dl",
        "root": PART_VOL_ROOT,
    },
    "fo_volt": {
        "download": download_fo_volt,
        "manifest_col": "fo_volt_dl",
        "root": FO_VOLT_ROOT,
    },
    "mkt_act": {
        "download": download_mkt_act,
        "manifest_col": "mkt_act_dl",
        "root": MKT_ACT_ROOT,
    },
}
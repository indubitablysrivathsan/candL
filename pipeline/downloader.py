from pathlib import Path
from datetime import datetime
from io import StringIO
import pandas as pd
from typing import Any
import requests
import zipfile
import gzip
import io

from config import (
    FO_RAW_ROOT, FO_LEGACY_RAW_ROOT, EQ_BHAV_ROOT, CM_BHAV_ROOT, CM_BHAV_LEGACY_ROOT,
    FII_STATS_ROOT, PART_OI_ROOT, PART_VOL_ROOT, FO_VOLT_ROOT, MKT_ACT_ROOT,
    FO_CONTRACT_ROOT, CM_SECURITY_ROOT, NSE_BASE_URL, NSE_HIST_BASE_URL
)

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

NEW_NSE_SCHEMA_DATE = datetime(2024, 7, 24).date()

# ── Schema switch ─────────────────────────────────────────────────────────────

def use_new_schema(trade_date: str) -> bool:
    return datetime.strptime(trade_date, "%Y-%m-%d").date() >= NEW_NSE_SCHEMA_DATE


# ── Validators ───────────────────────────────────────────────────────────────

def validate_eq_bhav(content: bytes, expected_date: str) -> bool:
    df = pd.read_csv(StringIO(content.decode("utf-8")))
    df.columns = df.columns.str.strip()

    actual = (
        pd.to_datetime(
            df["DATE1"].astype(str).str.strip().iloc[0],
            format="%d-%b-%Y"
        )
        .strftime("%Y-%m-%d")
    )

    return actual == expected_date

def validate_cm_bhav(csv_bytes: bytes, expected_date: str) -> bool:
    df = pd.read_csv(StringIO(csv_bytes.decode("utf-8")))
    df.columns = df.columns.str.strip()

    actual = pd.to_datetime(
        df["BizDt"].iloc[0],
        format="%d-%m-%Y"
    ).strftime("%Y-%m-%d")

    return actual == expected_date

def validate_fo_bhav(csv_bytes: bytes, expected_date: str) -> bool:
    df = pd.read_csv(StringIO(csv_bytes.decode("utf-8")))
    df.columns = df.columns.str.strip()
    actual = pd.to_datetime(
        df["BizDt"].iloc[0],
        format="%d-%m-%Y"
    ).strftime("%Y-%m-%d")

    return actual == expected_date

def validate_fo_bhav_legacy(csv_bytes: bytes, expected_date: str) -> bool:
    df = pd.read_csv(StringIO(csv_bytes.decode("utf-8")))
    df.columns = df.columns.str.strip()
    actual = pd.to_datetime(
        df["TIMESTAMP"].iloc[0],
        format="%d-%b-%Y"
    ).strftime("%Y-%m-%d")

    return actual == expected_date

def validate_cm_bhav_legacy(csv_bytes: bytes, expected_date: str) -> bool:
    df = pd.read_csv(StringIO(csv_bytes.decode("utf-8")))
    df.columns = df.columns.str.strip()
    actual = pd.to_datetime(
        df["TIMESTAMP"].iloc[0],
        format="%d-%b-%Y"
    ).strftime("%Y-%m-%d")

    return actual == expected_date

def validate_fo_volt(content: bytes, expected_date: str) -> bool:
    df = pd.read_csv(StringIO(content.decode("utf-8")))
    df.columns = df.columns.str.strip()
    actual = pd.to_datetime(
        df["Date"].iloc[0],
        format="%d-%b-%y"
    ).strftime("%Y-%m-%d")

    return actual == expected_date


def validate_or_market_closed(
    valid: bool,
    trade_date: str
) -> str:

    if valid:
        return "complete"

    return "market_closed"


# ── Weekend staleness guard (fo_contracts / cm_security) ──────────────────────
# These two endpoints don't 404 on non-trading days — they silently re-serve
# the last trading day's file with a 200. On weekdays that's rarely an issue,
# but on Sat/Sun there is no fresh file at all, so a "successful" download is
# actually stale data from the preceding Friday. Guard against this by
# confirming the requested trade_date literally appears in the file content
# before accepting it as complete; only applied on weekends to avoid false
# negatives on legitimate trading days.

def _is_weekend(trade_date: str) -> bool:
    return datetime.strptime(trade_date, "%Y-%m-%d").weekday() >= 5


def _content_matches_date(content: bytes, trade_date: str) -> bool:
    dt = datetime.strptime(trade_date, "%Y-%m-%d")
    text = content.decode("utf-8", errors="ignore")
    return any(
        dt.strftime(fmt) in text
        for fmt in ("%d-%m-%Y", "%d%m%Y", "%Y%m%d", "%Y-%m-%d")
    )


# ── URL builders ──────────────────────────────────────────────────────────────

def build_fo_url(trade_date: str) -> str:
    """2026-05-27 → .../BhavCopy_NSE_FO_0_0_0_20260527_F_0000.csv.zip
    pre-2024-07-21 → .../DERIVATIVES/2022/JAN/fo06JAN2022bhav.csv.zip"""
    if use_new_schema(trade_date):
        compact = trade_date.replace("-", "")
        return f"{NSE_BASE_URL}/content/fo/BhavCopy_NSE_FO_0_0_0_{compact}_F_0000.csv.zip"

    dt = datetime.strptime(trade_date, "%Y-%m-%d")
    ddmonyyyy = dt.strftime("%d%b%Y").upper()
    return f"{NSE_HIST_BASE_URL}/DERIVATIVES/{dt.strftime('%Y')}/{dt.strftime('%b').upper()}/fo{ddmonyyyy}bhav.csv.zip"

def build_eq_bhav_url(trade_date: str) -> str:
    """2026-05-27 → .../sec_bhavdata_full_27052026.csv"""
    dmy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/products/content/sec_bhavdata_full_{dmy}.csv"

def build_cm_bhav_url(trade_date: str) -> str:
    """2026-05-27 → .../BhavCopy_NSE_CM_0_0_0_20260527_F_0000.csv.zip
    pre-2024-07-21 → .../EQUITIES/2024/JUN/cm21JUN2024bhav.csv.zip"""
    if use_new_schema(trade_date):
        compact = trade_date.replace("-", "")
        return f"{NSE_BASE_URL}/content/cm/BhavCopy_NSE_CM_0_0_0_{compact}_F_0000.csv.zip"

    dt = datetime.strptime(trade_date, "%Y-%m-%d")
    ddmonyyyy = dt.strftime("%d%b%Y").upper()
    return f"{NSE_HIST_BASE_URL}/EQUITIES/{dt.strftime('%Y')}/{dt.strftime('%b').upper()}/cm{ddmonyyyy}bhav.csv.zip"

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

def build_fo_contract_url(trade_date: str) -> str:
    """2026-07-10 → .../NSE_FO_contract_10072026.csv.gz"""
    dmy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/fo/NSE_FO_contract_{dmy}.csv.gz"

def build_cm_security_url(trade_date: str) -> str:
    """2026-07-09 → .../NSE_CM_security_09072026.csv.gz"""
    dmy = datetime.strptime(trade_date, "%Y-%m-%d").strftime("%d%m%Y")
    return f"{NSE_BASE_URL}/content/cm/NSE_CM_security_{dmy}.csv.gz"


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


def _extract_csv_from_gz(content: bytes) -> bytes:
    return gzip.decompress(content)


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
        root = FO_RAW_ROOT if use_new_schema(trade_date) else FO_LEGACY_RAW_ROOT
        _output_path(root, trade_date).write_bytes(csv_bytes)
    return status


def download_eq_bhav(trade_date: str) -> str:
    content, status = _fetch(build_eq_bhav_url(trade_date), trade_date)

    if status != "complete":
        return status

    if not validate_eq_bhav(content, trade_date):
        print(
            f"[eq_bhav] stale file detected "
            f"(requested={trade_date})"
        )
        return "market_closed"

    _output_path(EQ_BHAV_ROOT, trade_date).write_bytes(content)
    return "complete"


def download_cm_bhav(trade_date: str) -> str:
    content, status = _fetch(build_cm_bhav_url(trade_date), trade_date)
    if status == "complete":
        csv_bytes = _extract_csv_from_zip(content)
        root = CM_BHAV_ROOT if use_new_schema(trade_date) else CM_BHAV_LEGACY_ROOT
        _output_path(root, trade_date).write_bytes(csv_bytes)
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


def download_fo_contracts(trade_date: str) -> str:
    content, status = _fetch(build_fo_contract_url(trade_date), trade_date)
    if status != "complete":
        return status

    csv_bytes = _extract_csv_from_gz(content)

    if _is_weekend(trade_date) and not _content_matches_date(csv_bytes, trade_date):
        print(
            f"[fo_contracts] stale weekend file detected "
            f"(requested={trade_date})"
        )
        return "market_closed"

    _output_path(FO_CONTRACT_ROOT, trade_date).write_bytes(csv_bytes)
    return "complete"


def download_cm_security(trade_date: str) -> str:
    content, status = _fetch(build_cm_security_url(trade_date), trade_date)
    if status != "complete":
        return status

    csv_bytes = _extract_csv_from_gz(content)

    if _is_weekend(trade_date) and not _content_matches_date(csv_bytes, trade_date):
        print(
            f"[cm_security] stale weekend file detected "
            f"(requested={trade_date})"
        )
        return "market_closed"

    _output_path(CM_SECURITY_ROOT, trade_date).write_bytes(csv_bytes)
    return "complete"


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
    "fo_contracts": {
        "download": download_fo_contracts,
        "manifest_col": "fo_contracts_dl",
        "root": FO_CONTRACT_ROOT,
    },
    "cm_security": {
        "download": download_cm_security,
        "manifest_col": "cm_security_dl",
        "root": CM_SECURITY_ROOT,
    },
}
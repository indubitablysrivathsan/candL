"""
NSE Platform — Startup sync
============================
1. init DB
2. download all file types for missing dates
3. process all file types for downloaded-but-unprocessed dates

Master files (FO Contract, CM Security) are forward-looking: a file
dated D describes the contract/security universe effective on the
NEXT trading session, not on D itself. To avoid guessing weekends and
holidays, processing of a master file dated D is deferred until a
later manifest row confirms the next real trading session (i.e. that
row's fo_dl/eq_bhav_dl flags are set). That confirmed date becomes the
trade_date written to the DB — see trading_dates.get_next_confirmed_trading_date.
"""

from datetime import datetime
import pandas as pd

from api.db import init_db, is_processed
from pipeline.trading_dates import get_missing_dates, get_next_confirmed_trading_date
from pipeline.manifest import load_manifest, save_manifest, COLUMNS, _FLAG_COLS
from pipeline.downloader import DOWNLOAD_REGISTRY
from pipeline.processors import REGISTRY as PROCESSOR_REGISTRY
from config import SYNC_START_DATE


# (processor_key, dl_col, pr_col, is_processed_check_keys)
_PIPELINE = [
    ("fo_contracts", "fo_contracts_dl", ["fo_contracts_pr"], ["FO_CONTRACT"]),
    ("fo",           "fo_dl",           ["stf_pr", "idf_pr", "sto_pr", "ido_pr"], ["STF", "IDF", "STO", "IDO"]),
    ("cm_security",  "cm_security_dl",  ["cm_security_pr"],  ["CM_SECURITY"]),
    ("cm_bhav",      "cm_bhav_dl",      ["cm_bhav_pr"],      ["cm_bhav"]),
    ("eq_bhav",      "eq_bhav_dl",      ["eq_bhav_pr"],      ["eq_bhav"]),
    ("fii",          "fii_dl",          ["fii_pr"],          ["fii"]),
    ("participant",  "part_oi_dl",      ["part_oi_pr"],      ["part_oi", "part_vol"]),
    ("fo_volt",      "fo_volt_dl",      ["fo_volt_pr"],      ["fo_volt"]),
    ("mkt_act",      "mkt_act_dl",      ["mkt_act_pr"],      ["mkt_act"]),
]

# processor keys that also require a second dl flag before processing
_EXTRA_DL = {"participant": "part_vol_dl"}
# processor keys that set an extra pr flag on success
_EXTRA_PR = {"participant": "part_vol_pr"}

# processor keys whose manifest row date is a *file_date* (publication date),
# not the trade_date the snapshot is effective for. These are gated on
# get_next_confirmed_trading_date and call their processor with both dates.
_MASTER_KEYS = {"fo_contracts", "cm_security"}


def _flag(manifest: pd.DataFrame, trade_date: str, col: str) -> int:
    rows = manifest[manifest["trade_date"] == trade_date]
    return int(rows[col].values[0]) if len(rows) and col in rows.columns else 0


def _set(manifest: pd.DataFrame, trade_date: str, **kwargs):
    if trade_date not in manifest["trade_date"].values:
        new = {c: 0 for c in _FLAG_COLS}
        new["trade_date"] = trade_date
        new["status"] = ""
        new.update(kwargs)
        manifest = pd.concat([manifest, pd.DataFrame([new])], ignore_index=True)
    else:
        for col, val in kwargs.items():
            manifest.loc[manifest["trade_date"] == trade_date, col] = val
    return manifest


def _all_processed(trade_date: str, keys: list[str]) -> bool:
    return all(is_processed(trade_date, k) for k in keys)


def run_startup_sync():
    print("────────────── NSE STARTUP SYNC ──────────────\n")
    init_db()

    manifest = load_manifest()
    today    = datetime.today().strftime("%Y-%m-%d")
    missing  = get_missing_dates(manifest, SYNC_START_DATE, today)
    first_cutoff_date = min(missing) if missing else None

    # ── Phase 1: Download ─────────────────────────────────────────────────────
    print(f"Found {len(missing)} missing dates.\n" if missing else "✓ No missing dates.\n")

    for trade_date in missing:
        statuses = {}
        updates  = {}

        for dl_key, entry in DOWNLOAD_REGISTRY.items():
            dl_col = entry["manifest_col"]
            if _flag(manifest, trade_date, dl_col) == 1:
                statuses[dl_key] = "already"
                continue

            result = entry["download"](trade_date)
            statuses[dl_key] = result

            if result == "complete":
                updates[dl_col] = 1

        else:
            # only runs if loop didn't break (i.e. not market_closed)
            all_closed = all(
                s == "market_closed"
                for s in statuses.values()
            )

            all_ok = all(
                s in ("complete", "already")
                for s in statuses.values()
            )

            any_ok = any(
                s in ("complete", "already")
                for s in statuses.values()
            )

            if all_closed:
                status = "market_closed"
            elif all_ok:
                status = "complete"
            elif any_ok:
                status = "partial"
            else:
                status = "failed"
            updates["status"] = status
            print(f"{'✓' if all_ok else '~' if any_ok else '✗'} Download {status}: {trade_date}")

        if trade_date == today and status == "failed":
            print(f"~ Current Day: Pending NSE upload / Market Closed: {trade_date}")
            continue

        manifest = _set(manifest, trade_date, **updates)

    save_manifest(manifest)

    # ── Phase 2: Process ──────────────────────────────────────────────────────
    print("\nChecking processing state...\n")
    manifest = load_manifest()

    for proc_key, dl_col, pr_cols, check_keys in _PIPELINE:
        extra_dl = _EXTRA_DL.get(proc_key)
        extra_pr = _EXTRA_PR.get(proc_key)
        is_master = proc_key in _MASTER_KEYS

        candidates = manifest[
            (manifest[dl_col] == 1) &
            (manifest[pr_cols[0]] != 1) &
            (manifest["status"] != "market_closed")
        ]["trade_date"].tolist()

        # Non-master processors must not run on the very first date of this
        # sync's cutoff range — its FO Contract / CM Security master (for
        # the prior session) hasn't been processed/joined yet.
        if not is_master and first_cutoff_date is not None:
            candidates = [d for d in candidates if d != first_cutoff_date]

        if extra_dl:
            candidates = [d for d in candidates if _flag(manifest, d, extra_dl) == 1]

        # For master files, `trade_date` in the row is actually the file's
        # publication date. Resolve the real effective trade_date from a
        # later confirmed manifest row, and drop any candidate whose next
        # trading day isn't confirmed yet (i.e. the most recent file we have).
        effective_date = {}
        if is_master:
            kept = []
            for file_date in candidates:
                eff = get_next_confirmed_trading_date(manifest, file_date)
                if eff is not None:
                    effective_date[file_date] = eff
                    kept.append(file_date)
                else:
                    print(f"[{proc_key}] {file_date} — next trading day not yet confirmed, deferring")
            candidates = kept

        for trade_date in sorted(candidates):
            check_date = effective_date[trade_date] if is_master else trade_date

            if _all_processed(check_date, check_keys):
                print(f"[{proc_key}] {trade_date} — already in DB, syncing manifest flag")
                updates = {col: 1 for col in pr_cols}

                if extra_pr:
                    updates[extra_pr] = 1

                manifest = _set(manifest, trade_date, **updates)
                continue
            try:
                if is_master:
                    PROCESSOR_REGISTRY[proc_key](file_date=trade_date, trade_date=check_date)
                else:
                    PROCESSOR_REGISTRY[proc_key](trade_date)

                if _all_processed(check_date, check_keys):
                    updates = {col: 1 for col in pr_cols}
                    if extra_pr:
                        updates[extra_pr] = 1
                    manifest = _set(manifest, trade_date, **updates)
                else:
                    print(f"  ⚠ {proc_key} {trade_date}: DB check incomplete after processing")
            except FileNotFoundError as e:
                print(f"  ✗ {proc_key} {trade_date}: file missing — {e}")
            except Exception as e:
                print(f"  ✗ {proc_key} {trade_date}: {e}")

    save_manifest(manifest)
    print("\n✓ Startup sync complete.\n")
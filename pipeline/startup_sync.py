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

For master processors, two columns are tracked per master (see manifest.py):
  - <key>_pr        : gating flag — "this trade_date has confirmed master data".
                       Non-master processors check ONLY this column.
  - <key>_file_pr    : "the FILE dated D has been consumed" — prevents
                       reprocessing the same file every run. Independent of
                       whether the file's OWN trade_date is itself confirmed.
These are allowed to disagree on the same row (e.g. file 13-07 can be
consumed/file_pr=1 while trade_date 13-07 itself is never confirmed/pr=0,
because the file that would confirm it, dated 12-07, predates SYNC_START_DATE).

pr_col sentinel values (master keys only):
  0  : not yet attempted
  1  : confirmed / processed
  2  : deferred — downloaded, but its confirming next trading date isn't
       known yet. Only meaningful on/after MASTER_START_DATE, since before
       that the masters don't exist at all and are never deferred.
  -1 : not applicable — file_date falls before MASTER_START_DATE, so the
       master file never existed and this date will never be attempted.

Before MASTER_START_DATE (2024-02-05), FO Contract / CM Security master
files were not published by NSE at all. For file_dates before this cutoff:
  - the master processors are never invoked, and their pr_col is set to -1
    (permanently not-applicable, distinct from the "waiting to be
    confirmed" state 2 used on/after the cutoff)
  - non-master processors are NOT gated on master pr flags for any
    trade_date whose previous trading date falls before MASTER_START_DATE
    — there's nothing to wait for, so they run as soon as their own file
    is downloaded

On/after LEGACY_CUTOFF, "fo" and "cm_bhav" route to their normal
processors. Before LEGACY_CUTOFF, they route to "fo_legacy" and
"cm_bhav_legacy" instead. Manifest columns (dl/pr flags) are identical
either way — only the processor function called differs.

Download-side availability (Phase 1): the set of missing dates is split
into two independently-walked directional runs relative to the dates
already present in the manifest:

  - BACKWARD: missing dates older than the earliest manifest date,
    walked in DESCENDING order (closest to existing data first, marching
    down toward SYNC_START_DATE last).
  - FORWARD: missing dates from the latest manifest date onward
    (including any in-range gaps and "today"), walked in ASCENDING order.

Each direction keeps its own independent, per-download-key rolling streak
of consecutive non-"complete" results (market_closed/failed). Once a
streak reaches STREAK_THRESHOLD (10) within a direction, the entire
streak so far — including earlier dates in that same direction's walk
already written with a "market_closed"/"failed" status — is rewritten to
dl_col = NOT_AVAILABLE (-1), that date's aggregate `status` is recomputed
(not_available counts as an ok/complete outcome), and the key is marked
"saturated" for the remainder of that direction's walk: every further
date is immediately written -1 for that key with no real request and no
repeated log line. A "complete" result resets the streak and clears
saturation for that key. Saturation and streak state do NOT carry across
the backward/forward boundary — they are separate walks answering
separate questions ("when did this file type start existing" vs "did it
stop existing recently"). -1 rows are skipped on future runs (never
re-attempted) exactly like already-downloaded (1) rows are skipped, just
via a different branch. Dates already present in the manifest are never
part of `missing` at all, so a fresh run never re-downloads them.
"""

from datetime import datetime
import pandas as pd

from api.db import init_db, is_processed
from pipeline.trading_dates import get_missing_dates, get_next_confirmed_trading_date, get_previous_trading_date
from pipeline.manifest import load_manifest, save_manifest, COLUMNS, _FLAG_COLS
from pipeline.downloader import DOWNLOAD_REGISTRY, NOT_AVAILABLE as DL_NOT_AVAILABLE, STREAK_THRESHOLD
from pipeline.processors import REGISTRY as PROCESSOR_REGISTRY
from config import SYNC_START_DATE


# (processor_key, dl_col, pr_col, is_processed_check_keys)
# processor_key here is the *manifest/registry lookup key*. For "fo" and
# "cm_bhav" the actual function invoked is swapped to the _legacy variant
# at call time based on trade_date vs LEGACY_CUTOFF — see _resolve_proc_key.
_PIPELINE = [
    ("fo_contracts", "fo_contracts_dl", ["fo_contracts_pr"], ["FO_CONTRACT"]),
    ("cm_security",  "cm_security_dl",  ["cm_security_pr"],  ["CM_SECURITY"]),
    ("fo",           "fo_dl",           ["stf_pr", "idf_pr", "sto_pr", "ido_pr"], ["STF", "IDF", "STO", "IDO"]),
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

# keys that switch to a _legacy processor before LEGACY_CUTOFF
_LEGACY_SWITCH_KEYS = {"fo", "cm_bhav"}

LEGACY_CUTOFF = "2024-06-24"

# FO Contract / CM Security master files are not available before this
# date — NSE simply did not publish them. Dates before this are never
# attempted and are marked with the -1 "not applicable" sentinel.
MASTER_START_DATE = "2024-02-05"

# sentinel: master file_date predates MASTER_START_DATE — permanently N/A
NOT_AVAILABLE = -1
# sentinel: downloaded, waiting on a confirming next trading date
DEFERRED = 2


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


def _resolve_proc_key(proc_key: str, trade_date: str) -> str:
    """Swap to the _legacy variant for dates before LEGACY_CUTOFF."""
    if proc_key in _LEGACY_SWITCH_KEYS and trade_date < LEGACY_CUTOFF:
        return f"{proc_key}_legacy"
    return proc_key


def _aggregate_status(statuses: dict) -> str:
    ok_statuses     = ("complete", "already", "not_available")
    closed_statuses = ("market_closed", "not_available")
    all_closed = all(s in closed_statuses for s in statuses.values())
    all_ok     = all(s in ok_statuses for s in statuses.values())
    any_ok     = any(s in ok_statuses for s in statuses.values())
    if all_closed:
        return "market_closed"
    elif all_ok:
        return "complete"
    elif any_ok:
        return "partial"
    else:
        return "failed"


def _split_directional(manifest: pd.DataFrame, sync_start: str, today: str) -> tuple[list[str], list[str]]:
    """
    Split missing dates into two independently-walked runs relative to the
    dates already present in the manifest:

      - backward: dates older than the earliest existing manifest date,
        walked DESCENDING (closest to existing data first, marching down
        toward sync_start last).
      - forward: dates from the latest existing manifest date onward
        (includes any in-range gaps from a previous partial run, plus any
        brand-new dates up to and including today), walked ASCENDING.

    If the manifest is empty there is no frontier to be backward/forward
    *from* — the whole range is a single forward walk.
    """
    all_missing = get_missing_dates(manifest, sync_start, today)
    existing = manifest["trade_date"].tolist()

    if not existing:
        return [], sorted(all_missing)

    manifest_min, manifest_max = min(existing), max(existing)

    backward = sorted((d for d in all_missing if d < manifest_min), reverse=True)
    forward  = sorted(d for d in all_missing if d >= manifest_max)

    return backward, forward


def _download_phase(dates: list[str], manifest: pd.DataFrame,
                     date_key_statuses: dict,
                     initial_saturated: dict[str, bool] | None = None) -> pd.DataFrame:
    """Walk `dates` in the order given, with its own independent per-key
    miss-streak/saturation tracking. Direction is entirely determined by
    the order of `dates` as passed in — this function doesn't know or
    care whether it's walking backward or forward.

    `initial_saturated` lets a caller seed a key as already-saturated
    before the walk starts — used when a prior run already proved a key
    permanently dead at/before the manifest's current frontier, so a
    later backward walk into newly-missing older dates doesn't have to
    re-burn a fresh 10-miss streak to re-derive the same conclusion."""
    miss_streaks: dict[str, list[str]] = {k: [] for k in DOWNLOAD_REGISTRY}
    saturated: dict[str, bool] = {
        k: (initial_saturated or {}).get(k, False) for k in DOWNLOAD_REGISTRY
    }

    for trade_date in dates:
        statuses = {}
        updates  = {}

        for dl_key, entry in DOWNLOAD_REGISTRY.items():
            dl_col = entry["manifest_col"]
            existing = _flag(manifest, trade_date, dl_col)

            if existing == 1:
                statuses[dl_key] = "already"
                continue

            if existing == DL_NOT_AVAILABLE:
                statuses[dl_key] = "not_available"
                continue

            if saturated[dl_key]:
                # streak already confirmed dead for this key in this
                # direction — no real request, no repeated log line.
                updates[dl_col] = DL_NOT_AVAILABLE
                statuses[dl_key] = "not_available"
                continue

            try:
                result = entry["download"](trade_date)
            except Exception as e:
                print(
                    f"  ✗ DOWNLOAD CRASH: key={dl_key}, "
                    f"date={trade_date}, type={type(e).__name__}: {e}"
                )
                raise

            if result == "complete":
                updates[dl_col] = 1
                miss_streaks[dl_key] = []
                saturated[dl_key] = False
                statuses[dl_key] = "complete"
                continue

            statuses[dl_key] = result
            miss_streaks[dl_key].append(trade_date)

            if len(miss_streaks[dl_key]) >= STREAK_THRESHOLD:
                for missed_date in miss_streaks[dl_key]:
                    if missed_date == trade_date:
                        updates[dl_col] = DL_NOT_AVAILABLE
                    else:
                        manifest = _set(manifest, missed_date, **{dl_col: DL_NOT_AVAILABLE})
                        if missed_date in date_key_statuses:
                            date_key_statuses[missed_date][dl_key] = "not_available"
                            manifest = _set(manifest, missed_date,
                                             status=_aggregate_status(date_key_statuses[missed_date]))
                print(f"  ~ [{dl_key}] {STREAK_THRESHOLD}+ consecutive misses through {trade_date} "
                      f"— marking stretch as not-available")
                statuses[dl_key] = "not_available"
                saturated[dl_key] = True

        date_key_statuses[trade_date] = statuses
        status = _aggregate_status(statuses)
        updates["status"] = status
        symbol = "✓" if status == "complete" else "✗" if status == "failed" else "~"
        print(f"{symbol} Download {status}: {trade_date}")
        manifest = _set(manifest, trade_date, **updates)

    return manifest


def run_startup_sync():
    print("────────────── NSE STARTUP SYNC ──────────────\n")
    init_db()

    manifest = load_manifest()
    today    = datetime.today().strftime("%Y-%m-%d")

    # ── Phase 1: Download ─────────────────────────────────────────────────
    backward, forward = _split_directional(manifest, SYNC_START_DATE, today)
    total = len(backward) + len(forward)
    print(f"Found {total} missing dates.\n" if total else "✓ No missing dates.\n")

    date_key_statuses: dict[str, dict[str, str]] = {}

    if backward:
        frontier_date = min(manifest["trade_date"]) if len(manifest) else None
        initial_saturated = {}
        if frontier_date is not None:
            for dl_key, entry in DOWNLOAD_REGISTRY.items():
                dl_col = entry["manifest_col"]
                if _flag(manifest, frontier_date, dl_col) == DL_NOT_AVAILABLE:
                    initial_saturated[dl_key] = True
        manifest = _download_phase(backward, manifest, date_key_statuses,
                                    initial_saturated=initial_saturated)
        save_manifest(manifest)
        manifest = load_manifest()

    if forward:
        manifest = _download_phase(forward, manifest, date_key_statuses)

    save_manifest(manifest)

    # ── Phase 2: Process ──────────────────────────────────────────────────
    print("\nChecking processing state...\n")
    manifest = load_manifest()

    for proc_key, dl_col, pr_cols, check_keys in _PIPELINE:
        extra_dl = _EXTRA_DL.get(proc_key)
        extra_pr = _EXTRA_PR.get(proc_key)
        is_master = proc_key in _MASTER_KEYS
        pr_col = pr_cols[0]

        candidates = manifest[
            (manifest[dl_col] == 1) &
            (~manifest[pr_col].isin([1, NOT_AVAILABLE])) &
            (manifest["status"] != "market_closed")
        ]["trade_date"].tolist()

        if extra_dl:
            candidates = [d for d in candidates if _flag(manifest, d, extra_dl) == 1]

        if is_master:
            # candidates here are FILE dates. Files before MASTER_START_DATE
            # never existed — mark permanently N/A and skip entirely, no
            # confirmation lookup needed. Others need their confirming next
            # trading date to exist before they can be written to the DB.
            effective_date = {}
            kept = []
            for file_date in candidates:
                if file_date < MASTER_START_DATE:
                    manifest = _set(manifest, file_date, **{pr_col: NOT_AVAILABLE})
                    continue
                eff = get_next_confirmed_trading_date(manifest, file_date)
                if eff is not None:
                    effective_date[file_date] = eff
                    kept.append(file_date)
                else:
                    manifest = _set(manifest, file_date, **{pr_col: DEFERRED})
            candidates = kept
        else:
            # candidates here are the file's own trade_date. Need the PREVIOUS
            # trading date's masters to already be processed — but only once
            # masters exist at all. If the previous trading date predates
            # MASTER_START_DATE there's nothing to wait for, so skip the gate.
            kept = []
            for d in candidates:
                prev = get_previous_trading_date(manifest, d)
                if prev is not None and prev < MASTER_START_DATE:
                    kept.append(d)
                elif (
                    prev is not None
                    and _flag(manifest, prev, "fo_contracts_pr") == 1
                    and _flag(manifest, prev, "cm_security_pr") == 1
                ):
                    kept.append(d)
                else:
                    manifest = _set(manifest, d, **{pr_col: DEFERRED})
            candidates = kept

        for trade_date in sorted(candidates):
            check_date = effective_date[trade_date] if is_master else trade_date
            run_key = _resolve_proc_key(proc_key, trade_date)

            if run_key not in PROCESSOR_REGISTRY:
                # processor not implemented for this key — no-op, skip silently
                continue

            if _all_processed(check_date, check_keys):
                print(f"[{proc_key}] {trade_date} — already in DB, syncing manifest flag")
                updates = {col: 1 for col in pr_cols}
                if extra_pr:
                    updates[extra_pr] = 1
                manifest = _set(manifest, trade_date, **updates)
                continue
            try:
                if is_master:
                    PROCESSOR_REGISTRY[run_key](file_date=trade_date, trade_date=check_date)
                else:
                    PROCESSOR_REGISTRY[run_key](trade_date)

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
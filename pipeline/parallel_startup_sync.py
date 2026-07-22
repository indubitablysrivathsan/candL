"""
pipeline/parallel_startup_sync.py

Parallel-compute variant of startup_sync.py.
Phase 1 (download) mirrors startup_sync.run_startup_sync's directional
download logic exactly (see below) and stays fully sequential on purpose —
we don't want to hit NSE's site with concurrent requests. Only Phase 2
(processing) is replaced with a batched version built on
pipeline.parallel_backfill (run_parallel_backfill + write_all).

Candidate selection and deferral rules are copied verbatim from
startup_sync.py's Phase 2 loop:
  - masters (fo_contracts, cm_security) are keyed by FILE date and only
    become eligible once get_next_confirmed_trading_date resolves an
    effective trade_date; if it can't yet, the row's pr flag is set to 2
    ("deferred"), exactly as startup_sync.py does.
  - non-masters are keyed by their own trade_date and only become eligible
    once the PREVIOUS trading date's fo_contracts_pr / cm_security_pr flags
    are both 1.

If you change either rule in startup_sync.py, mirror the change here — the
two are intentionally independent copies, not a shared helper, to avoid
coupling the sequential and parallel paths.

WHY ROUNDS:
Eligibility for non-master processors depends on the previous day's master
flags being committed to the manifest, not just scheduled in the same batch.
So a run of N consecutive new days can't all be processed in one shot: day 2
only becomes eligible after day 1's masters are written AND the manifest is
reloaded. This module runs in rounds:

  1. Scan the manifest for every (proc, date) pair that is currently
     eligible under the rules above.
  2. Compute all of them in parallel (ProcessPoolExecutor via
     run_parallel_backfill), then write them back with write_all, which
     already enforces ascending date order and masters-before-non-masters
     within a date — the same ordering startup_sync.py relies on.
  3. Fold the results back into manifest flags, save, reload.
  4. Repeat until a round produces no new candidates (or max_rounds hits,
     as a guard against a genuinely stuck manifest state).

Within a single round every eligible proc/date pair runs in parallel
regardless of proc_key — the round boundary is what serializes the
cross-day master dependency, not proc ordering.

DOWNLOAD DIRECTIONALITY & STREAK LOGIC (Phase 1):
Mirrors startup_sync.py exactly. Missing dates are split into two
independently-walked runs relative to the dates already present in the
manifest:

  - BACKWARD: missing dates older than the earliest existing manifest
    date, walked DESCENDING (closest to existing data first, marching
    down toward SYNC_START_DATE last).
  - FORWARD: missing dates from the latest existing manifest date onward
    (includes any in-range gaps plus any brand-new dates up to and
    including today), walked ASCENDING.

Each direction keeps its own independent, per-download-key rolling streak
of consecutive non-"complete" results. Once a streak reaches
STREAK_THRESHOLD (10) within a direction, the entire streak so far is
rewritten to dl_col = NOT_AVAILABLE (-1), the affected dates' aggregate
`status` is recomputed (not_available counts as an ok/complete outcome),
and the key is marked "saturated" for the remainder of that direction's
walk — no repeated log line, no further real requests for that key until
a "complete" result resets it. Saturation/streak state never carries
across the backward/forward boundary. -1 rows are skipped on future runs
exactly like already-downloaded (1) rows, just via a different branch.
"""

from datetime import datetime

import pandas as pd

from api.db import init_db, is_processed
from pipeline.trading_dates import get_missing_dates, get_next_confirmed_trading_date, get_previous_trading_date
from pipeline.manifest import load_manifest, save_manifest, _FLAG_COLS
from pipeline.downloader import DOWNLOAD_REGISTRY, NOT_AVAILABLE as DL_NOT_AVAILABLE, STREAK_THRESHOLD
from pipeline.parallel_backfill import run_parallel_backfill, write_all, _MASTER_PROCS
from config import SYNC_START_DATE

NOT_AVAILABLE = -1

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

_EXTRA_DL = {"participant": "part_vol_dl"}
_EXTRA_PR = {"participant": "part_vol_pr"}

# FO Contract / CM Security master files are not available before this
# date — NSE simply did not publish them. Dates before this are never
# attempted and are marked with the -1 "not applicable" sentinel.
MASTER_START_DATE = "2024-02-05"

def _flag(manifest: pd.DataFrame, trade_date: str, col: str) -> int:
    rows = manifest[manifest["trade_date"] == trade_date]
    return int(rows[col].values[0]) if len(rows) and col in rows.columns else 0


def _set(manifest: pd.DataFrame, trade_date: str, **kwargs) -> pd.DataFrame:
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


def _aggregate_status(statuses: dict) -> str:
    """Same aggregation rule as startup_sync.py: not_available counts as
    an ok/closed outcome, not a failure."""
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
    """Same split as startup_sync.py: backward = missing dates older than
    the earliest manifest date, walked descending; forward = missing dates
    from the latest manifest date onward, walked ascending. Empty manifest
    → everything is a single forward walk."""
    all_missing = get_missing_dates(manifest, sync_start, today)
    existing = manifest["trade_date"].tolist()

    if not existing:
        return [], sorted(all_missing)

    manifest_min, manifest_max = min(existing), max(existing)

    backward = sorted((d for d in all_missing if d < manifest_min), reverse=True)
    forward  = sorted(d for d in all_missing if d >= manifest_max)

    return backward, forward


def _download_walk(dates: list[str], manifest: pd.DataFrame,
                    date_key_statuses: dict, today: str,
                    initial_saturated: dict[str, bool] | None = None) -> pd.DataFrame:
    """Walk `dates` in the order given, with its own independent per-key
    miss-streak/saturation tracking — identical logic to
    startup_sync._download_phase. Direction is entirely determined by the
    order of `dates` as passed in.

    `initial_saturated` seeds a key as already-saturated before the walk
    starts — used for the backward walk when a prior run already proved a
    key permanently dead at/before the manifest's current frontier, so we
    don't re-burn a fresh 10-miss streak on newly-missing older dates just
    to re-derive the same conclusion. See startup_sync.py for the mirrored
    logic — keep both in sync if this changes."""
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

        if trade_date == today and status == "failed":
            print(f"~ Current Day: Pending NSE upload / Market Closed: {trade_date}")
            continue

        manifest = _set(manifest, trade_date, **updates)

    return manifest


def _run_download_phase(manifest: pd.DataFrame) -> pd.DataFrame:
    today = datetime.today().strftime("%Y-%m-%d")

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
        manifest = _download_walk(backward, manifest, date_key_statuses, today,
                                   initial_saturated=initial_saturated)
        save_manifest(manifest)
        manifest = load_manifest()

    if forward:
        manifest = _download_walk(forward, manifest, date_key_statuses, today)

    save_manifest(manifest)
    return load_manifest()


def _find_round_candidates(manifest: pd.DataFrame):
    """
    Returns (tasks, meta, manifest):
      tasks — list of dicts for run_parallel_backfill:
              {"proc": key, "trade_date": <effective/check date>,
               "file_date": <manifest row date, masters only>}
      meta  — parallel list of (proc_key, manifest_date, check_date,
              pr_cols, extra_pr, check_keys); manifest_date is the
              manifest row's own trade_date (== check_date for
              non-masters; == FILE date for masters, which can differ
              from check_date).
      manifest — possibly updated in place: masters whose effective date
              still can't be confirmed get pr_col set to 2 ("deferred"),
              same as startup_sync.py does inline.
    """
    tasks, meta = [], []

    for proc_key, dl_col, pr_cols, check_keys in _PIPELINE:
        extra_dl = _EXTRA_DL.get(proc_key)
        extra_pr = _EXTRA_PR.get(proc_key)
        is_master = proc_key in _MASTER_PROCS
        pr_col = pr_cols[0]

        candidates = manifest[
            (manifest[dl_col] == 1) &
            (~manifest[pr_col].isin([1, NOT_AVAILABLE])) &
            (manifest["status"] != "market_closed")
        ]["trade_date"].tolist()

        if extra_dl:
            candidates = [d for d in candidates if _flag(manifest, d, extra_dl) == 1]

        if is_master:
            for file_date in candidates:
                if file_date < MASTER_START_DATE:
                    manifest = _set(manifest, file_date, **{pr_col: NOT_AVAILABLE})
                    continue
                eff = get_next_confirmed_trading_date(manifest, file_date)
                if eff is None:
                    manifest = _set(manifest, file_date, **{pr_col: 2})
                    continue
                if _all_processed(eff, check_keys):
                    print(f"[{proc_key}] {file_date} — already in DB, syncing manifest flag")
                    updates = {col: 1 for col in pr_cols}
                    if extra_pr:
                        updates[extra_pr] = 1
                    manifest = _set(manifest, file_date, **updates)
                    continue
                tasks.append({"proc": proc_key, "trade_date": eff, "file_date": file_date})
                meta.append((proc_key, file_date, eff, pr_cols, extra_pr, check_keys))
        else:
            for d in candidates:
                prev = get_previous_trading_date(manifest, d)
                if d < MASTER_START_DATE:
                    pass  # before masters existed at all — never defer, just process
                elif (
                    prev is not None
                    and _flag(manifest, prev, "fo_contracts_pr") == 1
                    and _flag(manifest, prev, "cm_security_pr") == 1
                ):
                    pass
                else:
                    manifest = _set(manifest, d, **{pr_col: 2})
                    continue
                if _all_processed(d, check_keys):
                    print(f"[{proc_key}] {d} — already in DB, syncing manifest flag")
                    updates = {col: 1 for col in pr_cols}
                    if extra_pr:
                        updates[extra_pr] = 1
                    manifest = _set(manifest, d, **updates)
                    continue
                tasks.append({"proc": proc_key, "trade_date": d})
                meta.append((proc_key, d, d, pr_cols, extra_pr, check_keys))

    return tasks, meta, manifest


def run_parallel_startup_sync(max_workers: int = 8, max_rounds: int = 50):
    print("────────────── NSE PARALLEL STARTUP SYNC ──────────────\n")
    init_db()
    manifest = load_manifest()

    # ── Phase 1: Download (sequential, directional — see module docstring) ──
    manifest = _run_download_phase(manifest)

    # ── Phase 2: Process (parallel, in rounds) ────────────────────────────────
    print("\nChecking processing state...\n")
    round_num = 0
    while round_num < max_rounds:
        round_num += 1
        tasks, meta, manifest = _find_round_candidates(manifest)
        save_manifest(manifest)  # persist any "already processed" / "deferred" syncs even if no tasks

        if not tasks:
            break

        print(f"\n── Round {round_num}: {len(tasks)} tasks ──")
        trade_dates_in_round = sorted({t["trade_date"] for t in tasks})

        results = run_parallel_backfill(tasks, max_workers=max_workers)
        write_all(results, trade_dates_in_round)

        for proc_key, manifest_date, check_date, pr_cols, extra_pr, check_keys in meta:
            r = results.get((check_date, proc_key))
            if r is None:
                continue
            if not r["ok"]:
                print(f"  ✗ {proc_key} {manifest_date}: {r['error']}")
                continue  # leave pr flag at 0 so it's retried next run
            if not _all_processed(check_date, check_keys):
                print(f"  ⚠ {proc_key} {manifest_date}: DB check incomplete after processing")
                continue
            updates = {col: 1 for col in pr_cols}
            if extra_pr:
                updates[extra_pr] = 1
            manifest = _set(manifest, manifest_date, **updates)

        save_manifest(manifest)
        manifest = load_manifest()  # reload so next round sees committed flags

    if round_num >= max_rounds and tasks:
        print(f"\n⚠ Stopped after {max_rounds} rounds — possible stuck candidates.")

    print("\n✓ Parallel startup sync complete.\n")


if __name__ == "__main__":
    run_parallel_startup_sync()
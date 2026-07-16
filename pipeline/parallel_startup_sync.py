"""
pipeline/parallel_startup_sync.py

Parallel-compute variant of startup_sync.py.
Phase 1 (download) is copied verbatim from startup_sync.run_startup_sync and
stays fully sequential on purpose — we don't want to hit NSE's site with
concurrent requests. Only Phase 2 (processing) is replaced with a batched
version built on pipeline.parallel_backfill (run_parallel_backfill + write_all).

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
"""

from datetime import datetime

import pandas as pd

from api.db import init_db, is_processed
from pipeline.trading_dates import get_missing_dates, get_next_confirmed_trading_date, get_previous_trading_date
from pipeline.manifest import load_manifest, save_manifest, _FLAG_COLS
from pipeline.downloader import DOWNLOAD_REGISTRY
from pipeline.parallel_backfill import run_parallel_backfill, write_all, _MASTER_PROCS
from config import SYNC_START_DATE


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
            (manifest[pr_col] != 1) &
            (manifest["status"] != "market_closed")
        ]["trade_date"].tolist()

        if extra_dl:
            candidates = [d for d in candidates if _flag(manifest, d, extra_dl) == 1]

        if is_master:
            for file_date in candidates:
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
                if not (
                    prev is not None
                    and _flag(manifest, prev, "fo_contracts_pr") == 1
                    and _flag(manifest, prev, "cm_security_pr") == 1
                ):
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


def _run_download_phase(manifest: pd.DataFrame) -> pd.DataFrame:
    """
    Phase 1 — download. Copied verbatim from startup_sync.run_startup_sync;
    stays fully sequential (one date, one file type at a time) since this
    is the part that talks to NSE's site and we don't want to parallelize
    outbound requests to it.
    """
    today   = datetime.today().strftime("%Y-%m-%d")
    missing = get_missing_dates(manifest, SYNC_START_DATE, today)

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
    return load_manifest()


def run_parallel_startup_sync(max_workers: int = 8, max_rounds: int = 50):
    print("────────────── NSE PARALLEL STARTUP SYNC ──────────────\n")
    init_db()
    manifest = load_manifest()

    # ── Phase 1: Download (sequential — unchanged from startup_sync.py) ──────
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
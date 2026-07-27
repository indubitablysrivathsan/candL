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
rewritten to dl_col = NOT_AVAILABLE (-1), and the key is marked
"saturated" for the remainder of that direction's walk — no repeated log
line, no further real requests for that key until a "complete" result
resets it. Saturation/streak state never carries across the
backward/forward boundary. -1 rows are skipped on future runs exactly
like already-downloaded (1) rows, just via a different branch.

STATUS OWNERSHIP:
`status` is owned entirely by the processing phase, with one exception:
download phase may stamp "market_closed" (NSE simply had no session that
day — nothing will ever be processed for it, so processing can't derive
this after the fact from pr flags, which won't exist). Download phase
never writes "complete" / "partial" / "failed" — a day being fully
downloaded says nothing about whether it's been processed. Those three
values are written only by _recompute_status_after_processing, which
aggregates over the row's pr_* columns once they've been touched by a
processing round, treating NOT_AVAILABLE (-1) as an ok/closed outcome
same as "1", and leaving status untouched if all pr_cols are still
pending (0/2) — we don't overwrite market_closed and we don't invent a
verdict before there's anything to aggregate.
"""

from datetime import datetime

import pandas as pd

from api.db import init_db, is_processed
from pipeline.trading_dates import get_missing_dates, get_next_confirmed_trading_date, get_previous_trading_date
from pipeline.manifest import load_manifest, save_manifest, _FLAG_COLS
from pipeline.downloader import DOWNLOAD_REGISTRY, NOT_AVAILABLE as DL_NOT_AVAILABLE, STREAK_THRESHOLD
from pipeline.parallel_backfill import run_parallel_backfill, write_all, _MASTER_PROCS, LEGACY_CUTOFF
from config import SYNC_START_DATE

NOT_AVAILABLE = -1

FAILED = 3
MAX_RETRIES = 3

_PIPELINE = [
    # (proc_key, dl_cols, pr_cols, check_keys) — dl_cols[i] governs pr_cols[i].
    # A single download gating several pr flags (e.g. fo) repeats its dl
    # column once per pr_col; independent legs (e.g. participant's OI/VOL)
    # each get their own dl/pr pair. No side-tables — everything a
    # processor needs is one row in this list.
    ("fo_contracts", ["fo_contracts_dl"], ["fo_contracts_pr"], ["FO_CONTRACT"]),
    ("cm_security",  ["cm_security_dl"],  ["cm_security_pr"],  ["CM_SECURITY"]),
    ("fo",           ["fo_dl", "fo_dl", "fo_dl", "fo_dl"],
                      ["stf_pr", "idf_pr", "sto_pr", "ido_pr"], ["STF", "IDF", "STO", "IDO"]),
    ("cm_bhav",      ["cm_bhav_dl"],      ["cm_bhav_pr"],      ["cm_bhav"]),
    ("eq_bhav",      ["eq_bhav_dl"],      ["eq_bhav_pr"],      ["eq_bhav"]),
    ("fii",          ["fii_dl"],          ["fii_pr"],          ["fii"]),
    ("participant",  ["part_oi_dl", "part_vol_dl"],
                      ["part_oi_pr", "part_vol_pr"],           ["part_oi", "part_vol"]),
    ("fo_volt",      ["fo_volt_dl"],      ["fo_volt_pr"],      ["fo_volt"]),
    ("mkt_act",      ["mkt_act_dl"],      ["mkt_act_pr"],      ["mkt_act"]),
]

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
        new["status"] = "ongoing"
        new.update(kwargs)
        manifest = pd.concat([manifest, pd.DataFrame([new])], ignore_index=True)
    else:
        for col, val in kwargs.items():
            manifest.loc[manifest["trade_date"] == trade_date, col] = val
    return manifest


def _all_processed(trade_date: str, keys: list[str]) -> bool:
    return all(is_processed(trade_date, k) for k in keys)


def _pending_pr_cols(manifest: pd.DataFrame, trade_date: str, pr_cols: list[str]) -> list[str]:
    """pr_cols still at 0/2 for this date — the only ones safe to stamp
    to 1 on success. A col already at -1 (permanently unavailable) or
    FAILED must never be overwritten just because a sibling leg on the
    same proc succeeded."""
    return [c for c in pr_cols if _flag(manifest, trade_date, c) not in (1, NOT_AVAILABLE, FAILED)]


def _is_market_closed(statuses: dict) -> bool:
    """A day is market_closed only if every download key came back
    market_closed or not_available — i.e. NSE had nothing to publish."""
    closed_statuses = ("market_closed", "not_available")
    return bool(statuses) and all(s in closed_statuses for s in statuses.values())


def _recompute_status_after_processing(manifest: pd.DataFrame, trade_date: str) -> pd.DataFrame:
    """Re-aggregate `status` from pr_* flags after a processing write.
    NOT_AVAILABLE counts as an ok/closed outcome, same rule the download
    phase used to apply to dl_* flags. market_closed is sticky — a closed
    day has no real pr work to do and is never touched here. If every
    pr_col is still pending (0/2), status is left as-is rather than
    invented early."""
    row = manifest[manifest["trade_date"] == trade_date]
    if not len(row):
        return manifest
    row = row.iloc[0]

    if row.get("status") == "market_closed":
        return manifest

    pr_cols = [c for c in _FLAG_COLS if c.endswith("_pr") and c in row.index]
    if not pr_cols:
        return manifest

    vals = [row[c] for c in pr_cols]
    ok_vals = (1, NOT_AVAILABLE)

    if all(v in ok_vals for v in vals):
        new_status = "complete"
    elif all(v in ok_vals or v == FAILED for v in vals) and any(v == FAILED for v in vals):
        new_status = "failed"
    elif any(v in ok_vals for v in vals):
        new_status = "partial"
    else:
        return manifest  # still all pending (0/2) — nothing to say yet

    if new_status != row.get("status"):
        manifest = _set(manifest, trade_date, status=new_status)
    return manifest


def _all_dl_resolved(manifest: pd.DataFrame, trade_date: str) -> bool:
    """True if every download key for this date is already settled (1 or
    -1) — nothing left for the downloader to do. get_missing_dates can
    surface a date as "missing" for reasons unrelated to dl flags (e.g.
    it isn't fully processed yet), but that's a processing-phase concern,
    not a download-phase one — the downloader must never be invoked for
    a date it already fully resolved."""
    for entry in DOWNLOAD_REGISTRY.values():
        dl_col = entry["manifest_col"]
        if _flag(manifest, trade_date, dl_col) not in (1, DL_NOT_AVAILABLE):
            return False
    return True


def _split_directional(manifest: pd.DataFrame, sync_start: str, today: str) -> tuple[list[str], list[str], list[str]]:
    """Same three-way split as startup_sync.py:
      - backward: missing dates older than the earliest manifest date,
        walked DESCENDING.
      - retry: missing dates INSIDE the existing manifest range
        (manifest_min <= d < manifest_max) — i.e. holes: rows that were
        deleted, or dates that were somehow never written despite newer
        and older dates existing. Kept OUT of directional streak logic
        entirely, same as the original — a hole isn't evidence about
        "when did this file type stop/start existing", it's just a gap
        that needs a plain retry.
      - forward: missing dates from the latest manifest date onward,
        walked ASCENDING.
    Empty manifest → everything is a single forward walk (no frontier to
    be backward/forward/retry *relative to*).

    Any date whose dl_cols are already fully resolved (1/-1) is dropped
    from all three groups regardless of what get_missing_dates says —
    those dates have nothing left for the download phase to do; if
    they're still incomplete it's a processing-side gap, not a download
    one, and re-walking them here only produces misleading "Download ok"
    noise for dates that were never actually re-downloaded."""
    all_missing = [d for d in get_missing_dates(manifest, sync_start, today)
                   if not _all_dl_resolved(manifest, d)]
    existing = manifest["trade_date"].tolist()

    if not existing:
        return [], [], sorted(all_missing)

    manifest_min, manifest_max = min(existing), max(existing)

    backward = sorted((d for d in all_missing if d < manifest_min), reverse=True)
    retry    = sorted(d for d in all_missing if manifest_min <= d < manifest_max)
    forward  = sorted(d for d in all_missing if d >= manifest_max)

    return backward, retry, forward


def _download_walk(dates: list[str], manifest: pd.DataFrame,
                    date_key_statuses: dict, today: str,
                    initial_saturated: dict[str, bool] | None = None) -> pd.DataFrame:
    """Walk `dates` in the order given, with its own independent per-key
    miss-streak/saturation tracking — identical logic to
    startup_sync._download_phase. Direction is entirely determined by the
    order of `dates` as passed in.

    Writes only dl_* flags and, when every key for the day resolves to
    market_closed/not_available, the sticky "market_closed" status.
    Otherwise `status` is left untouched here — see module docstring.

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

            # Masters don't exist before MASTER_START_DATE — known
            # permanent absence, not a miss to feed into the streak.
            if dl_key in ("fo_contracts", "cm_security") and trade_date < MASTER_START_DATE:
                updates[dl_col] = DL_NOT_AVAILABLE
                statuses[dl_key] = "not_available"
                continue

            try:
                result = entry["download"](trade_date)
            except OSError as e:
                # Local/environmental failure (file locked, permission
                # denied, disk issue, etc.) — not evidence about whether
                # the source has this date's data. Must NOT feed the
                # miss-streak, or enough of these across dates would
                # eventually trip false -1 saturation. Leave dl_col
                # untouched at 0 for a clean retry next run.
                print(
                    f"  ✗ [{dl_key}] {trade_date}: local error, not a data "
                    f"failure — {type(e).__name__}: {e}"
                )
                statuses[dl_key] = "failed"
                continue
            except Exception as e:
                # Treat like any other failed attempt so the miss-streak
                # (and eventual 10-in-a-row saturation) still fires,
                # instead of propagating and killing the whole sync.
                print(
                    f"  ✗ [{dl_key}] crashed for {trade_date}: "
                    f"{type(e).__name__}: {e}"
                )
                result = "failed"

            if result == "complete":
                updates[dl_col] = 1
                miss_streaks[dl_key] = []
                saturated[dl_key] = False
                statuses[dl_key] = "complete"
                continue

            if result == "market_closed":
                # Known-good non-error outcome — the exchange was shut,
                # not evidence this file type stopped existing. Leave
                # dl_col at 0 (never downloaded because there was nothing
                # to download) and don't touch the miss streak — a run of
                # consecutive holidays must never trip -1 saturation.
                statuses[dl_key] = "market_closed"
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
                print(f"  ~ [{dl_key}] {STREAK_THRESHOLD}+ consecutive misses through {trade_date} "
                      f"— marking stretch as not-available")
                statuses[dl_key] = "not_available"
                saturated[dl_key] = True

        date_key_statuses[trade_date] = statuses

        all_ok = all(s in ("complete", "already", "not_available") for s in statuses.values())
        is_failed_today = (trade_date == today) and not all_ok and not any(
            s in ("complete", "already") for s in statuses.values()
        )

        if is_failed_today:
            # Nothing published for today yet (pre-close, or NSE hasn't
            # uploaded). No manifest row exists yet for this date and we
            # deliberately don't create one here — same as before, just
            # don't mislabel it "partial" on the way out.
            print(f"~ Current day pending NSE upload / market closed: {trade_date}")
            continue

        any_ok = any(s in ("complete", "already", "not_available") for s in statuses.values())
        if _is_market_closed(statuses):
            symbol, label = "~", "market_closed"
        elif all_ok:
            symbol, label = "✓", "ok"
        elif any_ok:
            symbol, label = "~", "partial"
        else:
            symbol, label = "✗", "failed"
        print(f"{symbol} Download {label}: {trade_date}")

        if _is_market_closed(statuses):
            updates["status"] = "market_closed"

        manifest = _set(manifest, trade_date, **updates)

    return manifest


def _retry_historical_dates(dates: list[str], manifest: pd.DataFrame) -> pd.DataFrame:
    """Plain retry for holes inside the existing manifest range (deleted
    rows, or dates that were never written despite newer/older dates
    existing). Mirrors startup_sync._retry_historical_dates: up to
    MAX_RETRIES attempts per key, success -> dl_col=1, exhausted ->
    dl_col=NOT_AVAILABLE (treated as proof-of-absence immediately, same
    conclusion the directional streak logic reaches via 10 misses — just
    reached in one run since these are known gaps, not an unknown
    frontier). No directional streak/saturation state here; each date is
    independent. Status: only market_closed gets stamped (sticky, same
    rule as _download_walk) — otherwise left untouched for the processing
    phase to fill in later."""
    MAX_RETRIES = 3

    for trade_date in dates:
        statuses = {}
        updates = {}
        attempted = False

        for dl_key, entry in DOWNLOAD_REGISTRY.items():
            dl_col = entry["manifest_col"]
            existing = _flag(manifest, trade_date, dl_col)

            if existing == 1:
                statuses[dl_key] = "already"
                continue
            if existing == DL_NOT_AVAILABLE:
                statuses[dl_key] = "not_available"
                continue

            # Masters don't exist before MASTER_START_DATE — NSE never
            # published them, so this isn't a transient failure to retry,
            # it's a known permanent absence. Skip straight to
            # NOT_AVAILABLE without burning retries or hitting the network.
            if dl_key in ("fo_contracts", "cm_security") and trade_date < MASTER_START_DATE:
                updates[dl_col] = DL_NOT_AVAILABLE
                statuses[dl_key] = "not_available"
                attempted = True
                print(f"  ~ [{dl_key}] {trade_date}: before MASTER_START_DATE — marking not-available")
                continue

            attempted = True
            result = None
            local_error = False
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    result = entry["download"](trade_date)
                except OSError as e:
                    # Local/environmental failure (file locked by Excel,
                    # permission denied, disk full, etc.) — says nothing
                    # about whether the source has the data. Don't burn
                    # retries pretending it's a data-side failure and
                    # NEVER let this reach the NOT_AVAILABLE fallback.
                    print(f"  ✗ [{dl_key}] {trade_date}: local error, not a data "
                          f"failure — {type(e).__name__}: {e}")
                    local_error = True
                    break
                except Exception as e:
                    # A raised exception from the download call itself
                    # (network error, 404, etc.) is a failed attempt, not
                    # a fatal crash — degrade it to a "failed" result so
                    # retry counting and the eventual NOT_AVAILABLE
                    # fallback below still run, instead of propagating
                    # and killing the whole sync mid-manifest.
                    print(f"  ✗ [{dl_key}] attempt {attempt}/{MAX_RETRIES} crashed for "
                          f"{trade_date}: {type(e).__name__}: {e}")
                    result = "failed"
                    continue
                if result in ("complete", "market_closed"):
                    break
                print(f"  ~ [{dl_key}] attempt {attempt}/{MAX_RETRIES} failed for {trade_date} ({result})")

            if result == "complete":
                updates[dl_col] = 1
                statuses[dl_key] = "complete"
            elif result == "market_closed":
                # Confirmed closed on first sight — not a failure, don't
                # burn remaining retries and don't write -1. dl_col stays
                # 0, same as any other closed day.
                statuses[dl_key] = "market_closed"
            elif local_error:
                # Environmental failure, not a data-side one. Leave
                # dl_col untouched at 0 — no -1, no "not_available" —
                # so this key gets picked up cleanly on the next run
                # instead of being permanently written off.
                statuses[dl_key] = "failed"
            else:
                updates[dl_col] = DL_NOT_AVAILABLE
                statuses[dl_key] = "not_available"
                print(f"  ~ [{dl_key}] {trade_date}: exhausted {MAX_RETRIES} retries — marking not-available")

        if not attempted:
            # Every dl_col for this date was already 1 or -1 — nothing to
            # retry, this date only showed up because get_missing_dates
            # flags it on some other basis (e.g. unprocessed rows). Don't
            # log it as a retry; just fall through to the market_closed
            # check below in case that still needs stamping.
            if _is_market_closed(statuses):
                row = manifest[manifest["trade_date"] == trade_date]
                current_status = row["status"].values[0] if len(row) and "status" in row.columns else ""
                if current_status != "market_closed":
                    manifest = _set(manifest, trade_date, status="market_closed")
            continue

        print(f"~ Retry historical: {trade_date}")

        if _is_market_closed(statuses):
            updates["status"] = "market_closed"

        manifest = _set(manifest, trade_date, **updates)

        all_ok = all(s in ("complete", "already", "not_available") for s in statuses.values())
        any_ok = any(s in ("complete", "already", "not_available") for s in statuses.values())
        if _is_market_closed(statuses):
            symbol, label = "~", "market_closed"
        elif all_ok:
            symbol, label = "✓", "ok"
        elif any_ok:
            symbol, label = "~", "partial"
        else:
            symbol, label = "✗", "failed"
        print(f"{symbol} Historical retry {label}: {trade_date}")

    return manifest


def _run_download_phase(manifest: pd.DataFrame) -> pd.DataFrame:
    today = datetime.today().strftime("%Y-%m-%d")

    backward, retry, forward = _split_directional(manifest, SYNC_START_DATE, today)
    total = len(backward) + len(retry) + len(forward)
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

    if retry:
        manifest = _retry_historical_dates(retry, manifest)
        save_manifest(manifest)
        manifest = load_manifest()

    if forward:
        manifest = _download_walk(forward, manifest, date_key_statuses, today)

    save_manifest(manifest)
    return load_manifest()


def _propagate_unavailable_downloads(manifest: pd.DataFrame) -> pd.DataFrame:
    """A pr_col whose governing dl_col is NOT_AVAILABLE can never be
    processed — there's no file. Previously these rows were left at pr=0
    forever, which both kept them stuck out of (or perpetually
    re-entering) the candidate scan and kept `status` from ever resolving
    to complete. Mirror the sentinel through: pr_col -> NOT_AVAILABLE,
    same as dl_col, whenever pr_col is still pending (0). Rows already at
    1/-1/FAILED are left alone. dl_cols[i] governs pr_cols[i] — walk the
    pairs directly, no separate "extra" columns to special-case."""
    for proc_key, dl_cols, pr_cols, _check_keys in _PIPELINE:
        touched_dates = set()
        for dl_col, pr_col in zip(dl_cols, pr_cols):
            unavailable_rows = manifest[manifest[dl_col] == DL_NOT_AVAILABLE]["trade_date"].tolist()
            for d in unavailable_rows:
                if _flag(manifest, d, pr_col) == 0:
                    manifest = _set(manifest, d, **{pr_col: NOT_AVAILABLE})
                touched_dates.add(d)

        for d in touched_dates:
            manifest = _recompute_status_after_processing(manifest, d)

    return manifest


def _find_round_candidates(manifest: pd.DataFrame):
    """
    Returns (tasks, meta, manifest):
      tasks — list of dicts for run_parallel_backfill:
              {"proc": key, "trade_date": <effective/check date>,
               "file_date": <manifest row date, masters only>}
      meta  — parallel list of (proc_key, manifest_date, check_date,
              pr_cols, check_keys); manifest_date is the manifest row's
              own trade_date (== check_date for non-masters; == FILE date
              for masters, which can differ from check_date).
      manifest — possibly updated in place: masters whose effective date
              still can't be confirmed get pr_col set to 2 ("deferred"),
              same as startup_sync.py does inline.
    """
    tasks, meta = [], []

    for proc_key, dl_cols, pr_cols, check_keys in _PIPELINE:
        is_master = proc_key in _MASTER_PROCS
        pr_col = pr_cols[0]  # representative column for defer(2)/master bookkeeping

        # Ready to attempt if ANY governing dl_col is downloaded — a
        # processor with independent legs (e.g. participant) shouldn't
        # wait on a leg that's permanently unavailable.
        dl_ready = manifest[dl_cols[0]] == 1
        for extra_col in set(dl_cols[1:]):
            dl_ready = dl_ready | (manifest[extra_col] == 1)

        # Still eligible if ANY pr_col is unresolved — a single resolved
        # leg (e.g. part_oi_pr already -1) must not mask a still-pending
        # sibling leg (part_vol_pr still 0).
        pr_pending = ~manifest[pr_cols[0]].isin([1, NOT_AVAILABLE, FAILED])
        for extra_col in pr_cols[1:]:
            pr_pending = pr_pending | ~manifest[extra_col].isin([1, NOT_AVAILABLE, FAILED])

        candidates = manifest[
            (manifest["trade_date"] >= SYNC_START_DATE) &
            dl_ready &
            pr_pending &
            (manifest["status"] != "market_closed")
        ]["trade_date"].tolist()

        if is_master:
            for file_date in candidates:
                if file_date < MASTER_START_DATE:
                    manifest = _set(manifest, file_date, **{pr_col: NOT_AVAILABLE})
                    manifest = _recompute_status_after_processing(manifest, file_date)
                    continue
                eff = get_next_confirmed_trading_date(manifest, file_date)
                if eff is None:
                    manifest = _set(manifest, file_date, **{pr_col: 2})
                    continue
                if _all_processed(eff, check_keys):
                    print(f"[{proc_key}] {file_date} — already in DB, syncing manifest flag")
                    updates = {col: 1 for col in _pending_pr_cols(manifest, file_date, pr_cols)}
                    manifest = _set(manifest, file_date, **updates)
                    manifest = _recompute_status_after_processing(manifest, file_date)
                    continue
                tasks.append({"proc": proc_key, "trade_date": eff, "file_date": file_date})
                meta.append((proc_key, file_date, eff, pr_cols, check_keys))
        else:
            for d in candidates:
                prev = get_previous_trading_date(manifest, d)

                # --- leg 1: master-flag dependency, only meaningful once masters exist ---
                if d < MASTER_START_DATE:
                    pass  # masters don't exist yet — never defer on this leg
                elif (
                    prev is not None
                    and _flag(manifest, prev, "fo_contracts_pr") in (1, NOT_AVAILABLE)
                    and _flag(manifest, prev, "cm_security_pr") in (1, NOT_AVAILABLE)
                ):
                    pass
                    pass
                else:
                    manifest = _set(manifest, d, **{pr_col: 2})
                    continue

                # --- leg 2: cm_bhav/mkt_act dependency, legacy fo only, bounded
                #     only by LEGACY_CUTOFF (unrelated to master availability) ---
                if proc_key == "fo" and d < LEGACY_CUTOFF:
                    resolved = {1, NOT_AVAILABLE, FAILED}
                    ok = (
                        _flag(manifest, d, "cm_bhav_pr") in resolved
                        and _flag(manifest, d, "mkt_act_pr") in resolved
                        and (prev is None or _flag(manifest, prev, "cm_bhav_pr") in resolved)
                        and (prev is None or _flag(manifest, prev, "mkt_act_pr") in resolved)
                    )
                    if not ok:
                        manifest = _set(manifest, d, **{pr_col: 2})
                        continue

                if _all_processed(d, check_keys):
                    print(f"[{proc_key}] {d} — already in DB, syncing manifest flag")
                    updates = {col: 1 for col in _pending_pr_cols(manifest, d, pr_cols)}
                    manifest = _set(manifest, d, **updates)
                    manifest = _recompute_status_after_processing(manifest, d)
                    continue
                tasks.append({"proc": proc_key, "trade_date": d})
                meta.append((proc_key, d, d, pr_cols, check_keys))

    return tasks, meta, manifest


def run_parallel_startup_sync(max_workers: int = 8, max_rounds: int = 50):
    print("────────────── NSE PARALLEL STARTUP SYNC ──────────────\n")
    init_db()
    manifest = load_manifest()

    manifest = _run_download_phase(manifest)
    manifest = _propagate_unavailable_downloads(manifest)
    save_manifest(manifest)

    print("\nChecking processing state...\n")
    retry_counts: dict[tuple[str, str], int] = {}   # (proc_key, manifest_date) -> fail count

    round_num = 0
    tasks = []
    while round_num < max_rounds:
        round_num += 1
        tasks, meta, manifest = _find_round_candidates(manifest)
        save_manifest(manifest)

        if not tasks:
            break

        print(f"\n── Round {round_num}: {len(tasks)} tasks ──")
        trade_dates_in_round = sorted({t["trade_date"] for t in tasks})

        results = run_parallel_backfill(tasks, max_workers=max_workers)
        write_all(results, trade_dates_in_round)

        for proc_key, manifest_date, check_date, pr_cols, check_keys in meta:
            r = results.get((check_date, proc_key))
            if r is None:
                continue

            key = (proc_key, manifest_date)

            if not r["ok"]:
                retry_counts[key] = retry_counts.get(key, 0) + 1
                if retry_counts[key] >= MAX_RETRIES:
                    print(f"  ✗ {proc_key} {manifest_date}: giving up after "
                          f"{MAX_RETRIES} failures — {r['error']}")
                    pending = _pending_pr_cols(manifest, manifest_date, pr_cols)
                    manifest = _set(manifest, manifest_date, **{col: FAILED for col in pending})
                    manifest = _recompute_status_after_processing(manifest, manifest_date)
                else:
                    print(f"  ✗ {proc_key} {manifest_date} "
                          f"(attempt {retry_counts[key]}/{MAX_RETRIES}): {r['error']}")
                continue  # leave at 0 for retry, or FAILED just set above — either way, skip flag-update below

            if not _all_processed(check_date, check_keys):
                print(f"  ⚠ {proc_key} {manifest_date}: DB check incomplete after processing")
                continue

            updates = {col: 1 for col in _pending_pr_cols(manifest, manifest_date, pr_cols)}
            manifest = _set(manifest, manifest_date, **updates)
            manifest = _recompute_status_after_processing(manifest, manifest_date)

        save_manifest(manifest)
        manifest = load_manifest()

    if round_num >= max_rounds and tasks:
        print(f"\n⚠ Stopped after {max_rounds} rounds — possible stuck candidates.")

    print("\n✓ Parallel startup sync complete.\n")


if __name__ == "__main__":
    run_parallel_startup_sync()
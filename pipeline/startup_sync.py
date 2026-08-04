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
into three independently-walked runs relative to the dates already
present in the manifest:

  - BACKWARD: missing dates older than the earliest manifest date,
    walked in DESCENDING order (closest to existing data first, marching
    down toward SYNC_START_DATE last).
  - RETRY: missing dates INSIDE the existing manifest range
    (manifest_min <= d < manifest_max) — holes: rows that were deleted,
    or dates that were never written despite newer and older dates
    existing. Kept OUT of directional streak/saturation logic entirely —
    a hole isn't evidence about "when did this file type stop/start
    existing", it's just a gap that needs a plain retry.
  - FORWARD: missing dates from the latest manifest date onward
    (including any in-range gaps and "today"), walked in ASCENDING order.

Any date whose dl_cols are ALL already resolved (1 or -1) is dropped
before any of the three groups are built, regardless of what
get_missing_dates reports — such a date has nothing left for the
download phase to do; if it's still incomplete, that's a processing-side
gap (deferred pr flags), not a download one, and re-walking it here would
just produce misleading "Download ok" noise for a date that was never
actually re-downloaded.

Each direction keeps its own independent, per-download-key rolling streak
of consecutive real misses. "market_closed" results do NOT feed this
streak — a known-good non-error outcome (the exchange was shut) is not
evidence a file type stopped existing, and a run of consecutive holidays
must never trip -1 saturation. Only genuine failures count. Once a real
streak reaches STREAK_THRESHOLD (10) within a direction, the entire
streak so far is rewritten to dl_col = NOT_AVAILABLE (-1), and the key is
marked "saturated" for the remainder of that direction's walk: every
further date is immediately written -1 for that key with no real
request and no repeated log line. A "complete" result resets the streak
and clears saturation for that key. Saturation and streak state do NOT
carry across the backward/forward boundary — they are separate walks
answering separate questions ("when did this file type start existing"
vs "did it stop existing recently"). -1 rows are skipped on future runs
(never re-attempted) exactly like already-downloaded (1) rows are
skipped, just via a different branch. A day that's simply market_closed
is left at dl_col=0 (never attempted, nothing to attempt) — this is what
gives closed stretches their visually distinct "wall of zeros" in the
manifest, separate from both real 1s and real -1s.

STATUS OWNERSHIP:
`status` is owned entirely by the processing phase, with one exception:
download phase may stamp "market_closed" (NSE simply had no session that
day — nothing will ever be processed for it, so processing can't derive
this after the fact from pr flags, which won't exist). Download phase
never writes "complete" / "partial" / "failed" — a day being fully
downloaded says nothing about whether it's been processed. Those three
values are written only by _recompute_status_after_processing, which
aggregates over the row's pr_* columns once they've been touched by
processing, treating NOT_AVAILABLE (-1) as an ok/closed outcome same as
"1", and leaving status untouched if all pr_cols are still pending (0/2)
— we don't overwrite market_closed and we don't invent a verdict before
there's anything to aggregate.
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
    ("fo_contracts", ["fo_contracts_dl"], ["fo_contracts_pr"], ["FO_CONTRACT"]),
    ("cm_security",  ["cm_security_dl"],  ["cm_security_pr"],  ["CM_SECURITY"]),
    ("cm_bhav",      ["cm_bhav_dl"],      ["cm_bhav_pr"],      ["cm_bhav"]),
    ("eq_bhav",      ["eq_bhav_dl"],      ["eq_bhav_pr"],      ["eq_bhav"]),
    ("mkt_act",      ["mkt_act_dl"],      ["mkt_act_pr"],      ["mkt_act"]),
    ("fo",           ["fo_dl", "fo_dl", "fo_dl", "fo_dl"],
                      ["stf_pr", "idf_pr", "sto_pr", "ido_pr"], ["STF", "IDF", "STO", "IDO"]),
    ("fii",          ["fii_dl"],          ["fii_pr"],          ["fii"]),
    ("participant",  ["part_oi_dl", "part_vol_dl"],
                      ["part_oi_pr", "part_vol_pr"],           ["part_oi", "part_vol"]),
    ("fo_volt",      ["fo_volt_dl"],      ["fo_volt_pr"],      ["fo_volt"]),
]

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

FAILED = 3
MAX_RETRIES = 3


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

def _propagate_unavailable_downloads(manifest: pd.DataFrame) -> pd.DataFrame:
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

def _pending_pr_cols(manifest: pd.DataFrame, trade_date: str, pr_cols: list[str]) -> list[str]:
    """pr_cols still at 0/2 for this date — the only ones safe to stamp
    to 1 on success. A col already at -1/FAILED must never be overwritten
    just because a sibling leg on the same proc succeeded."""
    return [c for c in pr_cols if _flag(manifest, trade_date, c) not in (1, NOT_AVAILABLE, FAILED)]

def _all_processed(trade_date: str, keys: list[str]) -> bool:
    return all(is_processed(trade_date, k) for k in keys)


def _resolve_proc_key(proc_key: str, trade_date: str) -> str:
    """Swap to the _legacy variant for dates before LEGACY_CUTOFF."""
    if proc_key in _LEGACY_SWITCH_KEYS and trade_date < LEGACY_CUTOFF:
        return f"{proc_key}_legacy"
    return proc_key


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
    """
    Split missing dates into three groups:
      - backward: dates older than the earliest existing manifest date,
        walked DESCENDING (closest to existing data first, marching down
        toward sync_start last).
      - retry: existing in-range dates (between manifest_min and
        manifest_max) that are missing — historical holes, kept OUT of
        directional streak/saturation logic.
      - forward: dates from the latest existing manifest date onward,
        walked ASCENDING.
    If the manifest is empty there is no frontier to be backward/forward
    *from* — the whole range is a single forward walk.

    Dates already fully resolved on the dl side (_all_dl_resolved) are
    filtered out before the split, regardless of what get_missing_dates
    reports — see module docstring.
    """
    def _key(d: str) -> datetime:
        return datetime.strptime(d, "%Y-%m-%d")

    all_missing = [d for d in get_missing_dates(manifest, sync_start, today)
                   if not _all_dl_resolved(manifest, d)]
    existing = manifest["trade_date"].tolist()

    if not existing:
        return [], [], sorted(all_missing, key=_key)

    manifest_min = min(existing, key=_key)
    manifest_max = max(existing, key=_key)
    min_key, max_key = _key(manifest_min), _key(manifest_max)

    backward = sorted((d for d in all_missing if _key(d) < min_key), key=_key, reverse=True)
    retry    = sorted((d for d in all_missing if min_key <= _key(d) < max_key), key=_key)
    forward  = sorted((d for d in all_missing if _key(d) >= max_key), key=_key)

    return backward, retry, forward


def _download_phase(dates: list[str], manifest: pd.DataFrame,
                     date_key_statuses: dict, today: str,
                     initial_saturated: dict[str, bool] | None = None) -> pd.DataFrame:
    """Walk `dates` in the order given, with its own independent per-key
    miss-streak/saturation tracking. Direction is entirely determined by
    the order of `dates` as passed in — this function doesn't know or
    care whether it's walking backward or forward.

    Writes only dl_* flags and, when every key for the day resolves to
    market_closed/not_available, the sticky "market_closed" status.
    Otherwise `status` is left untouched here for the processing phase.

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
        any_ok = any(s in ("complete", "already", "not_available") for s in statuses.values())
        is_failed_today = (trade_date == today) and not any_ok

        if is_failed_today:
            # Nothing published for today yet (pre-close, or NSE hasn't
            # uploaded). No manifest row exists yet for this date and we
            # deliberately don't create one here.
            print(f"~ Current day pending NSE upload / market closed: {trade_date}")
            continue

        if _is_market_closed(statuses):
            symbol, label = "~", "market_closed"
            updates["status"] = "market_closed"
        elif all_ok:
            symbol, label = "✓", "ok"
        elif any_ok:
            symbol, label = "~", "partial"
        else:
            symbol, label = "✗", "failed"
        print(f"{symbol} Download {label}: {trade_date}")

        manifest = _set(manifest, trade_date, **updates)

    return manifest


def _retry_historical_dates(dates: list[str], manifest: pd.DataFrame) -> pd.DataFrame:
    """
    Retry unresolved download flags on existing historical holes.

      - existing 1  -> already available, skip
      - existing -1 -> already known unavailable, skip
      - existing 0  -> retry download, up to MAX_RETRIES attempts

    If a retry succeeds: dl flag -> 1.
    If a retry confirms market_closed: leave dl flag at 0 (not a
    failure, don't burn remaining attempts, don't write -1 — same rule
    as the directional walk).
    If all MAX_RETRIES attempts genuinely fail: dl flag -> -1
    (not_available) — MAX_RETRIES attempts is treated as proof the file
    is gone, same conclusion the directional streak logic reaches via 10
    consecutive misses, just reached immediately since these are known
    historical gaps rather than an unknown frontier.

    Dates where every key was already resolved (1/-1) are not logged at
    all — nothing was actually retried, so a log line would be noise.
    """
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

            # existing == 0: retry unresolved historical file, up to
            # MAX_RETRIES attempts, before giving up on it for good.
            attempted = True
            result = None
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    result = entry["download"](trade_date)
                except Exception as e:
                    print(
                        f"  ✗ DOWNLOAD CRASH: key={dl_key}, "
                        f"date={trade_date}, "
                        f"type={type(e).__name__}: {e}"
                    )
                    raise

                if result in ("complete", "market_closed"):
                    break

                print(
                    f"  ~ [{dl_key}] attempt {attempt}/{MAX_RETRIES} "
                    f"failed for {trade_date} ({result})"
                )

            if result == "complete":
                updates[dl_col] = 1
                statuses[dl_key] = "complete"
            elif result == "market_closed":
                # Confirmed closed on first sight — not a failure, don't
                # burn remaining retries and don't write -1. dl_col stays
                # 0, same as any other closed day.
                statuses[dl_key] = "market_closed"
            else:
                # Exhausted all retries — proven unavailable, write -1
                # so future runs skip it like any other saturated date.
                updates[dl_col] = DL_NOT_AVAILABLE
                statuses[dl_key] = "not_available"
                print(
                    f"  ~ [{dl_key}] {trade_date}: exhausted "
                    f"{MAX_RETRIES} retries — marking not-available"
                )

        if not attempted:
            # Every dl_col for this date was already 1 or -1 — nothing to
            # retry, this date only showed up because get_missing_dates
            # flags it on some other basis (e.g. unprocessed rows). Don't
            # log it as a retry.
            continue

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
        print(f"~ Retry historical: {trade_date}")
        print(f"{symbol} Historical retry {label}: {trade_date}")

    return manifest


def run_startup_sync():
    print("────────────── NSE STARTUP SYNC ──────────────\n")
    init_db()

    manifest = load_manifest()
    today    = datetime.today().strftime("%Y-%m-%d")

    # ── Phase 1: Download ─────────────────────────────────────────────────
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
        manifest = _download_phase(backward, manifest, date_key_statuses, today,
                                    initial_saturated=initial_saturated)
        save_manifest(manifest)
        manifest = load_manifest()

    if retry:
        manifest = _retry_historical_dates(retry, manifest)
        save_manifest(manifest)
        manifest = load_manifest()

    if forward:
        manifest = _download_phase(forward, manifest, date_key_statuses, today)

    manifest = _propagate_unavailable_downloads(manifest)
    save_manifest(manifest)

    # ── Phase 2: Process ──────────────────────────────────────────────────
    print("\nChecking processing state...\n")
    manifest = load_manifest()

    retry_counts: dict[tuple[str, str], int] = {}

    for proc_key, dl_cols, pr_cols, check_keys in _PIPELINE:
        is_master = proc_key in _MASTER_KEYS
        pr_col = pr_cols[0]  # representative column for defer(2)/master bookkeeping

        dl_ready = manifest[dl_cols[0]] == 1
        for extra_col in set(dl_cols[1:]):
            dl_ready = dl_ready | (manifest[extra_col] == 1)

        pr_pending = ~manifest[pr_cols[0]].isin([1, NOT_AVAILABLE, FAILED])
        for extra_col in pr_cols[1:]:
            pr_pending = pr_pending | ~manifest[extra_col].isin([1, NOT_AVAILABLE, FAILED])

        candidates = manifest[
            dl_ready & pr_pending & (manifest["status"] != "market_closed")
        ]["trade_date"].tolist()

        if is_master:
            effective_date = {}
            kept = []
            for file_date in candidates:
                if file_date < MASTER_START_DATE:
                    manifest = _set(manifest, file_date, **{pr_col: NOT_AVAILABLE})
                    manifest = _recompute_status_after_processing(manifest, file_date)
                    continue
                eff = get_next_confirmed_trading_date(manifest, file_date)
                if eff is not None:
                    effective_date[file_date] = eff
                    kept.append(file_date)
                else:
                    manifest = _set(manifest, file_date, **{pr_col: DEFERRED})
            candidates = kept
        else:
            kept = []
            for d in candidates:
                prev = get_previous_trading_date(manifest, d)
                if d < MASTER_START_DATE:
                    pass
                elif (
                    prev is not None
                    and _flag(manifest, prev, "fo_contracts_pr") in (1, NOT_AVAILABLE)
                    and _flag(manifest, prev, "cm_security_pr") in (1, NOT_AVAILABLE)
                ):
                    pass
                else:
                    manifest = _set(manifest, d, **{pr_col: DEFERRED})
                    continue

                if proc_key == "fo" and d < LEGACY_CUTOFF:
                    resolved = {1, NOT_AVAILABLE, FAILED}
                    ok = (
                        _flag(manifest, d, "cm_bhav_pr") in resolved
                        and _flag(manifest, d, "mkt_act_pr") in resolved
                        and (prev is None or _flag(manifest, prev, "cm_bhav_pr") in resolved)
                        and (prev is None or _flag(manifest, prev, "mkt_act_pr") in resolved)
                    )
                    if not ok:
                        manifest = _set(manifest, d, **{pr_col: DEFERRED})
                        continue

                kept.append(d)
            candidates = kept

        for trade_date in sorted(candidates):
            check_date = effective_date[trade_date] if is_master else trade_date
            run_key = _resolve_proc_key(proc_key, trade_date)

            if run_key not in PROCESSOR_REGISTRY:
                continue

            if _all_processed(check_date, check_keys):
                print(f"[{proc_key}] {trade_date} — already in DB, syncing manifest flag")
                updates = {col: 1 for col in _pending_pr_cols(manifest, trade_date, pr_cols)}
                manifest = _set(manifest, trade_date, **updates)
                manifest = _recompute_status_after_processing(manifest, trade_date)
                continue

            key = (proc_key, trade_date)
            try:
                if is_master:
                    PROCESSOR_REGISTRY[run_key](file_date=trade_date, trade_date=check_date)
                else:
                    PROCESSOR_REGISTRY[run_key](trade_date)

                if _all_processed(check_date, check_keys):
                    updates = {col: 1 for col in _pending_pr_cols(manifest, trade_date, pr_cols)}
                    manifest = _set(manifest, trade_date, **updates)
                    manifest = _recompute_status_after_processing(manifest, trade_date)
                    retry_counts.pop(key, None)
                else:
                    print(f"  ⚠ {proc_key} {trade_date}: DB check incomplete after processing")
            except FileNotFoundError as e:
                print(f"  ✗ {proc_key} {trade_date}: file missing — {e}")
            except Exception as e:
                retry_counts[key] = retry_counts.get(key, 0) + 1
                if retry_counts[key] >= MAX_RETRIES:
                    print(f"  ✗ {proc_key} {trade_date}: giving up after {MAX_RETRIES} failures — {e}")
                    pending = _pending_pr_cols(manifest, trade_date, pr_cols)
                    manifest = _set(manifest, trade_date, **{col: FAILED for col in pending})
                    manifest = _recompute_status_after_processing(manifest, trade_date)
                else:
                    print(f"  ✗ {proc_key} {trade_date} (attempt {retry_counts[key]}/{MAX_RETRIES}): {e}")

    save_manifest(manifest)
    print("\n✓ Startup sync complete.\n")


if __name__ == "__main__":
    run_startup_sync()
"""
pipeline/parallel_backfill.py

Two-stage parallel backfill:

  1. COMPUTE (parallel, ProcessPoolExecutor) — each (date, processor) task
     parses its raw file and builds output DataFrames/rows. No DB connection
     is opened in worker processes.

  2. WRITE (single process, one long-lived connection) — strictly sequential
     by trade_date, and within a date, masters before non-masters:

         fo_contracts, cm_security  →  fo, cm_bhav  →  eq_bhav
                                     →  fii, participant, fo_volt, mkt_act

     (eq_bhav depends on cm_bhav having run for the same date because it
     patches rows cm_bhav already inserted; fii/participant/fo_volt/mkt_act
     have no same-day dependency on each other or on fo/cm_bhav.)

Drop this in as pipeline/parallel_backfill.py.

Usage:

    from pipeline.parallel_backfill import build_tasks, run_parallel_backfill, write_all

    tasks = build_tasks(trade_dates, file_date_for_trade_date)  # see below
    results = run_parallel_backfill(tasks, max_workers=8)
    write_all(results, trade_dates)
"""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Optional

import pandas as pd
import duckdb

from api.db import get_conn

LEGACY_CUTOFF = "2024-06-24"

def _is_legacy(trade_date: str) -> bool:
    return trade_date < LEGACY_CUTOFF

# ── compute functions: one per processor, pure — safe in worker processes ──
# Each mirrors the real process() body with all conn.execute/upsert calls
# removed. Nothing here is a rewrite of formatting/business logic — it's the
# exact same code the sequential processor already runs, just returning data
# instead of writing it.

def _compute_fo_contracts(file_date: str, trade_date: str) -> dict:
    from pipeline.processors import fo_contracts as m
    from api.db import is_processed

    if is_processed(trade_date, "FO_CONTRACT"):
        return {"skipped": True}

    raw = m._load(file_date)
    raw, instr, dropped = m._build_instruments(raw)

    if raw.empty:
        return {
            "skipped": False,
            "empty": True,
            "instruments": pd.DataFrame(),
            "contract_daily": pd.DataFrame(),
            "corp_actions": pd.DataFrame(),
            "dropped": dropped,
        }

    contract_daily = m._build_contract_daily(raw, file_date, trade_date)
    corp_actions = m._build_corp_actions(raw)
    return {
        "skipped": False,
        "empty": False,
        "instruments": instr,
        "contract_daily": contract_daily,
        "corp_actions": corp_actions,
        "dropped": dropped,
    }


def _compute_cm_security(file_date: str, trade_date: str) -> dict:
    from pipeline.processors import cm_securities as m
    from api.db import is_processed

    if is_processed(trade_date, "CM_SECURITY"):
        return {"skipped": True}

    raw = m._load(file_date)
    raw, instr = m._build_instruments(raw)
    sec_master = m._build_security_master(raw, file_date, trade_date)
    corp_actions = m._build_corp_actions(raw)
    return {
        "skipped": False,
        "instruments": instr,
        "sec_master": sec_master,
        "corp_actions": corp_actions,
    }


def _compute_fo(trade_date: str, reference: Optional[dict] = None) -> dict:
    from api.db import is_processed

    if is_processed(trade_date, "STF") and is_processed(trade_date, "STO"):
        return {"skipped": True}

    if _is_legacy(trade_date):
        from pipeline.processors import fo_legacy as m
        result = m.compute(trade_date, reference)
    else:
        from pipeline.processors import fo as m
        result = m.compute(trade_date)

    result["skipped"] = False
    result["_legacy"] = _is_legacy(trade_date)
    return result


def _compute_cm_bhav(trade_date: str) -> dict:
    from api.db import is_processed

    if is_processed(trade_date, "cm_bhav"):
        return {"skipped": True}

    if _is_legacy(trade_date):
        result = _compute_cm_bhav_legacy(trade_date)
    else:
        result = _compute_cm_bhav_new(trade_date)

    result["skipped"] = False
    result["_legacy"] = _is_legacy(trade_date)
    return result


def _compute_cm_bhav_new(trade_date: str) -> dict:
    from pipeline.processors import cm_bhav as m
    from pipeline.processors.keys import make_instrument_key

    p = m._raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()

    trade_dt = pd.to_datetime(df["TradDt"].iloc[0], format="%Y-%m-%d", errors="coerce").date()

    df["series_"] = df["SctySrs"].fillna("").str.strip()
    df["itype"] = df["FinInstrmTp"].fillna("STK").str.strip()

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["itype"], r["TckrSymb"].strip(), None, None, None, r["series_"]
    ), axis=1)

    instr = pd.DataFrame({
        "instrument_key":   df["instrument_key"],
        "exchange":         "NSE",
        "segment":          "CM",
        "instrument_id":    pd.to_numeric(df["FinInstrmId"], errors="coerce").astype("Int64"),
        "instrument_type":  df["itype"],
        "ticker":           df["TckrSymb"].str.strip(),
        "instrument_name":  df["FinInstrmNm"].str.strip(),
        "isin":             df["ISIN"].str.strip(),
        "series":           df["series_"],
        "expiry":           None,
        "strike":           None,
        "option_type":      None,
    }).drop_duplicates("instrument_key")

    mdd = pd.DataFrame({
        "trade_date":       trade_dt,
        "instrument_key":   df["instrument_key"],
        "open":             pd.to_numeric(df["OpnPric"],        errors="coerce"),
        "high":             pd.to_numeric(df["HghPric"],        errors="coerce"),
        "low":              pd.to_numeric(df["LwPric"],         errors="coerce"),
        "close":            pd.to_numeric(df["ClsPric"],        errors="coerce"),
        "last":             pd.to_numeric(df["LastPric"],       errors="coerce"),
        "prev_close":       pd.to_numeric(df["PrvsClsgPric"],   errors="coerce"),
        "avg_price":        None,
        "volume":           pd.to_numeric(df["TtlTradgVol"],    errors="coerce").astype("Int64"),
        "turnover":         pd.to_numeric(df["TtlTrfVal"],      errors="coerce"),
        "trade_count":      pd.to_numeric(df["TtlNbOfTxsExctd"], errors="coerce").astype("Int64"),
        "open_interest":    pd.to_numeric(df["OpnIntrst"],      errors="coerce").astype("Int64"),
        "change_in_oi":     pd.to_numeric(df["ChngInOpnIntrst"], errors="coerce").astype("Int64"),
        "settlement_price": pd.to_numeric(df["SttlmPric"],      errors="coerce"),
        "underlying_price": pd.to_numeric(df["UndrlygPric"],    errors="coerce"),
        "delivery_qty":     None,
        "delivery_pct":     None,
    })

    return {"skipped": False, "instruments": instr, "market_data": mdd, "row_count": len(df)}


def _compute_cm_bhav_legacy(trade_date: str) -> dict:
    """Mirrors cm_bhav_legacy.process()'s parsing exactly, minus the DB
    connection/transaction — pure, safe for a worker process."""
    from pipeline.processors import cm_bhav_legacy as m
    from pipeline.processors.keys import make_instrument_key

    p = m._raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()

    trade_dt = pd.to_datetime(df["TIMESTAMP"].iloc[0], format="%d-%b-%Y", errors="coerce").date()

    df["series_"] = df["SERIES"].fillna("").str.strip()
    df["itype"] = "STK"

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["itype"], r["SYMBOL"].strip(), None, None, None, r["series_"]
    ), axis=1)

    instr = pd.DataFrame({
        "instrument_key":   df["instrument_key"],
        "exchange":         "NSE",
        "segment":          "CM",
        "instrument_id":    pd.array([pd.NA] * len(df), dtype="Int64"),
        "instrument_type":  df["itype"],
        "ticker":           df["SYMBOL"].str.strip(),
        "instrument_name":  None,
        "isin":             df["ISIN"].str.strip(),
        "series":           df["series_"],
        "expiry":           None,
        "strike":           None,
        "option_type":      None,
    }).drop_duplicates("instrument_key")

    mdd = pd.DataFrame({
        "trade_date":       trade_dt,
        "instrument_key":   df["instrument_key"],
        "open":             pd.to_numeric(df["OPEN"],       errors="coerce"),
        "high":             pd.to_numeric(df["HIGH"],       errors="coerce"),
        "low":              pd.to_numeric(df["LOW"],        errors="coerce"),
        "close":            pd.to_numeric(df["CLOSE"],      errors="coerce"),
        "last":             pd.to_numeric(df["LAST"],       errors="coerce"),
        "prev_close":       pd.to_numeric(df["PREVCLOSE"],  errors="coerce"),
        "avg_price":        None,
        "volume":           pd.to_numeric(df["TOTTRDQTY"],  errors="coerce").astype("Int64"),
        "turnover":         pd.to_numeric(df["TOTTRDVAL"],  errors="coerce"),
        "trade_count":      pd.to_numeric(df["TOTALTRADES"], errors="coerce").astype("Int64"),
        "open_interest":    None,
        "change_in_oi":     None,
        "settlement_price": None,
        "underlying_price": None,
        "delivery_qty":     None,
        "delivery_pct":     None,
    })

    return {"skipped": False, "instruments": instr, "market_data": mdd, "row_count": len(df)}


def _compute_eq_bhav(trade_date: str) -> dict:
    from pipeline.processors import eq_bhav as m
    from pipeline.processors.keys import make_instrument_key
    from api.db import is_processed

    if is_processed(trade_date, "eq_bhav"):
        return {"skipped": True}

    p = m._raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()

    trade_dt = pd.to_datetime(df["DATE1"].iloc[0], dayfirst=True).date()

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        "STK", r["SYMBOL"].strip(), None, None, None, r["SERIES"].strip()
    ), axis=1)

    deliv = pd.DataFrame({
        "trade_date":     trade_dt,
        "instrument_key": df["instrument_key"],
        "avg_price":      pd.to_numeric(df["AVG_PRICE"], errors="coerce"),
        "delivery_qty":   pd.to_numeric(df["DELIV_QTY"], errors="coerce").astype("Int64"),
        "delivery_pct":   pd.to_numeric(df["DELIV_PER"], errors="coerce"),
    }).drop_duplicates("instrument_key")

    return {"skipped": False, "delivery": deliv}


def _compute_fii(trade_date: str) -> dict:
    from pipeline.processors import fii as m
    from api.db import is_processed

    if is_processed(trade_date, "fii"):
        return {"skipped": True}

    p = m._raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = m._parse(p, trade_date)
    return {"skipped": False, "fii": df}


def _compute_participant(trade_date: str) -> dict:
    from pipeline.processors import participant as m
    from config import PART_OI_ROOT, PART_VOL_ROOT
    from api.db import is_processed

    oi_done = is_processed(trade_date, "part_oi")
    vol_done = is_processed(trade_date, "part_vol")
    if oi_done and vol_done:
        return {"skipped": True}

    frames = []
    if not oi_done:
        p = m._raw_path(PART_OI_ROOT, trade_date)
        if not p.exists():
            raise FileNotFoundError(p)
        frames.append(m._parse_file(p, trade_date, "OI"))

    if not vol_done:
        p = m._raw_path(PART_VOL_ROOT, trade_date)
        if not p.exists():
            raise FileNotFoundError(p)
        frames.append(m._parse_file(p, trade_date, "VOL"))

    df = pd.concat(frames, ignore_index=True)
    return {"skipped": False, "participant": df}


def _compute_fo_volt(trade_date: str) -> dict:
    from pipeline.processors import fo_volt as m
    from api.db import is_processed

    if is_processed(trade_date, "fo_volt"):
        return {"skipped": True}

    p = m._raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    df = m._parse(p, trade_date)
    return {"skipped": False, "fo_volt": df}


def _compute_mkt_act(trade_date: str) -> dict:
    from pipeline.processors import mkt_act as m
    from api.db import is_processed

    if is_processed(trade_date, "mkt_act"):
        return {"skipped": True}

    p = m._raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)

    parsed = m._parse(p, trade_date)
    return {"skipped": False, "mkt_act": parsed}


# ── dispatch table for the compute pool ─────────────────────────────────────

_COMPUTE = {
    "fo_contracts": _compute_fo_contracts,   # takes (file_date, trade_date)
    "cm_security":  _compute_cm_security,    # takes (file_date, trade_date)
    "fo":           _compute_fo,
    "cm_bhav":      _compute_cm_bhav,
    "eq_bhav":      _compute_eq_bhav,
    "fii":          _compute_fii,
    "participant":  _compute_participant,
    "fo_volt":      _compute_fo_volt,
    "mkt_act":      _compute_mkt_act,
}

# master processors need file_date; everything else keys off trade_date only
_MASTER_PROCS = {"fo_contracts", "cm_security"}

_WRITE_ORDER = [
    "fo_contracts", "cm_security",
    "cm_bhav", "eq_bhav", "mkt_act",
    "fo", "fii", "participant", "fo_volt",
]


def build_tasks(trade_dates: list[str], file_date_for_trade_date: dict[str, str]) -> list[dict]:
    """
    Convenience builder. `file_date_for_trade_date` maps trade_date -> the
    publication file_date to use for the master processors (fo_contracts,
    cm_security) on that trade_date — i.e. the reverse of the manifest
    lookup startup_sync.py already does via get_next_confirmed_trading_date.
    """
    tasks = []
    for d in trade_dates:
        for proc in _WRITE_ORDER:
            task = {"proc": proc, "trade_date": d}
            if proc in _MASTER_PROCS:
                fd = file_date_for_trade_date.get(d)
                if fd is None:
                    continue  # no known publication file for this trade_date
                task["file_date"] = fd
            tasks.append(task)
    return tasks


# ── worker entry point ───────────────────────────────────────────────────────

def _run_one(task: dict) -> dict:
    key = task["proc"]
    fn = _COMPUTE[key]
    try:
        if key in _MASTER_PROCS:
            result = fn(task["file_date"], task["trade_date"])
        elif key == "fo":
            result = fn(task["trade_date"], task.get("reference"))
        else:
            result = fn(task["trade_date"])
        return {"ok": True, "proc": key, "trade_date": task["trade_date"], "result": result}
    except (FileNotFoundError, RuntimeError) as e:
        # genuine data-condition errors — missing file, unresolvable
        # reference price. Safe to retry / eventually mark FAILED.
        return {"ok": False, "proc": key, "trade_date": task["trade_date"], "error": f"{type(e).__name__}: {e}"}
    # anything else (TypeError, KeyError, AttributeError, ImportError, ...)
    # is a code bug, not a data problem — let it propagate. It will surface
    # via fut.result() in run_parallel_backfill and stop the run, same as
    # the downloader's DOWNLOAD CRASH behavior. Do not retry, do not mark
    # FAILED — that would hide the bug and, worse, get treated as
    # "resolved" by the legacy-fo dependency gate downstream.


def run_parallel_backfill(tasks: list[dict], max_workers: int = 8) -> dict:
    legacy_fo_tasks = [t for t in tasks if t["proc"] == "fo" and _is_legacy(t["trade_date"])]
    if legacy_fo_tasks:
        from pipeline.processors import fo_legacy as m
        date_inputs = {}
        for t in legacy_fo_tasks:
            try:
                raw = m._load(t["trade_date"])
                raw.columns = raw.columns.str.strip()
                tickers = m._tickers_by_type(raw)
                fut_raw = raw[raw["INSTRUMENT"].isin(m._LEGACY_FUT)].copy()
                _, fut_instr = m._build_instruments(fut_raw)
                date_inputs[t["trade_date"]] = (fut_instr, tickers)
            except FileNotFoundError:
                continue  # let _run_one's own _load() surface this as usual

        if date_inputs:
            conn = get_conn()
            try:
                reference_by_date = m.fetch_reference_data_batch(conn, date_inputs)
            finally:
                conn.close()
            for t in legacy_fo_tasks:
                if t["trade_date"] in reference_by_date:
                    t["reference"] = reference_by_date[t["trade_date"]]

    results = {}
    with ProcessPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_run_one, t): t for t in tasks}
        for fut in as_completed(futures):
            r = fut.result()  # non-data exceptions raise here and abort the run
            results[(r["trade_date"], r["proc"])] = r
            status = "✓" if r["ok"] else f"✗ {r['error']}"
            print(f"[compute] {r['proc']} {r['trade_date']} {status}")
    return results

# ── writer: strictly sequential, one long-lived connection ─────────────────

def _write_fo_contracts(conn, data: dict, d: str):
    from pipeline.processors import fo_contracts as m
    from pipeline.processors.common import upsert_instruments

    if data.get("skipped") or data.get("empty"):
        return
    if not data["instruments"].empty:
        upsert_instruments(conn, data["instruments"])
    m._upsert_contract_daily(conn, data["contract_daily"])
    m._upsert_corp_actions(conn, data["corp_actions"])
    print(f"[write] fo_contracts {d} — {len(data['contract_daily'])} contract rows, "
          f"{len(data['corp_actions'])} corp actions, {data['dropped']} invalid rows dropped")


def _write_cm_security(conn, data: dict, d: str):
    from pipeline.processors import cm_securities as m
    from pipeline.processors.common import upsert_instruments

    if data.get("skipped"):
        return
    upsert_instruments(conn, data["instruments"])
    m._upsert_security_master(conn, data["sec_master"])
    m._upsert_corp_actions(conn, data["corp_actions"])
    print(f"[write] cm_security {d} — {len(data['sec_master'])} security rows, "
          f"{len(data['corp_actions'])} corp actions")

# ── vectorized futures/options writers (parallel path only) ────────────────
# fo.py / fo_legacy.py still use conn.executemany() for their sequential
# process() path — untouched, unchanged. These are separate implementations
# used only by write_all() below, targeting the same tables with the same
# ON CONFLICT logic, just via register()+INSERT instead of executemany().

_FUTURES_COLS = [
    "instrument_type", "ticker", "expiry", "trade_date",
    "underlying_price",
    "chng_in_price", "chng_price_per", "chng_oi_per",
    "quadrant", "basis", "cost_of_carry", "choi_volume_ratio", "days_to_expiry",
]

def _write_futures_rows_batched(conn, rows: list[tuple]):
    if not rows:
        return
    df = pd.DataFrame(rows, columns=_FUTURES_COLS)
    conn.register("_futures_stage", df)
    try:
        conn.execute("""
            INSERT INTO futures_analytics (
                instrument_type, ticker, expiry, trade_date,
                underlying_price,
                chng_in_price, chng_price_per, chng_oi_per,
                quadrant, basis, cost_of_carry, choi_volume_ratio, days_to_expiry
            )
            SELECT
                instrument_type, ticker, expiry, trade_date,
                underlying_price,
                chng_in_price, chng_price_per, chng_oi_per,
                quadrant, basis, cost_of_carry, choi_volume_ratio, days_to_expiry
            FROM _futures_stage
            ON CONFLICT (instrument_type, ticker, expiry, trade_date) DO UPDATE SET
                underlying_price   = excluded.underlying_price,
                chng_in_price      = excluded.chng_in_price,
                chng_price_per     = excluded.chng_price_per,
                chng_oi_per        = excluded.chng_oi_per,
                quadrant           = excluded.quadrant,
                basis              = excluded.basis,
                cost_of_carry      = excluded.cost_of_carry,
                choi_volume_ratio  = excluded.choi_volume_ratio,
                days_to_expiry     = excluded.days_to_expiry
        """)
    finally:
        conn.unregister("_futures_stage")


_OPTIONS_COLS = [
    "instrument_type", "ticker", "expiry", "trade_date",
    "underlying_price",
    "pe_oi", "ce_oi", "pcr", "max_pain",
]


def _write_options_rows_batched(conn, rows: list[tuple]):
    if not rows:
        return
    df = pd.DataFrame(rows, columns=_OPTIONS_COLS)
    conn.register("_options_stage", df)
    try:
        conn.execute("""
            INSERT INTO options_analytics (
                instrument_type, ticker, expiry, trade_date,
                underlying_price,
                pe_oi, ce_oi, pcr, max_pain
            )
            SELECT
                instrument_type, ticker, expiry, trade_date,
                underlying_price,
                pe_oi, ce_oi, pcr, max_pain
            FROM _options_stage
            ON CONFLICT (instrument_type, ticker, expiry, trade_date) DO UPDATE SET
                underlying_price   = excluded.underlying_price,
                pe_oi              = excluded.pe_oi,
                ce_oi              = excluded.ce_oi,
                pcr                = excluded.pcr,
                max_pain           = excluded.max_pain
        """)
    finally:
        conn.unregister("_options_stage")


def _write_fo(conn, data: dict, d: str):
    from pipeline.processors.common import upsert_instruments, upsert_market_data

    if data.get("skipped"):
        return

    if not data["instruments"].empty:
        upsert_instruments(conn, data["instruments"])
    if not data["market_data"].empty:
        upsert_market_data(conn, data["market_data"])

    _write_futures_rows_batched(conn, data["futures_rows"])
    _write_options_rows_batched(conn, data["options_rows"])

    print(f"[write] fo {d} — {data['fut_row_count']} fut rows, {data['opt_row_count']} opt rows "
          f"({'legacy' if data.get('_legacy') else 'standard'})")


def _write_cm_bhav(conn, data: dict, d: str):
    from pipeline.processors.common import upsert_instruments, upsert_market_data

    if data.get("skipped"):
        return
    upsert_instruments(conn, data["instruments"])
    upsert_market_data(conn, data["market_data"])
    print(f"[write] cm_bhav {d} — {data['row_count']} rows "
          f"({'legacy' if data.get('_legacy') else 'standard'})")


def _write_eq_bhav(conn, data: dict, d: str):
    from pipeline.processors.common import upsert_delivery_stats

    if data.get("skipped"):
        return
    upsert_delivery_stats(conn, data["delivery"])
    print(f"[write] eq_bhav {d} — {len(data['delivery'])} delivery rows patched")


def _write_fii(conn, data: dict, d: str):
    if data.get("skipped"):
        return
    df = data["fii"]
    if df.empty:
        print(f"[write] fii {d} — no rows parsed")
        return
    conn.register("_fii_stage", df)
    conn.execute("""
        INSERT INTO fii_stats
        SELECT
            TRY_CAST(trade_date AS DATE),
            instrument,
            buy_contracts, buy_amount_cr,
            sell_contracts, sell_amount_cr,
            oi_contracts, oi_amount_cr
        FROM _fii_stage
        ON CONFLICT (trade_date, instrument) DO UPDATE SET
            buy_contracts  = excluded.buy_contracts,
            buy_amount_cr  = excluded.buy_amount_cr,
            sell_contracts = excluded.sell_contracts,
            sell_amount_cr = excluded.sell_amount_cr,
            oi_contracts   = excluded.oi_contracts,
            oi_amount_cr   = excluded.oi_amount_cr
    """)
    conn.unregister("_fii_stage")
    print(f"[write] fii {d} — {len(df)} rows")


def _write_participant(conn, data: dict, d: str):
    if data.get("skipped"):
        return
    df = data["participant"]
    if df.empty:
        print(f"[write] participant {d} — no rows parsed")
        return
    conn.register("_part_stage", df)
    conn.execute("""
        INSERT INTO participant_activity
        SELECT
            TRY_CAST(trade_date AS DATE),
            participant_type, metric_type, asset_class,
            direction, option_side,
            contracts
        FROM _part_stage
        ON CONFLICT (trade_date, participant_type, metric_type, asset_class, direction, option_side)
        DO UPDATE SET contracts = excluded.contracts
    """)
    conn.unregister("_part_stage")
    print(f"[write] participant {d} — {len(df)} rows")


def _write_fo_volt(conn, data: dict, d: str):
    from pipeline.processors.fo_volt import _DB_COLS

    if data.get("skipped"):
        return
    df = data["fo_volt"]
    if df.empty:
        print(f"[write] fo_volt {d} — no rows parsed")
        return
    conn.register("_fovolt_stage", df)
    conn.execute(f"""
        INSERT INTO fo_volatility ({", ".join(_DB_COLS)})
        SELECT {", ".join(_DB_COLS)}
        FROM _fovolt_stage
        ON CONFLICT (trade_date, ticker) DO UPDATE SET
            underlying_log_return  = excluded.underlying_log_return,
            underlying_daily_vol   = excluded.underlying_daily_vol,
            underlying_annual_vol  = excluded.underlying_annual_vol,

            futures_log_return     = excluded.futures_log_return,
            futures_daily_vol      = excluded.futures_daily_vol,
            futures_annual_vol     = excluded.futures_annual_vol,

            applicable_daily_vol   = excluded.applicable_daily_vol,
            applicable_annual_vol  = excluded.applicable_annual_vol
    """)
    conn.unregister("_fovolt_stage")
    print(f"[write] fo_volt {d} — {len(df)} rows inserted/updated")


def _write_mkt_act(conn, data: dict, d: str):
    from pipeline.processors import mkt_act as m

    if data.get("skipped"):
        return
    m._write(conn, data["mkt_act"], d)
    parsed = data["mkt_act"]
    print(
        f"[write] mkt_act {d} — summary OK | "
        f"{len(parsed['index_rows'])} index rows | breadth OK "
        f"(A={parsed['breadth']['advances']} D={parsed['breadth']['declines']} "
        f"U={parsed['breadth']['unchanged']} PB={parsed['breadth']['price_band_hits']})"
    )


_WRITERS = {
    "fo_contracts": _write_fo_contracts,
    "cm_security":  _write_cm_security,
    "fo":           _write_fo,
    "cm_bhav":      _write_cm_bhav,
    "eq_bhav":      _write_eq_bhav,
    "fii":          _write_fii,
    "participant":  _write_participant,
    "fo_volt":      _write_fo_volt,
    "mkt_act":      _write_mkt_act,
}


def write_all(results: dict, trade_dates: list[str]) -> None:
    """
    Single sequential pass: dates in increasing order, and within each date,
    masters (fo_contracts, cm_security) before fo/cm_bhav before eq_bhav
    before the independent daily-stat processors. One connection, one
    transaction per (date, proc) — a failure on one task rolls back just
    that task and moves on, it doesn't abort the whole backfill.
    """
    from api.db import get_conn

    conn = get_conn()
    try:
        for d in sorted(trade_dates):
            for proc in _WRITE_ORDER:
                r = results.get((d, proc))
                if r is None:
                    continue  # no task was scheduled for this (date, proc)
                if not r["ok"]:
                    print(f"[write] {proc} {d} SKIPPED — compute failed: {r['error']}")
                    continue

                writer = _WRITERS[proc]
                conn.execute("BEGIN")
                try:
                    writer(conn, r["result"], d)
                    conn.execute("COMMIT")
                except Exception as e:
                    conn.execute("ROLLBACK")
                    # record the failure back onto the result so callers
                    # (e.g. parallel_startup_sync) can tell write failures
                    # apart from compute failures / successes.
                    r["ok"] = False
                    r["error"] = f"write failed: {e!r}"
                    print(f"[write] {proc} {d} FAILED: {e!r}")
    finally:
        conn.close()
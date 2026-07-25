"""
FO legacy bhavcopy processor
→ instruments, market_data_daily, options_analytics, futures_analytics

Handles the old pre-CSV-relaunch NSE F&O bhavcopy format (columns like
INSTRUMENT/SYMBOL/EXPIRY_DT/STRIKE_PR/OPTION_TYP/...), which predates the
FinInstrmTp/TckrSymb/XpryDt-style format handled by fo_bhavcopy.py.

Two format differences drive most of this file's logic:

1. Instrument-type codes differ: legacy uses FUTIDX/FUTSTK/OPTIDX/OPTSTK
   instead of STF/IDF/STO/IDO. These are mapped 1:1 onto the *same*
   STF/IDF/STO/IDO namespace used everywhere else (instruments.instrument_type,
   futures_analytics/options_analytics keys, is_processed() checks).

2. Legacy uses sentinel placeholders instead of blanks for non-applicable
   fields on futures rows: STRIKE_PR=0 and OPTION_TYP='XX'. Normalized to
   NaN/None for FUT instrument types before key generation, matching the
   blank convention fo_bhavcopy.py / fo_contracts.py rely on.

Date fields (EXPIRY_DT, TIMESTAMP) ship as e.g. "26-Jun-2024" — 4-digit year.
Use "%d-%b-%Y", never "%y". duckdb's TRY_CAST(... AS DATE) does not
understand this format and silently returns NULL — use strptime() in SQL.

── Reference-data enrichment (underlying price + prior close) ───────────────
The legacy file itself is missing UndrlygPric and PrvsClsgPric entirely.
Both are filled in from data already sitting in the DB, fetched by
`fetch_reference_data()` on a REAL connection, on the MAIN process, before
`compute()` runs — `compute()` itself stays pure/picklable for the
ProcessPoolExecutor backfill path, so no DB access happens inside it.

  - underlying_price:
      IDF/IDO -> market_activity_index.close, keyed by NSE's display name
                 (see _INDEX_NAME_MAP — ticker strings don't match index_name
                 strings, this isn't a hash/join, it's an explicit table).
      STF/STO -> market_data_daily.close for the underlying equity
                 (instrument_key computed via make_instrument_key('STK',
                 ticker, None, None, None, 'EQ') — mirrors cm_bhav.py).
    In both cases: try the exact trade_date first, then fall back to the
    nearest EXISTING prior date (`trade_date < ? ORDER BY trade_date DESC
    LIMIT 1`). Never assume trade_date - 1 — NSE holidays make that wrong.

  - prior_close (of the FUT/OPT contract itself, for chng_in_price):
      market_data_daily.close for that exact instrument_key, nearest
      existing date strictly before trade_date. Same reasoning — no blind
      offset.

Anything that still can't be resolved (unmapped index, or genuinely no
earlier row) raises — this file is meant to surface data gaps, not hide
them behind NULL.

── Fields still always NULL in this format (documented, not oversights) ─────
instrument_id, isin, series, last, trade_count, delivery_qty, delivery_pct,
avg_price: not present in the legacy file at all, no reference table covers
them either.
choi_volume_ratio: needs actual_volume = volume * lot_size; legacy has no
lot size column, and instrument_contract_daily has no legacy-era rows to
fall back on for most historical dates. Looked up best-effort (nearest
prior instrument_contract_daily row for the same instrument_key); logged,
not raised, when unavailable — unlike underlying_price this is expected to
be missing for large stretches of legacy history and shouldn't hard-fail a
whole day's load over it.

turnover: legacy reports VAL_INLAKH (value in lakhs), scaled by 1e5 to line
up with TtlTrfVal.

── Compute/write split ──────────────────────────────────────────────────────
`process(trade_date)` — sequential, startup_sync path. Does reference-data
fetch (real connection) + compute (pure) + write (real connection), one
transaction.
`compute(trade_date, reference)` — pure pandas/numpy/in-memory-duckdb, safe
for a ProcessPoolExecutor worker. Takes a pre-fetched `reference` dict
instead of touching the DB itself.
`write(conn, result, trade_date)` — persists a compute() result.
For parallel backfill: call `fetch_reference_data()` per date on the main
process first (cheap, real connection), then dispatch `compute(trade_date,
reference)` to workers, then `write()` sequentially on the writer connection.

futures_analytics/options_analytics table writers are imported from
fo_bhavcopy.py — target tables/SQL/conflict-resolution are identical, only
the compute side differs.
"""

import numpy as np
import pandas as pd
import duckdb
from pathlib import Path
import yfinance as yf

from config import FO_LEGACY_RAW_ROOT, NSE_DB_PATH
from api.db import get_conn, is_processed
from .keys import make_instrument_key
from .common import upsert_instruments, upsert_market_data
from .fo import (
    _QUADRANT,
    _write_futures_rows,
    _write_options_rows,
)


_LEGACY_FUT = {"FUTIDX", "FUTSTK"}
_LEGACY_OPT = {"OPTIDX", "OPTSTK"}

_LEGACY_TYPE_MAP = {
    "FUTIDX": "IDF",
    "FUTSTK": "STF",
    "OPTIDX": "IDO",
    "OPTSTK": "STO",
}

_LEGACY_DATE_FMT = "%d-%b-%Y"

# F&O index ticker -> market_activity_index.index_name, as written by mkt_act.py from NSE's MA*.csv (column-1 display names, not tickers).
_INDEX_NAME_MAP = {
    "NIFTY": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "FINNIFTY": "NIFTY FIN SERVICE",
    "MIDCPNIFTY": "NIFTY MID SELECT",
    "NIFTYIT": "NIFTY IT",
    "NIFTYINFRA": "NIFTY INFRA",
    "NIFTYPSE": "NIFTY PSE",
    "NIFTYCPSE": "NIFTY CPSE",
    "NIFTYNXT50": "NIFTY NEXT 50",
    "NIFTYMID50": "NIFTY MIDCAP 50",
}
# NSE F&O index ticker -> Yahoo Finance ticker, for foreign indices that never appear in NSE's own market_activity_index (MA*.csv).
# Both US indices settle ~01:30 IST and FTSE settles ~20:30 IST — i.e. AFTER NSE's 15:30 IST close, for the same calendar trade_date.
# So we always want the PRIOR completed session's close, never same-day — same-day data literally doesn't exist yet at NSE-close time.
# This is why the lookup below is strict_before=True unconditionally, unlike the DB-backed indices which try exact-date first.
_YF_INDEX_MAP = {
    "S&P500": "^GSPC",
    "DJIA": "^DJI",
    "FTSE100": "^FTSE",
}

_UNMAPPED_INDICES = set()


# ══════════════════════════════════════════════════════════════════════════
# Reference-data fetch — REAL connection, MAIN process only. Never called
# from inside compute() or a worker.
# ══════════════════════════════════════════════════════════════════════════

def _nearest_on_or_before(conn, table: str, key_col: str, key_val, date_col: str,
                           value_col: str, trade_date: str, strict_before: bool = False):
    """
    Generic "give me the most recent value on/before trade_date" lookup.
    strict_before=True excludes trade_date itself (used for prior_close,
    where we explicitly want a DIFFERENT day's close).
    """
    op = "<" if strict_before else "<="
    row = conn.execute(f"""
        SELECT {value_col} FROM {table}
        WHERE {key_col} = ? AND {date_col} {op} ?
        ORDER BY {date_col} DESC LIMIT 1
    """, [key_val, trade_date]).fetchone()
    return row[0] if row else None


def fetch_reference_data(conn, trade_date: str, fut_instr: pd.DataFrame,
                          tickers: dict) -> dict:
    """
    Builds everything compute() needs but can't derive from the legacy file:
      - underlying: {(instrument_type, ticker): price}
      - prior_close: {instrument_key: close}   (futures contracts only)
      - lot_size: {instrument_key: lot}         (best-effort, may be sparse)

    `tickers` = {"IDF": {...}, "IDO": {...}, "STF": {...}, "STO": {...}} —
    the tickers actually present in today's file, so we only look up what's
    needed and can tell a real gap apart from "wasn't asked for".
    `fut_instr` = the futures instrument rows from _build_instruments(),
    used to resolve prior_close per instrument_key.
    """
    underlying = {}
    missing = []

    # ── underlying: indices ──────────────────────────────────────────────
    idx_tickers = tickers.get("IDF", set()) | tickers.get("IDO", set())
    if idx_tickers:
        idx_today = dict(conn.execute(
            "SELECT index_name, close FROM market_activity_index WHERE trade_date = ?",
            [trade_date],
        ).fetchall())

        for ticker in idx_tickers:
            if ticker in _UNMAPPED_INDICES:
                continue

            if ticker in _YF_INDEX_MAP:
                price = _yf_nearest_close_before(_YF_INDEX_MAP[ticker], trade_date)
                if price is None:
                    missing.append(f"IDF/IDO:{ticker} (yfinance {_YF_INDEX_MAP[ticker]}, no close before {trade_date})")
                    continue
                underlying[("IDF", ticker)] = price
                underlying[("IDO", ticker)] = price
                continue

            name = _INDEX_NAME_MAP.get(ticker)
            if name is None:
                missing.append(f"IDF/IDO:{ticker} (no entry in _INDEX_NAME_MAP)")
                continue
            price = idx_today.get(name)
            if price is None:
                price = _nearest_on_or_before(
                    conn, "market_activity_index", "index_name", name,
                    "trade_date", "close", trade_date, strict_before=True,
                )
            if price is None:
                missing.append(f"IDF/IDO:{ticker} (mapped to '{name}', no row on or before {trade_date})")
                continue
            underlying[("IDF", ticker)] = price
            underlying[("IDO", ticker)] = price

    # ── underlying: stocks ────────────────────────────────────────────────
    stk_tickers = tickers.get("STF", set()) | tickers.get("STO", set())
    if stk_tickers:
        for ticker in stk_tickers:
            key = make_instrument_key("STK", ticker, None, None, None, "EQ")
            price = _nearest_on_or_before(
                conn, "market_data_daily", "instrument_key", key,
                "trade_date", "close", trade_date, strict_before=False,
            )
            if price is None:
                missing.append(f"STF/STO:{ticker} (key={key}, no CM row on or before {trade_date})")
                continue
            underlying[("STF", ticker)] = price
            underlying[("STO", ticker)] = price

    if missing:
        raise RuntimeError(
            f"[fo_legacy] {trade_date}: could not resolve underlying price for "
            f"{len(missing)} ticker(s):\n  " + "\n  ".join(missing)
        )

    # ── prior_close + lot_size per futures instrument_key ────────────────
    prior_close = {}
    lot_size = {}
    if not fut_instr.empty:
        for key in fut_instr["instrument_key"]:
            prior_close[key] = _nearest_on_or_before(
                conn, "market_data_daily", "instrument_key", key,
                "trade_date", "close", trade_date, strict_before=True,
            )
            lot_size[key] = _nearest_on_or_before(
                conn, "instrument_contract_daily", "instrument_key", key,
                "trade_date", "lot_size", trade_date, strict_before=False,
            )
            # lot_size intentionally NOT in `missing` / doesn't raise — see
            # module docstring. It's genuinely absent for most legacy dates.

    return {"underlying": underlying, "prior_close": prior_close, "lot_size": lot_size}


def fetch_reference_data_batch(conn, date_inputs: dict) -> dict:
    """
    Batched sibling of fetch_reference_data(), for the parallel backfill
    path only. Does NOT replace fetch_reference_data() — that stays as-is
    for the sequential startup_sync.process() path.

    date_inputs: {trade_date: (fut_instr, tickers)} for every legacy-fo
    date in the current round.

    Issues a small constant number of queries for the whole round instead
    of one query per ticker per date, then resolves "exact date, else
    nearest existing prior" per date in pandas. Returns
    {trade_date: reference_dict} — same shape fetch_reference_data()
    returns, so compute() doesn't care which path produced it.
    """
    if not date_inputs:
        return {}

    dates = sorted(date_inputs.keys())
    max_date = dates[-1]

    idx_tickers, stk_tickers, fut_keys = set(), set(), set()
    for trade_date, (fut_instr, tickers) in date_inputs.items():
        idx_tickers |= tickers.get("IDF", set()) | tickers.get("IDO", set())
        stk_tickers |= tickers.get("STF", set()) | tickers.get("STO", set())
        if not fut_instr.empty:
            fut_keys |= set(fut_instr["instrument_key"])

    yf_tickers_needed = sorted(t for t in idx_tickers if t in _YF_INDEX_MAP)
    yf_hist = _yf_history_batch(
        [_YF_INDEX_MAP[t] for t in yf_tickers_needed], dates[0], dates[-1],
    ) if yf_tickers_needed else {}

    idx_hist = pd.DataFrame(columns=["index_name", "trade_date", "close"])
    idx_names_needed = {
        t: _INDEX_NAME_MAP[t] for t in idx_tickers
        if t in _INDEX_NAME_MAP and t not in _YF_INDEX_MAP
    }
    if idx_names_needed:
        names = list(set(idx_names_needed.values()))
        idx_hist = conn.execute(f"""
            SELECT index_name, trade_date, close
            FROM market_activity_index
            WHERE index_name IN ({",".join("?" * len(names))})
              AND trade_date <= ?
            ORDER BY index_name, trade_date
        """, names + [max_date]).df()

    if not idx_hist.empty:
        idx_hist["trade_date"] = pd.to_datetime(idx_hist["trade_date"]).dt.date

    mdd_keys = {make_instrument_key("STK", t, None, None, None, "EQ") for t in stk_tickers}
    mdd_keys |= fut_keys

    mdd_hist = pd.DataFrame(columns=["instrument_key", "trade_date", "close"])
    if mdd_keys:
        keys = list(mdd_keys)
        mdd_hist = conn.execute(f"""
            SELECT instrument_key, trade_date, close
            FROM market_data_daily
            WHERE instrument_key IN ({",".join("?" * len(keys))})
              AND trade_date <= ?
            ORDER BY instrument_key, trade_date
        """, keys + [max_date]).df()

    if not mdd_hist.empty:
        mdd_hist["trade_date"] = pd.to_datetime(mdd_hist["trade_date"]).dt.date

    # lot_size best-effort — once legacy history runs past where
    # instrument_contract_daily has rows, this returns nothing for those
    # keys and lot_size stays None downstream, same as today.
    lot_hist = pd.DataFrame(columns=["instrument_key", "trade_date", "lot_size"])
    if fut_keys:
        keys = list(fut_keys)
        lot_hist = conn.execute(f"""
            SELECT instrument_key, trade_date, lot_size
            FROM instrument_contract_daily
            WHERE instrument_key IN ({",".join("?" * len(keys))})
              AND trade_date <= ?
            ORDER BY instrument_key, trade_date
        """, keys + [max_date]).df()

    if not lot_hist.empty:
        lot_hist["trade_date"] = pd.to_datetime(lot_hist["trade_date"]).dt.date

    def _nearest(hist_df, key_col, key_val, date_col, val_col, trade_date, strict_before):
        sub = hist_df[hist_df[key_col] == key_val]
        if sub.empty:
            return None
        cutoff = pd.to_datetime(trade_date).date()
        sub = sub[sub[date_col] < cutoff] if strict_before else sub[sub[date_col] <= cutoff]
        if sub.empty:
            return None
        return sub.iloc[-1][val_col]  # sorted ascending by date already

    def _yf_nearest(ticker_nse, trade_date):
        s = yf_hist.get(_YF_INDEX_MAP[ticker_nse])
        if s is None or s.empty:
            return None
        cutoff = pd.to_datetime(trade_date).date()
        s = s[s.index < cutoff]  # always strict — see _YF_INDEX_MAP docstring
        return float(s.iloc[-1]) if not s.empty else None

    out = {}
    for trade_date, (fut_instr, tickers) in date_inputs.items():
        underlying, missing = {}, []

        for ticker in (tickers.get("IDF", set()) | tickers.get("IDO", set())):
            if ticker in _UNMAPPED_INDICES:
                continue

            if ticker in _YF_INDEX_MAP:
                price = _yf_nearest(ticker, trade_date)
                if price is None:
                    missing.append(f"IDF/IDO:{ticker} (yfinance {_YF_INDEX_MAP[ticker]}, no close before {trade_date})")
                    continue
                underlying[("IDF", ticker)] = price
                underlying[("IDO", ticker)] = price
                continue

            name = _INDEX_NAME_MAP.get(ticker)
            if name is None:
                missing.append(f"IDF/IDO:{ticker} (no entry in _INDEX_NAME_MAP)")
                continue
            price = _nearest(idx_hist, "index_name", name, "trade_date", "close", trade_date, False)
            if price is None:
                missing.append(f"IDF/IDO:{ticker} (mapped to '{name}', no row on or before {trade_date})")
                continue
            underlying[("IDF", ticker)] = price
            underlying[("IDO", ticker)] = price

        for ticker in (tickers.get("STF", set()) | tickers.get("STO", set())):
            key = make_instrument_key("STK", ticker, None, None, None, "EQ")
            price = _nearest(mdd_hist, "instrument_key", key, "trade_date", "close", trade_date, False)
            if price is None:
                missing.append(f"STF/STO:{ticker} (key={key}, no CM row on or before {trade_date})")
                continue
            underlying[("STF", ticker)] = price
            underlying[("STO", ticker)] = price

        if missing:
            raise RuntimeError(
                f"[fo_legacy] {trade_date}: could not resolve underlying price for "
                f"{len(missing)} ticker(s):\n  " + "\n  ".join(missing)
            )

        prior_close, lot_size = {}, {}
        if not fut_instr.empty:
            for key in fut_instr["instrument_key"]:
                prior_close[key] = _nearest(mdd_hist, "instrument_key", key, "trade_date", "close", trade_date, True)
                lot_size[key] = _nearest(lot_hist, "instrument_key", key, "trade_date", "lot_size", trade_date, False)

        out[trade_date] = {"underlying": underlying, "prior_close": prior_close, "lot_size": lot_size}

    return out


def _yf_nearest_close_before(yf_ticker: str, trade_date: str, lookback_days: int = 10):
    """
    Nearest close strictly before trade_date for a Yahoo ticker. Always
    strict — see _YF_INDEX_MAP docstring: these indices settle after NSE's
    close for the same calendar day, so same-day data isn't real yet.
    Pulls a short trailing window (not just trade_date - 1) to ride out
    Yahoo holidays that don't line up with NSE's calendar.
    """
    cutoff = pd.to_datetime(trade_date).date()
    start = cutoff - pd.Timedelta(days=lookback_days)
    hist = yf.Ticker(yf_ticker).history(
        start=start.isoformat(), end=cutoff.isoformat(), interval="1d", auto_adjust=True,
    )
    if hist.empty:
        return None
    hist = hist[hist.index.date < cutoff]
    if hist.empty:
        return None
    return float(hist["Close"].iloc[-1])


def _yf_history_batch(yf_tickers: list[str], min_date: str, max_date: str, lookback_days: int = 15) -> dict:
    """
    One yfinance pull per ticker (not per date) covering the whole backfill
    round, mirroring idx_hist/mdd_hist. Returns {yf_ticker: pd.Series of
    close, indexed by date, sorted ascending}. Empty series (not missing
    key) if a ticker returns nothing — caller decides what that means.
    """
    start = (pd.to_datetime(min_date).date() - pd.Timedelta(days=lookback_days)).isoformat()
    end = (pd.to_datetime(max_date).date() + pd.Timedelta(days=1)).isoformat()  # yfinance end is exclusive

    out = {}
    if not yf_tickers:
        return out

    raw = yf.download(
        yf_tickers, start=start, end=end, interval="1d",
        group_by="ticker", auto_adjust=True, progress=False, threads=True,
    )

    for t in yf_tickers:
        try:
            if len(yf_tickers) == 1:
                # single ticker: yfinance may return flat columns instead of MultiIndex
                s = raw["Close"] if "Close" in raw.columns else raw[t]["Close"]
            else:
                s = raw[t]["Close"]
        except (KeyError, TypeError):
            out[t] = pd.Series(dtype="float64")
            continue
        s = s.dropna()
        s.index = pd.to_datetime(s.index).date
        out[t] = s.sort_index()

    return out


def _tickers_by_type(raw: pd.DataFrame) -> dict:
    out = {}
    for legacy_code, mapped in _LEGACY_TYPE_MAP.items():
        out[mapped] = set(
            raw.loc[raw["INSTRUMENT"] == legacy_code, "SYMBOL"].dropna().astype(str).str.strip()
        )
    return out


# ══════════════════════════════════════════════════════════════════════════
# Load / normalize (pure)
# ══════════════════════════════════════════════════════════════════════════

def _raw_path(trade_date: str) -> Path:
    dt = pd.to_datetime(trade_date)
    return Path(FO_LEGACY_RAW_ROOT) / dt.strftime("%Y") / dt.strftime("%m") / f"{trade_date}.csv"


def _load(trade_date: str) -> pd.DataFrame:
    p = _raw_path(trade_date)
    if not p.exists():
        raise FileNotFoundError(p)
    df = pd.read_csv(p, low_memory=False)
    df.columns = df.columns.str.strip()
    return df


def _drop_blank_rows(df: pd.DataFrame) -> pd.DataFrame:
    """Drops placeholder/stale rows — identified by blank SYMBOL."""
    df = df.copy()
    df["SYMBOL"] = df["SYMBOL"].astype("string").str.strip()
    mask = df["SYMBOL"].notna() & (df["SYMBOL"] != "")
    dropped = len(df) - mask.sum()
    if dropped:
        print(f"[fo_legacy] dropping {dropped} blank/placeholder rows")
    return df[mask].copy()


def _normalize_types(df: pd.DataFrame) -> pd.DataFrame:
    """Maps legacy INSTRUMENT codes onto STF/IDF/STO/IDO and clears the
    futures sentinel placeholders (STRIKE_PR=0, OPTION_TYP='XX') to NaN/None."""
    df = df.copy()
    df["INSTRUMENT"] = df["INSTRUMENT"].astype("string").str.strip()
    df["instrument_type"] = df["INSTRUMENT"].map(_LEGACY_TYPE_MAP)

    is_fut = df["INSTRUMENT"].isin(_LEGACY_FUT)
    df["STRIKE_PR"] = pd.to_numeric(df["STRIKE_PR"], errors="coerce")
    df.loc[is_fut, "STRIKE_PR"] = np.nan

    df["OPTION_TYP"] = df["OPTION_TYP"].astype("string").str.strip()
    df.loc[is_fut, "OPTION_TYP"] = pd.NA

    return df


def _build_instruments(df: pd.DataFrame):
    df = _drop_blank_rows(df)

    empty_instr_cols = [
        "instrument_key", "exchange", "segment", "instrument_id",
        "instrument_type", "ticker", "instrument_name",
        "isin", "series", "expiry", "strike", "option_type",
    ]
    if df.empty:
        return df, pd.DataFrame(columns=empty_instr_cols)

    df = _normalize_types(df)

    df["expiry_d"] = pd.to_datetime(
        df["EXPIRY_DT"], format=_LEGACY_DATE_FMT, errors="coerce"
    ).dt.date
    df["strike_f"] = df["STRIKE_PR"]

    df["instrument_key"] = df.apply(lambda r: make_instrument_key(
        r["instrument_type"], r["SYMBOL"],
        r["expiry_d"], r["strike_f"],
        r.get("OPTION_TYP"), None,
    ), axis=1)

    instr = df[[
        "instrument_key", "instrument_type",
        "SYMBOL", "expiry_d", "strike_f", "OPTION_TYP",
    ]].drop_duplicates("instrument_key").copy()

    instr.columns = [
        "instrument_key", "instrument_type",
        "ticker", "expiry", "strike", "option_type",
    ]
    instr.insert(1, "exchange", "NSE")
    instr.insert(2, "segment", "FO")
    instr["instrument_id"] = pd.array([pd.NA] * len(instr), dtype="Int64")
    instr["instrument_name"] = None
    instr["isin"] = None
    instr["series"] = None

    instr = instr[empty_instr_cols]
    return df, instr


def _build_market_data(df: pd.DataFrame, reference: dict) -> pd.DataFrame:
    d = pd.DataFrame()
    d["trade_date"]       = pd.to_datetime(df["TIMESTAMP"], format=_LEGACY_DATE_FMT, errors="coerce").dt.date
    d["instrument_key"]   = df["instrument_key"]
    d["open"]             = pd.to_numeric(df["OPEN"],  errors="coerce")
    d["high"]             = pd.to_numeric(df["HIGH"],  errors="coerce")
    d["low"]              = pd.to_numeric(df["LOW"],   errors="coerce")
    d["close"]            = pd.to_numeric(df["CLOSE"], errors="coerce")
    d["last"]             = None
    d["prev_close"]       = df["instrument_key"].map(reference["prior_close"])
    d["avg_price"]        = None
    d["volume"]           = pd.to_numeric(df["CONTRACTS"],  errors="coerce").astype("Int64")
    d["turnover"]         = pd.to_numeric(df["VAL_INLAKH"], errors="coerce") * 1e5
    d["trade_count"]      = None
    d["open_interest"]    = pd.to_numeric(df["OPEN_INT"],   errors="coerce").astype("Int64")
    d["change_in_oi"]     = pd.to_numeric(df["CHG_IN_OI"],  errors="coerce").astype("Int64")
    d["settlement_price"] = pd.to_numeric(df["SETTLE_PR"],  errors="coerce")
    d["underlying_price"] = df.apply(
        lambda r: reference["underlying"].get((r["instrument_type"], r["SYMBOL"])), axis=1
    )
    d["delivery_qty"]     = None
    d["delivery_pct"]     = None
    return d


# ══════════════════════════════════════════════════════════════════════════
# futures_analytics: compute (pure — safe in worker process)
# ══════════════════════════════════════════════════════════════════════════

def _compute_futures_rows(df: pd.DataFrame, trade_date: str, reference: dict) -> list[tuple]:
    if df.empty:
        return []

    mem = duckdb.connect(":memory:")
    try:
        mem.register("_fut_stage", df)
        agg = mem.execute(f"""
            SELECT
                instrument_type,
                SYMBOL AS ticker,
                instrument_key,
                expiry_d,
                AVG(TRY_CAST(CLOSE AS DOUBLE)) AS close,
                SUM(TRY_CAST(CHG_IN_OI AS DOUBLE)) AS chng_in_oi,
                SUM(TRY_CAST(OPEN_INT  AS DOUBLE)) AS open_int,
                SUM(TRY_CAST(CONTRACTS AS DOUBLE)) AS volume
            FROM _fut_stage
            GROUP BY instrument_type, SYMBOL, instrument_key, expiry_d
        """).df()
        mem.unregister("_fut_stage")
    finally:
        mem.close()

    if agg.empty:
        return []

    trade_dt = pd.to_datetime(trade_date)
    rows = []
    for _, r in agg.iterrows():
        instrument_type, ticker, instrument_key = str(r["instrument_type"]), str(r["ticker"]), r["instrument_key"]
        close = r["close"]
        chng_in_oi, open_int, volume = r["chng_in_oi"], r["open_int"], r["volume"]
        expiry = r["expiry_d"]
        expiry_ts = pd.to_datetime(expiry)
        dte = max((expiry_ts - trade_dt).days, 0) if pd.notna(expiry_ts) else None

        underlying = reference["underlying"].get((instrument_type, ticker))
        prev_close = reference["prior_close"].get(instrument_key)
        lot_size   = reference["lot_size"].get(instrument_key)

        chng_price   = (close - prev_close) if (close is not None and prev_close is not None) else None
        prev_oi      = (open_int - chng_in_oi) if (open_int is not None and chng_in_oi is not None) else None
        chng_price_p = (chng_price / prev_close * 100) if (chng_price is not None and prev_close) else None
        chng_oi_p    = (chng_in_oi / prev_oi * 100) if prev_oi else None
        quadrant     = (
            _QUADRANT[(chng_in_oi >= 0, chng_price >= 0)]
            if (chng_in_oi is not None and chng_price is not None) else None
        )
        basis        = (close - underlying) if (close is not None and underlying is not None) else None
        coc          = ((basis / underlying) * (365 / dte)) if (basis is not None and underlying and dte) else None
        actual_volume = (volume * lot_size) if (volume is not None and lot_size) else None
        choivr        = (chng_in_oi / actual_volume) if (chng_in_oi is not None and actual_volume) else None

        rows.append((
            instrument_type, ticker,
            expiry, pd.to_datetime(trade_date).date(),
            underlying,
            chng_price, chng_price_p, chng_oi_p,
            quadrant, basis, coc, choivr, dte,
        ))
    return rows


# ══════════════════════════════════════════════════════════════════════════
# options_analytics: max pain (unchanged logic from fo_bhavcopy.py)
# ══════════════════════════════════════════════════════════════════════════

def _max_pain(df: pd.DataFrame) -> dict:
    results = {}
    for (instrument_type, symbol, expiry_raw), g in df.groupby(["instrument_type", "SYMBOL", "EXPIRY_DT"]):
        ce = g[g["OPTION_TYP"] == "CE"].set_index("STRIKE_PR")["OPEN_INT"].fillna(0)
        pe = g[g["OPTION_TYP"] == "PE"].set_index("STRIKE_PR")["OPEN_INT"].fillna(0)
        strikes = np.array(sorted(set(ce.index) | set(pe.index)))
        if not len(strikes):
            continue
        ce_k, ce_oi = ce.index.to_numpy(), ce.to_numpy()
        pe_k, pe_oi = pe.index.to_numpy(), pe.to_numpy()
        pains = np.array([
            np.sum(np.maximum(0, s - ce_k) * ce_oi) +
            np.sum(np.maximum(0, pe_k - s) * pe_oi)
            for s in strikes
        ])
        expiry_iso = str(pd.to_datetime(expiry_raw, format=_LEGACY_DATE_FMT).date())
        results[(str(instrument_type), str(symbol), expiry_iso)] = float(strikes[np.argmin(pains)])
    return results


def _compute_options_rows(df: pd.DataFrame, trade_date: str, reference: dict) -> list[tuple]:
    if df.empty:
        return []

    mem = duckdb.connect(":memory:")
    try:
        mem.register("_opt_stage", df)
        pcr_df = mem.execute(f"""
            SELECT
                instrument_type, SYMBOL AS ticker,
                strptime(EXPIRY_DT, '{_LEGACY_DATE_FMT}')::DATE AS expiry,
                strptime(TIMESTAMP, '{_LEGACY_DATE_FMT}')::DATE AS trade_date,
                SUM(CASE WHEN OPTION_TYP='PE' THEN TRY_CAST(OPEN_INT AS DOUBLE) ELSE 0 END) AS pe_oi,
                SUM(CASE WHEN OPTION_TYP='CE' THEN TRY_CAST(OPEN_INT AS DOUBLE) ELSE 0 END) AS ce_oi
            FROM _opt_stage
            GROUP BY instrument_type, SYMBOL,
                     strptime(EXPIRY_DT, '{_LEGACY_DATE_FMT}'),
                     strptime(TIMESTAMP, '{_LEGACY_DATE_FMT}')
        """).df()

        mp_df = mem.execute("""
            SELECT instrument_type, SYMBOL, EXPIRY_DT,
                   TRY_CAST(STRIKE_PR AS DOUBLE) AS STRIKE_PR,
                   OPTION_TYP,
                   TRY_CAST(OPEN_INT  AS DOUBLE) AS OPEN_INT
            FROM _opt_stage
            WHERE STRIKE_PR IS NOT NULL AND OPEN_INT IS NOT NULL
        """).df()
        mem.unregister("_opt_stage")
    finally:
        mem.close()

    if pcr_df.empty:
        return []

    pcr_df["pcr"] = pcr_df.apply(
        lambda r: r["pe_oi"] / r["ce_oi"] if r["ce_oi"] else np.nan, axis=1
    )
    mp_map = _max_pain(mp_df)

    rows = []
    for _, r in pcr_df.iterrows():
        instrument_type, ticker = r["instrument_type"], r["ticker"]
        key = (instrument_type, ticker, str(pd.to_datetime(r["expiry"]).date()))
        mp = mp_map.get(key, np.nan)
        underlying = reference["underlying"].get((str(instrument_type), str(ticker)))
        rows.append((
            str(instrument_type), str(ticker),
            r["expiry"], r["trade_date"],
            underlying,
            r["pe_oi"], r["ce_oi"], r["pcr"],
            None if (isinstance(mp, float) and np.isnan(mp)) else mp,
        ))
    return rows


# ══════════════════════════════════════════════════════════════════════════
# Top-level compute (worker-safe: no real DB connection anywhere)
# ══════════════════════════════════════════════════════════════════════════

def compute(trade_date: str, reference: dict) -> dict:
    """Pure compute for one trade_date, legacy format. `reference` must be
    pre-fetched by fetch_reference_data() on the main process — this
    function never opens a real DB connection, so it's safe inside a
    ProcessPoolExecutor worker."""
    raw = _load(trade_date)
    raw.columns = raw.columns.str.strip()

    fut_raw = raw[raw["INSTRUMENT"].isin(_LEGACY_FUT)].copy()
    opt_raw = raw[raw["INSTRUMENT"].isin(_LEGACY_OPT)].copy()

    fut_raw, fut_instr = _build_instruments(fut_raw)
    opt_raw, opt_instr = _build_instruments(opt_raw)
    all_instr = pd.concat([fut_instr, opt_instr]).drop_duplicates("instrument_key")

    fut_mdd = _build_market_data(fut_raw, reference) if not fut_raw.empty else pd.DataFrame()
    opt_mdd = _build_market_data(opt_raw, reference) if not opt_raw.empty else pd.DataFrame()
    all_mdd = pd.concat([fut_mdd, opt_mdd])

    fut_rows = _compute_futures_rows(fut_raw, trade_date, reference) if not fut_raw.empty else []
    opt_rows = _compute_options_rows(opt_raw, trade_date, reference) if not opt_raw.empty else []

    return {
        "trade_date":    trade_date,
        "instruments":   all_instr,
        "market_data":   all_mdd,
        "futures_rows":  fut_rows,
        "options_rows":  opt_rows,
        "fut_row_count": len(fut_raw),
        "opt_row_count": len(opt_raw),
    }


def write(conn: duckdb.DuckDBPyConnection, result: dict, trade_date: str):
    """Persists a `compute()` result. Caller owns the transaction."""
    if not result["instruments"].empty:
        upsert_instruments(conn, result["instruments"])
    if not result["market_data"].empty:
        upsert_market_data(conn, result["market_data"])
    _write_futures_rows(conn, result["futures_rows"])
    _write_options_rows(conn, result["options_rows"])
    print(f"[fo_legacy] {trade_date} — {result['fut_row_count']} fut rows, {result['opt_row_count']} opt rows")


# ══════════════════════════════════════════════════════════════════════════
# Entry point (sequential — startup_sync path)
# ══════════════════════════════════════════════════════════════════════════

def process(trade_date: str):
    if is_processed(trade_date, "STF") and is_processed(trade_date, "STO"):
        print(f"[fo_legacy] {trade_date} already processed, skipping")
        return

    raw = _load(trade_date)
    raw.columns = raw.columns.str.strip()
    tickers = _tickers_by_type(raw)

    # instrument_key generation is pure/deterministic — safe to run before
    # touching the DB, so we can use fut_instr to drive the prior_close lookup.
    fut_raw = raw[raw["INSTRUMENT"].isin(_LEGACY_FUT)].copy()
    _, fut_instr = _build_instruments(fut_raw)

    conn = get_conn()
    try:
        reference = fetch_reference_data(conn, trade_date, fut_instr, tickers)
        result = compute(trade_date, reference)

        conn.execute("BEGIN")
        write(conn, result, trade_date)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
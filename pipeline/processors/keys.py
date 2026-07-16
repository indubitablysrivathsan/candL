"""Deterministic instrument_key generator — stable across runs."""

import hashlib
import pandas as pd

def make_instrument_key(
    instrument_type,
    ticker,
    expiry,
    strike,
    option_type,
    series,
):
    expiry_s = str(expiry) if pd.notna(expiry) else ""

    strike_s = (
        f"{float(strike):.4f}"
        if pd.notna(strike)
        else ""
    )

    instr_s = (
        str(instrument_type).upper()
        if pd.notna(instrument_type)
        else ""
    )

    ticker_s = (
        str(ticker).upper()
        if pd.notna(ticker)
        else ""
    )

    opt_s = (
        str(option_type).upper()
        if pd.notna(option_type)
        else ""
    )

    series_s = (
        str(series).upper()
        if pd.notna(series)
        else ""
    )

    raw = "|".join([
        instr_s,
        ticker_s,
        expiry_s,
        strike_s,
        opt_s,
        series_s,
    ])

    digest = hashlib.sha256(raw.encode()).digest()
    return int.from_bytes(digest[:8], "big") & 0x7FFF_FFFF_FFFF_FFFF

def make_instrument_keys_batch(
    df: pd.DataFrame,
    instrument_type_col,
    ticker_col,
    expiry_col,       # column name or None
    strike_col,       # column name or None
    option_type_col,  # column name or None
    series_col,       # column name or None
) -> pd.Series:
    """Same output as df.apply(lambda r: make_instrument_key(...), axis=1),
    just avoids per-row Series construction. Formatting logic is untouched —
    this is a call-overhead fix, not a formatting rewrite."""

    n = len(df)
    instr_vals   = df[instrument_type_col].to_numpy(dtype=object)
    ticker_vals  = df[ticker_col].to_numpy(dtype=object)
    expiry_vals  = df[expiry_col].to_numpy(dtype=object) if expiry_col else [None] * n
    strike_vals  = df[strike_col].to_numpy(dtype=object) if strike_col else [None] * n
    opt_vals     = df[option_type_col].to_numpy(dtype=object) if option_type_col else [None] * n
    series_vals  = df[series_col].to_numpy(dtype=object) if series_col else [None] * n

    return pd.Series(
        [
            make_instrument_key(i, t, e, s, o, sr)
            for i, t, e, s, o, sr in zip(instr_vals, ticker_vals, expiry_vals, strike_vals, opt_vals, series_vals)
        ],
        index=df.index,
        dtype="int64",
    )
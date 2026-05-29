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
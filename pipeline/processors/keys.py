"""Deterministic instrument_key generator — stable across runs."""

import hashlib


def make_instrument_key(
    instrument_type: str,
    ticker: str,
    expiry,          # date | None
    strike: float | None,
    option_type: str | None,
    series: str | None,
) -> int:
    """
    Hash (instrument_type, ticker, expiry, strike, option_type, series)
    → signed 63-bit integer (fits BIGINT, stays stable).
    """
    expiry_s  = str(expiry)  if expiry      else ""
    strike_s  = f"{float(strike):.4f}" if strike is not None else ""
    opt_s     = (option_type or "").upper()
    series_s  = (series or "").upper()
    raw = "|".join([
        (instrument_type or "").upper(),
        (ticker or "").upper(),
        expiry_s, strike_s, opt_s, series_s,
    ])
    digest = hashlib.sha256(raw.encode()).digest()
    # 8 bytes → unsigned int → mask to 63 bits to keep positive
    return int.from_bytes(digest[:8], "big") & 0x7FFF_FFFF_FFFF_FFFF
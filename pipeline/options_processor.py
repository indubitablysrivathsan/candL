"""
NSE Platform — Options bhav copy processor
===========================================
Ported from the original script.
Usage:
    python pipeline/processor.py --input "D:/bhav/01-Jan 2026" --ticker SBIN
    python pipeline/processor.py --input "D:/bhav/01-Jan 2026"   # all tickers
"""

import argparse
import glob
import os
import numpy as np
import pandas as pd
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import OPTIONS_ROOT
from config import FO_RAW_ROOT

KEEP_COLS = [
    "TradDt", "FinInstrmId", "TckrSymb", "XpryDt", "StrkPric", "OptnTp",
    "OpnPric", "HghPric", "LwPric", "ClsPric", "LastPric", "PrvsClsgPric",
    "UndrlygPric", "SttlmPric", "OpnIntrst", "ChngInOpnIntrst",
    "TtlTradgVol", "TtlTrfVal", "TtlNbOfTxsExctd", "NewBrdLotQty",
]


def ensure_dirs(base: Path):
    (base / "DATA").mkdir(parents=True, exist_ok=True)


def compute_pcr(df: pd.DataFrame):
    ce  = df[df["OptnTp"] == "CE"]["OpnIntrst"].sum()
    pe  = df[df["OptnTp"] == "PE"]["OpnIntrst"].sum()
    pcr = pe / ce if ce != 0 else np.nan
    return pe, ce, pcr


def compute_max_pain(df: pd.DataFrame) -> float:
    strikes = sorted(df["StrkPric"].dropna().unique())
    pain = {}
    for strike in strikes:
        total = 0.0
        for _, row in df.iterrows():
            oi = row["OpnIntrst"]
            k  = row["StrkPric"]
            if row["OptnTp"] == "CE":
                total += max(0, strike - k) * oi
            else:
                total += max(0, k - strike) * oi
        pain[strike] = total
    return float(min(pain, key=pain.get))


def update_analytics(base: Path, date: str, pe, ce, pcr, underlying, max_pain):
    file_path = base / "analytics.csv"
    new_row = pd.DataFrame([{
        "trade_date": date, "pe": pe, "ce": ce,
        "pcr": pcr, "underlying": underlying, "max_pain": max_pain,
    }])
    if file_path.exists():
        existing = pd.read_csv(file_path)
        updated  = pd.concat([existing, new_row], ignore_index=True)
        updated  = updated.drop_duplicates(subset=["trade_date"], keep="last")
    else:
        updated = new_row
    updated["trade_date"] = pd.to_datetime(updated["trade_date"])
    updated = updated.sort_values("trade_date")
    updated.to_csv(file_path, index=False)


def get_raw_fo_path(trade_date: str) -> Path:

    dt = pd.to_datetime(trade_date)

    year = dt.strftime("%Y")
    month = dt.strftime("%m")

    return (
        Path(FO_RAW_ROOT)
        / year
        / month
        / f"{trade_date}.csv"
    )


def process_trade_date(trade_date: str):

    raw_file = get_raw_fo_path(trade_date)

    if not raw_file.exists():
        raise FileNotFoundError(raw_file)

    process_file(str(raw_file))
    

def already_processed(trade_date: str) -> bool:
    """
    Checks whether this trade date already exists
    anywhere inside processed options data.
    """

    pattern = (
        OPTIONS_ROOT
        / "*"
        / "*"
        / "DATA"
        / f"{trade_date}.csv"
    )

    matches = glob.glob(str(pattern))

    return len(matches) > 0


def process_file(file: str, target_ticker: str | None = None):
    df   = pd.read_csv(file)
    date = pd.to_datetime(df["TradDt"].iloc[0]).strftime("%Y-%m-%d")

    df = df[df["FinInstrmTp"] == "STO"]

    # Keep only defined columns that exist in this file
    cols = [c for c in KEEP_COLS if c in df.columns]
    df   = df[cols]

    if target_ticker:
        df = df[df["TckrSymb"] == target_ticker]

    for col in ["StrkPric", "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    for (ticker, expiry), g in df.groupby(["TckrSymb", "XpryDt"]):
        base = OPTIONS_ROOT / str(ticker) / str(expiry)
        ensure_dirs(base)

        pe, ce, pcr = compute_pcr(g)
        max_pain    = compute_max_pain(g)
        underlying  = g["UndrlygPric"].mean()

        g.to_csv(base / "DATA" / f"{date}.csv", index=False)
        update_analytics(base, date, pe, ce, pcr, underlying, max_pain)
        print(f"  ✓ {ticker} / {expiry} / {date}")


def run(input_folder: str, target_ticker: str | None = None):
    files = glob.glob(os.path.join(input_folder, "*.csv"))
    if not files:
        print(f"No CSV files found in {input_folder}")
        return
    print(f"Processing {len(files)} file(s) from {input_folder}")
    for f in sorted(files):
        print(f"→ {Path(f).name}")
        process_file(f, target_ticker)
    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NSE options bhav copy processor")
    parser.add_argument("--input",  required=True, help="Folder containing raw bhav CSVs")
    parser.add_argument("--ticker", default=None,  help="Process only this ticker (optional)")
    args = parser.parse_args()
    run(args.input, args.ticker)

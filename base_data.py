import pandas as pd
import os
import glob
import numpy as np
import matplotlib.pyplot as plt

INPUT_FOLDER = "data"
OUTPUT_FOLDER = "output"
TARGET_TICKER = "SBIN"  # Set to None to run all

def extract_date(file):
    return file.split('_')[6]


def ensure_dirs(base):
    dirs = ['DATA']
    for d in dirs:
        os.makedirs(os.path.join(base, d), exist_ok=True)


def compute_pcr(df):
    ce = df[df['OptnTp'] == 'CE']['OpnIntrst'].sum()
    pe = df[df['OptnTp'] == 'PE']['OpnIntrst'].sum()
    pcr = pe / ce if ce != 0 else np.nan
    return pe, ce, pcr


def compute_max_pain(df):
    strikes = sorted(df['StrkPric'].dropna().unique())

    pain = {}

    for strike in strikes:
        total_loss = 0

        for _, row in df.iterrows():
            oi = row['OpnIntrst']
            k = row['StrkPric']

            if row['OptnTp'] == 'CE':
                loss = max(0, strike - k) * oi
            else:
                loss = max(0, k - strike) * oi

            total_loss += loss

        pain[strike] = total_loss

    return min(pain, key=pain.get)

def update_analytics_csv(base_path, date, pe, ce, pcr, underlying, max_pain):
    file_path = os.path.join(base_path, "analytics.csv")

    new_row = pd.DataFrame([{
        'trade_date': date,
        'pe': pe,
        'ce': ce,
        'pcr': pcr,
        'underlying': underlying,
        'max_pain': max_pain
    }])

    if os.path.exists(file_path):
        existing = pd.read_csv(file_path)

        # combine old + new
        updated = pd.concat([existing, new_row], ignore_index=True)

        # remove duplicate trade dates
        updated = updated.drop_duplicates(
            subset=['trade_date'],
            keep='last'
        )

    else:
        updated = new_row

    # sort by date
    updated['trade_date'] = pd.to_datetime(updated['trade_date'])
    updated = updated.sort_values(by='trade_date')

    updated.to_csv(file_path, index=False)

def process_file(file):
    df = pd.read_csv(file)

    date = pd.to_datetime(df['TradDt'].iloc[0]).strftime("%Y-%m-%d")

    df = df[df['FinInstrmTp'] == 'STO']

    KEEP_COLS = [
        'TradDt',
        'FinInstrmId',
        'TckrSymb',
        'XpryDt',
        'StrkPric',
        'OptnTp',
        'OpnPric',
        'HghPric',
        'LwPric',
        'ClsPric',
        'LastPric',
        'PrvsClsgPric',
        'UndrlygPric',
        'SttlmPric',
        'OpnIntrst',
        'ChngInOpnIntrst',
        'TtlTradgVol',
        'TtlTrfVal',
        'TtlNbOfTxsExctd',
        'NewBrdLotQty'
    ]

    df = df[KEEP_COLS]

    if TARGET_TICKER:
        df = df[df['TckrSymb'] == TARGET_TICKER]

    for col in ['StrkPric', 'OpnIntrst', 'ChngInOpnIntrst', 'TtlTradgVol']:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    for (ticker, expiry), g in df.groupby(['TckrSymb', 'XpryDt']):

        base = os.path.join(OUTPUT_FOLDER, ticker, str(expiry))
        ensure_dirs(base)

        c, p, pcr = compute_pcr(g)
        max_pain = compute_max_pain(g)

        # SAVE FULL RAW NSE DATA (NO GROUPING)
        g.to_csv(os.path.join(base, 'DATA', f"{date}.csv"), index=False)

        update_analytics_csv(base, date, c, p, pcr, g['UndrlygPric'].mean(), max_pain)


files = glob.glob(os.path.join(INPUT_FOLDER, "*.csv"))

for f in files:
    process_file(f)
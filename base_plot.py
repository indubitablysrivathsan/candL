import pandas as pd
import os
import glob
import numpy as np
import matplotlib.pyplot as plt

INPUT_FOLDER = "data"
OUTPUT_FOLDER = "output"
TARGET_TICKER = "SBIN"  # Set to None to run all

COLORS = {
    'OI': {
        'CE': (0/255, 176/255, 240/255),
        'PE': (255/255, 0/255, 255/255)
    },
    'CHNGOI': {
        'CE': (146/255, 208/255, 80/255),
        'PE': (228/255, 108/255, 10/255)
    },
    'VOLUME': {
        'CE': (0.2, 0.6, 0.8),
        'PE': (0.8, 0.3, 0.3)
    }
}


def extract_date(file):
    return file.split('_')[6]


def ensure_dirs(base):
    dirs = ['OI', 'CHNGOI', 'VOLUME']
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

def plot_metric(strikes, ce, pe, underlying, max_pain, ticker, expiry, date, col, label, out_dir):
    x = np.arange(len(strikes))
    width = 0.38

    # ── Style ──────────────────────────────────────────────────────────────
    BG        = "#0f1117"
    AX_BG     = "#161b22"
    GRID_COL  = "#21262d"
    TEXT_COL  = "#e6edf3"
    MUTED     = "#8b949e"
    CE_COL    = COLORS[label]['CE']
    PE_COL    = COLORS[label]['PE']
    UL_COL    = "#f0c040"
    MP_COL    = "#3fb950"

    plt.rcParams.update({
        "font.family":      "DejaVu Sans",
        "font.size":        9,
        "text.color":       TEXT_COL,
        "axes.labelcolor":  TEXT_COL,
        "xtick.color":      MUTED,
        "ytick.color":      MUTED,
    })

    fig, ax = plt.subplots(figsize=(13, 5.5), dpi=120)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(AX_BG)

    # ── Bars ───────────────────────────────────────────────────────────────
    ax.bar(x - width / 2, ce[col], width, color=CE_COL, label="CE", zorder=3)
    ax.bar(x + width / 2, pe[col], width, color=PE_COL, label="PE", zorder=3)

    # ── Grid ───────────────────────────────────────────────────────────────
    ax.yaxis.grid(True, color=GRID_COL, linewidth=0.6, zorder=0)
    ax.set_axisbelow(True)
    for spine in ax.spines.values():
        spine.set_edgecolor(GRID_COL)

    # ── Underlying line ────────────────────────────────────────────────────
    if not np.isnan(underlying):
        u_idx = np.interp(underlying, strikes, x)
        ax.axvline(u_idx, linestyle="--", linewidth=1.4, color=UL_COL,
                   label=f"Underlying  {underlying:,.2f}", zorder=4)

    # ── Max Pain line ──────────────────────────────────────────────────────
    if max_pain is not None:
        mp_idx = np.interp(max_pain, strikes, x)
        ax.axvline(mp_idx, linestyle=":", linewidth=1.4, color=MP_COL,
                   label=f"Max Pain  {max_pain:,.2f}", zorder=4)

    # ── X-axis ticks  (show every Nth label to avoid crowding) ────────────
    n_strikes = len(strikes)
    max_labels = 18                                   # max readable labels
    stride = max(1, round(n_strikes / max_labels))
    visible_idx    = x[::stride]
    visible_labels = [str(int(s)) if float(s).is_integer() else f"{s:g}"
                      for s in strikes[::stride]]

    ax.set_xticks(visible_idx)
    ax.set_xticklabels(visible_labels, fontsize=8, color=MUTED)
    ax.tick_params(axis="x", length=0)               # no tick marks
    ax.tick_params(axis="y", length=0)

    # ── Labels / title / legend ────────────────────────────────────────────
    ax.set_xlim(-0.8, n_strikes - 0.2)

    ax.set_title(
        f"{ticker}   ·   Expiry {expiry}   ·   {label}",
        fontsize=11, fontweight="bold", color=TEXT_COL,
        pad=12, loc="left",
    )

    legend = ax.legend(
        loc="upper left",
        framealpha=0.15,
        edgecolor=GRID_COL,
        labelcolor=TEXT_COL,
        fontsize=8.5,
        handlelength=1.8
    )
    legend.get_frame().set_facecolor(AX_BG)

    # ── Save ───────────────────────────────────────────────────────────────
    plt.tight_layout(pad=1.2)
    plt.savefig(
        os.path.join(out_dir, f"{date}.png"),
        dpi=120,
        bbox_inches="tight",
        facecolor=BG,
    )
    plt.close()
    plt.rcParams.update(plt.rcParamsDefault)   # reset so other plots are unaffected


def process_file(file):
    df = pd.read_csv(file)
    date = pd.to_datetime(df['TradDt'].iloc[0]).strftime("%Y-%m-%d")

    df = df[df['FinInstrmTp'] == 'STO']

    if TARGET_TICKER:
        df = df[df['TckrSymb'] == TARGET_TICKER]

    for col in ['StrkPric', 'OpnIntrst', 'ChngInOpnIntrst', 'TtlTradgVol']:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    grouped = df.groupby(['TckrSymb', 'XpryDt', 'StrkPric', 'OptnTp']).agg({
        'OpnIntrst': 'sum',
        'ChngInOpnIntrst': 'sum',
        'TtlTradgVol': 'sum',
        'UndrlygPric': 'mean'
    }).reset_index()

    for (ticker, expiry), g in grouped.groupby(['TckrSymb', 'XpryDt']):

        base = os.path.join(OUTPUT_FOLDER, ticker, str(expiry))
        ensure_dirs(base)

        strikes = sorted(g['StrkPric'].dropna().unique())

        ce = g[g['OptnTp'] == 'CE'].set_index('StrkPric').reindex(strikes).fillna(0)
        pe = g[g['OptnTp'] == 'PE'].set_index('StrkPric').reindex(strikes).fillna(0)

        underlying = g['UndrlygPric'].mean()

        # Level 2 Metrics
        c, p, pcr = compute_pcr(g)
        max_pain = compute_max_pain(g)

        # Plots
        plot_metric(strikes, ce, pe, underlying, max_pain, ticker, expiry, date,
                    'OpnIntrst', 'OI', os.path.join(base, 'OI'))

        plot_metric(strikes, ce, pe, underlying, max_pain, ticker, expiry, date,
                    'ChngInOpnIntrst', 'CHNGOI', os.path.join(base, 'CHNGOI'))

        plot_metric(strikes, ce, pe, underlying, max_pain, ticker, expiry, date,
                    'TtlTradgVol', 'VOLUME', os.path.join(base, 'VOLUME'))


files = glob.glob(os.path.join(INPUT_FOLDER, "*.csv"))

for f in files:
    process_file(f)
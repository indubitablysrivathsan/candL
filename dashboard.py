import streamlit as st
import pandas as pd
import numpy as np
import os
import plotly.graph_objects as go
from plotly.subplots import make_subplots

st.set_page_config(page_title="NSE F&O Dashboard", layout="wide")

BASE_PATH = r"E:\Projects\NSE F&O\output"

METRIC_LABELS = {
    "OpnIntrst":       "Open Interest",
    "ChngInOpnIntrst": "OI Change",
    "TtlTradgVol":     "Volume",
    "TIME_SERIES":     "Time Series",
}

METRIC_COLORS = {
    "OpnIntrst":       {"CE": "#00B0F0", "PE": "#FF00FF"},
    "ChngInOpnIntrst": {"CE": "#92D050", "PE": "#E46C0A"},
    "TtlTradgVol":     {"CE": "#26a69a", "PE": "#ef5350"},
}


# ─────────────────────────────────────────────
# Data loading
# ─────────────────────────────────────────────

def list_tickers():
    return sorted(os.listdir(BASE_PATH))


def list_expiries(ticker):
    return sorted(os.listdir(os.path.join(BASE_PATH, ticker)))


def load_data_for_expiry(ticker, expiry, start_date, end_date):
    data_path = os.path.join(BASE_PATH, ticker, expiry, "DATA")
    if not os.path.exists(data_path):
        return pd.DataFrame()

    start_dt = pd.to_datetime(start_date)
    end_dt   = pd.to_datetime(end_date)
    all_data = []

    for file in sorted(os.listdir(data_path)):
        if not file.endswith(".csv"):
            continue
        file_date = pd.to_datetime(file.replace(".csv", ""), errors="coerce")
        if pd.isna(file_date) or file_date < start_dt or file_date > end_dt:
            continue
        df = pd.read_csv(os.path.join(data_path, file))
        df["trade_date"] = file_date
        df["expiry"]     = expiry
        all_data.append(df)

    if not all_data:
        return pd.DataFrame()

    result = pd.concat(all_data, ignore_index=True)
    result["StrkPric"]    = pd.to_numeric(result["StrkPric"],    errors="coerce")
    result["UndrlygPric"] = pd.to_numeric(result["UndrlygPric"], errors="coerce")
    for col in ["OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol"]:
        if col in result.columns:
            result[col] = pd.to_numeric(result[col], errors="coerce").fillna(0)
    return result


def load_analytics_for_expiry(ticker, expiry, start_date, end_date):
    path = os.path.join(BASE_PATH, ticker, expiry, "analytics.csv")
    if not os.path.exists(path):
        return pd.DataFrame()
    df = pd.read_csv(path)
    df["trade_date"] = pd.to_datetime(df["trade_date"], format="mixed", errors="coerce")
    df = df.dropna(subset=["trade_date"])
    start_dt = pd.to_datetime(start_date)
    end_dt   = pd.to_datetime(end_date)
    return df[(df["trade_date"] >= start_dt) & (df["trade_date"] <= end_dt)].copy()


def get_analytics_for_day(analytics_df, trade_date):
    if analytics_df.empty:
        return None
    match = analytics_df[analytics_df["trade_date"].dt.date == trade_date]
    return match.iloc[0] if not match.empty else None


# ─────────────────────────────────────────────
# Navigation callbacks — defined OUTSIDE the loop
# so there is no closure-capture issue at all.
# They receive everything they need via arguments.
# ─────────────────────────────────────────────

def nav_prev(slider_key, dates):
    cur = st.session_state.get(slider_key, dates[0])
    try:
        i = dates.index(cur)
    except ValueError:
        i = 0
    st.session_state[slider_key] = dates[max(0, i - 1)]


def nav_next(slider_key, dates):
    cur = st.session_state.get(slider_key, dates[0])
    try:
        i = dates.index(cur)
    except ValueError:
        i = 0
    st.session_state[slider_key] = dates[min(len(dates) - 1, i + 1)]


# ─────────────────────────────────────────────
# X axis helpers
# ─────────────────────────────────────────────

def base_strike_gap(strikes):
    if len(strikes) < 2:
        return 1
    diffs = [int(round(b - a)) for a, b in zip(strikes, strikes[1:]) if b > a]
    return min(diffs) if diffs else 1


def full_strike_range(strikes):
    if not strikes:
        return []
    gap = base_strike_gap(strikes)
    lo  = int(round(min(strikes)))
    hi  = int(round(max(strikes)))
    return list(range(lo, hi + gap, gap))


def x_tick_every(full_range):
    if len(full_range) <= 15:
        return base_strike_gap(full_range)
    span = full_range[-1] - full_range[0]
    gap  = base_strike_gap(full_range)
    step = gap
    while span / step > 15:
        step += gap
    return step


# ─────────────────────────────────────────────
# Y axis helpers
# ─────────────────────────────────────────────

def compute_global_yscale(data, metric):
    vals = data[metric].dropna()
    if vals.empty:
        return 0, 1
    if metric == "ChngInOpnIntrst":
        lo  = float(vals.min())
        hi  = float(vals.max())
        pad = max(abs(lo), abs(hi)) * 0.10
        return lo - pad, hi + pad
    else:
        return 0.0, float(vals.max()) * 1.10


# ─────────────────────────────────────────────
# Strike bar chart
# ─────────────────────────────────────────────

def build_strike_fig(day_df, metric, ticker, selected_day,
                     analytics_row, full_range, y_min, y_max):
    ce_raw = day_df[day_df["OptnTp"] == "CE"].set_index("StrkPric")[metric]
    pe_raw = day_df[day_df["OptnTp"] == "PE"].set_index("StrkPric")[metric]

    ce_y = [float(ce_raw.get(s, 0)) for s in full_range]
    pe_y = [float(pe_raw.get(s, 0)) for s in full_range]

    colors   = METRIC_COLORS.get(metric, METRIC_COLORS["TtlTradgVol"])
    ce_label = f"Call {METRIC_LABELS[metric]}"
    pe_label = f"Put  {METRIC_LABELS[metric]}"

    every      = x_tick_every(full_range)
    tick_vals  = [s for s in full_range if (s - full_range[0]) % every == 0]
    tick_texts = [f"{s:,}" for s in tick_vals]

    fig = go.Figure()
    fig.add_bar(
        x=full_range, y=ce_y,
        name=ce_label, marker_color=colors["CE"],
        hovertemplate="Strike %{x:,}<br>CE: %{y:,.0f}<extra></extra>",
    )
    fig.add_bar(
        x=full_range, y=pe_y,
        name=pe_label, marker_color=colors["PE"],
        hovertemplate="Strike %{x:,}<br>PE: %{y:,.0f}<extra></extra>",
    )

    underlying = None
    max_pain   = None
    if analytics_row is not None:
        underlying = analytics_row.get("underlying")
        max_pain   = analytics_row.get("max_pain")
    if underlying is None:
        uv = day_df["UndrlygPric"].dropna()
        underlying = float(uv.iloc[0]) if not uv.empty else None

    if underlying is not None:
        fig.add_vline(
            x=underlying, line_dash="dash", line_color="#FFD700", line_width=2,
            annotation_text=f"Underlying {underlying:,.1f}",
            annotation_position="top left",
            annotation_font_color="#FFD700",
        )
    if max_pain is not None:
        fig.add_vline(
            x=max_pain, line_dash="dot", line_color="#FF69B4", line_width=2,
            annotation_text=f"Max Pain {max_pain:,.1f}",
            annotation_position="top right",
            annotation_font_color="#FF69B4",
        )

    fig.update_layout(
        title=f"{ticker}  ·  {selected_day}  ·  {METRIC_LABELS[metric]}",
        barmode="group",
        bargap=0.15,
        bargroupgap=0.05,
        xaxis=dict(
            title="Strike Price",
            tickmode="array",
            tickvals=tick_vals,
            ticktext=tick_texts,
            tickangle=-45,
            range=[full_range[0] - base_strike_gap(full_range),
                   full_range[-1] + base_strike_gap(full_range)],
        ),
        yaxis=dict(
            title=METRIC_LABELS[metric],
            range=[y_min, y_max],
            tickformat=",",
        ),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        plot_bgcolor="#0e1117",
        paper_bgcolor="#0e1117",
        font_color="#fafafa",
        hovermode="x unified",
        margin=dict(t=70, b=90),
    )
    return fig


# ─────────────────────────────────────────────
# Values table
# ─────────────────────────────────────────────

def build_values_table(day_df, metric, full_range, analytics_row):
    ce_raw = day_df[day_df["OptnTp"] == "CE"].set_index("StrkPric")[metric]
    pe_raw = day_df[day_df["OptnTp"] == "PE"].set_index("StrkPric")[metric]

    underlying = None
    if analytics_row is not None:
        underlying = analytics_row.get("underlying")
    if underlying is None:
        uv = day_df["UndrlygPric"].dropna()
        underlying = float(uv.iloc[0]) if not uv.empty else None

    ce_col = f"CE  {METRIC_LABELS[metric]}"
    pe_col = f"PE  {METRIC_LABELS[metric]}"

    rows = [{
        "Strike": int(s),
        ce_col: int(ce_raw.get(s, 0)),
        pe_col: int(pe_raw.get(s, 0)),
    } for s in full_range]

    df = pd.DataFrame(rows)

    atm = None
    if underlying is not None and full_range:
        atm = min(full_range, key=lambda x: abs(x - underlying))

    def highlight_atm(row):
        if atm is not None and row["Strike"] == atm:
            return ["background-color: rgba(255,215,0,0.18); font-weight:bold"] * len(row)
        return [""] * len(row)

    styled = (
        df.style
        .apply(highlight_atm, axis=1)
        .format({"Strike": "{:,}", ce_col: "{:,}", pe_col: "{:,}"})
    )
    return styled, len(df)


# ─────────────────────────────────────────────
# Time Series plots
# ─────────────────────────────────────────────

def build_ts_price_fig(analytics, ticker, expiry):
    if analytics.empty:
        return None
    ana = analytics.sort_values("trade_date")

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=ana["trade_date"], y=ana["underlying"],
        name="Underlying",
        line=dict(color="#26a69a", width=2),
        hovertemplate="%{x|%d %b %Y}<br>Underlying: ₹%{y:,.2f}<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=ana["trade_date"], y=ana["max_pain"],
        name="Max Pain",
        line=dict(color="#FF69B4", width=1.5, dash="dash"),
        hovertemplate="%{x|%d %b %Y}<br>Max Pain: ₹%{y:,.2f}<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=pd.concat([ana["trade_date"], ana["trade_date"][::-1]]),
        y=pd.concat([ana["underlying"], ana["max_pain"][::-1]]),
        fill="toself",
        fillcolor="rgba(255,105,180,0.07)",
        line=dict(color="rgba(0,0,0,0)"),
        showlegend=False, hoverinfo="skip",
    ))

    all_prices = pd.concat([ana["underlying"], ana["max_pain"]]).dropna()
    lo  = float(all_prices.min())
    hi  = float(all_prices.max())
    pad = (hi - lo) * 0.05

    fig.update_layout(
        title=f"{ticker} — {expiry}  |  Underlying vs Max Pain",
        yaxis=dict(range=[lo - pad, hi + pad], tickformat=",", title="Price (₹)"),
        xaxis=dict(title="Date"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        plot_bgcolor="#0e1117", paper_bgcolor="#0e1117", font_color="#fafafa",
        hovermode="x unified", margin=dict(t=60, b=40),
    )
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(showgrid=True, gridcolor="rgba(255,255,255,0.05)")
    return fig


def build_ts_pcr_fig(analytics, ticker, expiry):
    if analytics.empty:
        return None
    ana = analytics.sort_values("trade_date")

    pcr_vals = ana["pcr"].dropna()
    if pcr_vals.empty:
        return None

    lo  = float(pcr_vals.min())
    hi  = float(pcr_vals.max())
    pad = max((hi - lo) * 0.10, 0.05)

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=ana["trade_date"], y=ana["pcr"],
        name="PCR",
        line=dict(color="#FFA726", width=2),
        fill="tozeroy",
        fillcolor="rgba(255,167,38,0.10)",
        hovertemplate="%{x|%d %b %Y}<br>PCR: %{y:.3f}<extra></extra>",
    ))
    if lo - pad <= 1.0 <= hi + pad:
        fig.add_hline(
            y=1.0,
            line_dash="dot", line_color="rgba(255,255,255,0.35)",
            annotation_text="PCR = 1",
            annotation_font_color="rgba(255,255,255,0.5)",
            annotation_position="right",
        )

    fig.update_layout(
        title=f"{ticker} — {expiry}  |  Put-Call Ratio",
        yaxis=dict(range=[lo - pad, hi + pad], title="PCR"),
        xaxis=dict(title="Date"),
        plot_bgcolor="#0e1117", paper_bgcolor="#0e1117", font_color="#fafafa",
        hovermode="x unified", margin=dict(t=60, b=40),
    )
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(showgrid=True, gridcolor="rgba(255,255,255,0.05)")
    return fig


# ─────────────────────────────────────────────
# Sidebar
# ─────────────────────────────────────────────

with st.sidebar:
    st.title("⚙️ Controls")
    ticker = st.selectbox("Ticker", list_tickers())
    expiries = list_expiries(ticker)
    selected_expiries = st.multiselect(
        "Expiries", expiries, default=expiries[:min(3, len(expiries))]
    )
    metric = st.selectbox(
        "Metric",
        ["OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "TIME_SERIES"],
        format_func=lambda x: METRIC_LABELS[x],
    )
    is_ts = (metric == "TIME_SERIES")
    start_date = st.date_input("Start Date", disabled=is_ts)
    end_date   = st.date_input("End Date",   disabled=is_ts)

st.title("📊 NSE F&O Options Dashboard")

if not selected_expiries:
    st.warning("Select at least one expiry from the sidebar.")
    st.stop()


# ─────────────────────────────────────────────
# Per-expiry tabs
# ─────────────────────────────────────────────

exp_tabs = st.tabs([f"📅 {exp}" for exp in selected_expiries])

for exp_tab, expiry in zip(exp_tabs, selected_expiries):
    with exp_tab:

        # ── TIME SERIES MODE ──────────────────────────
        if is_ts:
            path = os.path.join(BASE_PATH, ticker, expiry, "analytics.csv")
            if not os.path.exists(path):
                st.warning(f"No analytics.csv for **{expiry}**.")
                continue
            ana_full = pd.read_csv(path)
            ana_full["trade_date"] = pd.to_datetime(
                ana_full["trade_date"], format="mixed", errors="coerce"
            )
            ana_full = ana_full.dropna(subset=["trade_date"]).sort_values("trade_date")

            ts_plot_tab, ts_pcr_tab = st.tabs(["📈 Price & Max Pain", "📉 PCR"])
            with ts_plot_tab:
                fig_price = build_ts_price_fig(ana_full, ticker, expiry)
                if fig_price:
                    st.plotly_chart(fig_price, use_container_width=True)
                else:
                    st.warning("No price data available.")
            with ts_pcr_tab:
                fig_pcr = build_ts_pcr_fig(ana_full, ticker, expiry)
                if fig_pcr:
                    st.plotly_chart(fig_pcr, use_container_width=True)
                else:
                    st.warning("No PCR data available.")
            continue

        # ── OI / VOLUME MODE ──────────────────────────

        data      = load_data_for_expiry(ticker, expiry, start_date, end_date)
        analytics = load_analytics_for_expiry(ticker, expiry, start_date, end_date)

        if data.empty:
            st.warning(f"No data found for **{expiry}** in the selected date range.")
            continue

        all_strikes  = sorted(data["StrkPric"].dropna().unique())
        full_range   = full_strike_range(all_strikes)
        trade_dates  = sorted(data["trade_date"].dt.date.unique())
        n_days       = len(trade_dates)
        y_min_g, y_max_g = compute_global_yscale(data, metric)

        # One slider key per expiry+metric — this is the single source of truth
        slider_key = f"slider_{expiry}_{metric}"

        # Initialise slider state once (or if it holds a stale date not in range)
        if slider_key not in st.session_state or \
                st.session_state[slider_key] not in trade_dates:
            st.session_state[slider_key] = trade_dates[0]

        # ── Navigation row ────────────────────────────
        # Buttons use the module-level nav_prev / nav_next functions.
        # All necessary data is passed via `args` so there is zero
        # reliance on closure variables — no loop-capture bug possible.
        col_prev, col_slider, col_next = st.columns([1, 10, 1])

        with col_prev:
            st.button(
                "◀",
                key=f"prev_{expiry}_{metric}",
                help="Previous day",
                use_container_width=True,
                on_click=nav_prev,
                args=(slider_key, trade_dates),
            )

        with col_next:
            st.button(
                "▶",
                key=f"next_{expiry}_{metric}",
                help="Next day",
                use_container_width=True,
                on_click=nav_next,
                args=(slider_key, trade_dates),
            )

        with col_slider:
            if n_days > 1:
                # Value driven entirely by session_state[slider_key].
                # After a button click, nav_prev/nav_next already updated
                # session_state[slider_key], so the slider reflects it instantly.
                chosen = st.select_slider(
                    "Date",
                    options=trade_dates,
                    value=st.session_state[slider_key],
                    key=slider_key,
                    label_visibility="collapsed",
                )
                # If user dragged the slider, chosen != session_state value;
                # Streamlit has already written chosen into session_state[slider_key]
                # via the key= binding, so no manual sync needed here.
            else:
                chosen = trade_dates[0]
                st.caption(f"📅 {trade_dates[0]}")

        selected_day  = st.session_state[slider_key]
        day_df        = data[data["trade_date"].dt.date == selected_day].copy()
        analytics_row = get_analytics_for_day(analytics, selected_day)

        st.caption(
            f"Day {trade_dates.index(selected_day) + 1} of {n_days}"
            "  ·  ◀ ▶ or drag slider to navigate"
        )

        # Summary metrics row
        if analytics_row is not None:
            m1, m2, m3, m4 = st.columns([1, 1, 1, 1.5])
            uv  = analytics_row.get("underlying")
            mp  = analytics_row.get("max_pain")
            pcr = analytics_row.get("pcr")
            m1.metric("Underlying", f"₹{uv:,.2f}"  if uv  is not None else "—")
            m2.metric("Max Pain",   f"₹{mp:,.2f}"  if mp  is not None else "—")
            m3.metric("PCR",        f"{pcr:.3f}"   if pcr is not None else "—")
            total_ce = day_df[day_df["OptnTp"] == "CE"][metric].sum()
            total_pe = day_df[day_df["OptnTp"] == "PE"][metric].sum()
            m4.metric("CE | PE Total", f"{total_ce:,.0f} | {total_pe:,.0f}")

        # ── Inner tabs ────────────────────────────────
        chart_tab, table_tab = st.tabs(["📊 Chart", "📋 Values Table"])

        with chart_tab:
            if day_df.empty:
                st.warning(f"No data for {selected_day}.")
            else:
                fig = build_strike_fig(
                    day_df, metric, ticker, selected_day,
                    analytics_row, full_range,
                    y_min_g, y_max_g,
                )
                st.plotly_chart(fig, use_container_width=True)

        with table_tab:
            if day_df.empty:
                st.warning(f"No data for {selected_day}.")
            else:
                st.subheader(f"{ticker}  ·  {selected_day}  ·  {METRIC_LABELS[metric]}")
                st.caption("Gold row = ATM strike (nearest to underlying)")
                styled, n_rows = build_values_table(
                    day_df, metric, full_range, analytics_row
                )
                tbl_height = min(n_rows * 35 + 38, 1200)
                st.dataframe(styled, use_container_width=True,
                             hide_index=True, height=tbl_height)
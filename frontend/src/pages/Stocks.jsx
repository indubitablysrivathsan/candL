// frontend/src/pages/Stocks.jsx
// Bloomberg Terminal / Institutional Trading Workstation aesthetic

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

import MetricCard     from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import CandlestickChart from '../components/charts/CandlestickChart';
import { stocks, formatCurrency, formatNumber } from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   DESIGN TOKENS — institutional terminal palette
───────────────────────────────────────────────────────────────── */

const T = {
  bg:         '#06080c',
  surface:    '#0b0f16',
  surfaceHi:  '#111720',
  border:     'rgba(255,255,255,0.07)',
  borderHi:   'rgba(255,255,255,0.14)',
  amber:      '#F0A500',
  amberDim:   'rgba(240,165,0,0.12)',
  green:      '#00C896',
  red:        '#E05252',
  pink:       '#D66E9A',
  blue:       '#4A9EFF',
  purple:     '#A855F7',
  textHi:     'rgba(255,255,255,0.90)',
  textMid:    'rgba(255,255,255,0.50)',
  textLo:     'rgba(255,255,255,0.25)',
  textGhost:  'rgba(255,255,255,0.12)',
  // aliases so existing references still resolve
  get elevated() { return this.surfaceHi; },
  get borderStr() { return this.borderHi; },
  get text()      { return this.textHi; },
  get label()     { return this.textMid; },
  get muted()     { return this.textLo; },
};

/* ─────────────────────────────────────────────────────────────────
   GLOBAL STYLES (injected once)
───────────────────────────────────────────────────────────────── */

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');

  .trm-root * {
    box-sizing: border-box;
    font-family: 'IBM Plex Mono', 'Fira Code', Consolas, monospace;
  }
  .trm-root {
    background: ${T.bg};
    color: ${T.textHi};
    min-height: 100vh;
  }

  /* ── Tab buttons ──────────────────────────── */
  .trm-tab {
    display: inline-flex;
    align-items: center;
    padding: 5px 14px;
    font-size: 10px;
    font-family: inherit;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border: 1px solid transparent;
    border-bottom: none;
    background: transparent;
    color: ${T.textMid};
    cursor: pointer;
    transition: color 120ms, border-color 120ms, background 120ms;
    border-radius: 0;
    user-select: none;
  }
  .trm-tab:hover { color: ${T.textHi}; background: rgba(255,255,255,0.03); }
  .trm-tab.active {
    color: ${T.amber};
    border-color: ${T.borderHi};
    background: ${T.surfaceHi};
    border-bottom: 1px solid ${T.surfaceHi};
    margin-bottom: -1px;
  }

  /* ── Toolbar toggle buttons ───────────────── */
  .trm-btn {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    font-size: 10px;
    font-family: inherit;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    border: 1px solid ${T.border};
    background: transparent;
    color: ${T.textMid};
    cursor: pointer;
    transition: all 120ms;
    border-radius: 0;
  }
  .trm-btn:hover { border-color: ${T.borderHi}; color: ${T.textHi}; }
  .trm-btn.active {
    border-color: ${T.amber};
    color: ${T.amber};
    background: ${T.amberDim};
  }
  .trm-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* ── Action button ────────────────────────── */
  .trm-action {
    display: inline-flex;
    align-items: center;
    padding: 5px 18px;
    font-size: 10px;
    font-family: inherit;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border: 1px solid ${T.amber};
    background: ${T.amberDim};
    color: ${T.amber};
    cursor: pointer;
    transition: background 120ms;
    border-radius: 0;
  }
  .trm-action:hover { background: rgba(240,165,0,0.20); }
  .trm-action:disabled { opacity: 0.3; cursor: not-allowed; }

  /* ── Panel / surface ──────────────────────── */
  .trm-panel {
    background: ${T.surface};
    border: 1px solid ${T.border};
  }
  .trm-panel-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    border-bottom: 1px solid ${T.border};
    background: ${T.surfaceHi};
  }
  .trm-panel-hdr-lbl {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${T.textMid};
  }

  /* ── Metric strip ─────────────────────────── */
  .trm-metric-strip {
    display: flex;
    border: 1px solid ${T.border};
    background: ${T.surface};
  }
  .trm-metric {
    flex: 1;
    padding: 10px 14px;
    border-right: 1px solid ${T.border};
    min-width: 0;
  }
  .trm-metric:last-child { border-right: none; }
  .trm-metric-lbl {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${T.textMid};
    margin-bottom: 4px;
    white-space: nowrap;
  }
  .trm-metric-val {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Table ────────────────────────────────── */
  .trm-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    letter-spacing: 0.02em;
  }
  .trm-table th {
    padding: 7px 10px;
    background: ${T.surfaceHi};
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${T.textMid};
    border-bottom: 1px solid ${T.borderHi};
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  .trm-table th:hover { color: ${T.textHi}; }
  .trm-table td {
    padding: 6px 10px;
    border-bottom: 1px solid ${T.border};
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .trm-table tr:hover td { background: rgba(255,255,255,0.025); }
  .trm-table tr.highlighted td { background: rgba(240,165,0,0.05); }

  /* ── Tab row ──────────────────────────────── */
  .trm-tab-row {
    display: flex;
    border-bottom: 1px solid ${T.borderHi};
    background: ${T.surface};
    overflow-x: auto;
  }

  /* ── Scrollbar ────────────────────────────── */
  .trm-root ::-webkit-scrollbar { width: 4px; height: 4px; }
  .trm-root ::-webkit-scrollbar-track { background: transparent; }
  .trm-root ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); }

  /* ── Delivery row bar ─────────────────────── */
  .del-row {
    position: relative;
    overflow: hidden;
    background: ${T.surface};
    border-bottom: 1px solid ${T.border};
    display: flex;
    align-items: center;
  }
  .del-row-bar {
    position: absolute;
    inset-y: 0;
    left: 0;
    opacity: 0.07;
    pointer-events: none;
  }
  .del-row-inner {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    padding: 7px 14px;
  }

  /* ── Empty / no data states ───────────────── */
  .trm-empty {
    padding: 40px 14px;
    font-size: 10px;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: ${T.textMid};
    text-align: center;
  }

  /* ── Loading overlay ──────────────────────── */
  .trm-loading {
    min-height: 260px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  /* ── Input focus states ───────────────────── */
  .trm-root input[type="date"]:focus,
  .trm-root input[type="text"]:focus,
  .trm-root select:focus {
    border-color: ${T.amber} !important;
    outline: none;
  }
`;

function StyleInjector() {
  useEffect(() => {
    const id = 'trm-styles';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
  }, []);
  return null;
}

/* ─────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────── */

const fmt = (n, dec = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });

const fmtInt = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const pctColor = (v) =>
  v > 0 ? T.green : v < 0 ? T.red : T.textLo;

/* ── Shared control-bar layout helpers — matches Futures.jsx exactly ── */
const rowStyle = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 0,
  borderBottom: `1px solid ${T.border}`,
  background: T.surface,
  flexShrink: 0,
};

const cellStyle = (extra = {}) => ({
  padding: '10px 16px',
  borderRight: `1px solid ${T.border}`,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 5,
  flexShrink: 0,
  ...extra,
});

const sectionLabel = (extra = {}) => ({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.textLo,
  ...extra,
});

const selectStyle = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.textHi,
  fontSize: 12,
  fontFamily: 'inherit',
  padding: '4px 28px 4px 10px',
  outline: 'none',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  height: 30,
  borderRadius: 0,
  cursor: 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
  boxSizing: 'border-box',
  minWidth: 160,
};

const dateInputStyle = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.textHi,
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '5px 8px',
  outline: 'none',
  letterSpacing: '0.03em',
  colorScheme: 'dark',
  width: 130,
  height: 30,
  borderRadius: 0,
  boxSizing: 'border-box',
};

const filterInputStyle = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.textHi,
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '5px 10px',
  outline: 'none',
  letterSpacing: '0.04em',
  height: 30,
  borderRadius: 0,
  boxSizing: 'border-box',
  width: 180,
};

/* Chevron-select wrapper */
function TermSelect({ value, onChange, children, style = {} }) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <select value={value} onChange={onChange} style={{ ...selectStyle, ...style }}>
        {children}
      </select>
      <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: T.textLo, pointerEvents: 'none' }}>▾</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   CHART TOOLTIP — terminal style
───────────────────────────────────────────────────────────────── */

function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.surfaceHi,
      border: `1px solid ${T.borderHi}`,
      padding: '8px 12px',
      fontSize: 10,
      letterSpacing: '0.08em',
      minWidth: 160,
    }}>
      <div style={{ color: T.textMid, marginBottom: 6, textTransform: 'uppercase', fontSize: 9 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.color, textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.10em' }}>{p.name}</span>
          <span style={{ color: T.textHi, fontWeight: 500 }}>
            {valueFormatter ? valueFormatter(p.value, p.name) : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   TAB ROW
───────────────────────────────────────────────────────────────── */

function TabRow({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: `1px solid ${T.borderHi}`,
      background: T.surface,
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '8px 18px',
            fontSize: 10,
            fontFamily: 'inherit',
            letterSpacing: '0.09em',
            fontWeight: active === key ? 700 : 400,
            color: active === key ? T.amber : T.textMid,
            background: active === key ? T.amberDim : 'transparent',
            border: 'none',
            borderBottom: active === key ? `2px solid ${T.amber}` : '2px solid transparent',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            textTransform: 'uppercase',
            transition: 'color 0.15s, background 0.15s',
            marginBottom: -1,
            borderRadius: 0,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   METRIC STRIP
───────────────────────────────────────────────────────────────── */

function MetricStrip({ items }) {
  return (
    <div style={{
      display: 'flex',
      width: '100%',
      border: `1px solid ${T.border}`,
      overflow: 'hidden',
    }}>
      {items.map(({ title, value, subtitle, accent = T.amber }) => (
        <MetricCard
          key={title}
          title={title}
          value={value}
          subtitle={subtitle}
          accent={accent}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   COMMON CHART AXES PROPS
───────────────────────────────────────────────────────────────── */

const axisStyle = {
  tick: { fill: T.textMid, fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' },
  axisLine: { stroke: T.border },
  tickLine: false,
};

/* ─────────────────────────────────────────────────────────────────
   OHLCV + DELIVERY VIEW
───────────────────────────────────────────────────────────────── */

function OHLCView({ tickers, dates }) {
  const [ticker,    setTicker]    = useState(tickers[0] ?? '');
  const [startDate, setStartDate] = useState(dates.at(-60) ?? '');
  const [endDate,   setEndDate]   = useState(dates.at(-1)  ?? '');
  const [data,      setData]      = useState([]);
  const [rollData,  setRollData]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [chartTab,  setChartTab]  = useState('price');
  // NOTE: showCandles / showAvg used to live here and were passed down to
  // CandlestickChart as props. They've moved into CandlestickChart itself
  // (along with the indicator toolbar), so this page no longer owns them.

  const load = useCallback(async () => {
    if (!ticker || !startDate || !endDate) return;
    setLoading(true);
    try {
      const d = await stocks.ohlc(ticker, startDate, endDate);
      setData(d);
      const rolling = await stocks.rolling(ticker, startDate, endDate);
      setRollData(rolling);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [ticker, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const latest = rollData.at(-1);

  const metrics = latest ? [
    { title: 'Last Traded Price',  value: formatCurrency(latest.close, 2),
      accent: T.amber },
    { title: 'Day Change %',       value: `${latest.daily_return > 0 ? '+' : ''}${fmt(latest.daily_return)}%`,
      accent: latest.daily_return >= 0 ? T.green : T.red },
    { title: 'Volume',             value: fmtInt(latest.volume),
      accent: T.blue },
    { title: 'Delivery %',         value: latest.delivery_pct != null ? `${fmt(latest.delivery_pct)}%` : '—',
      accent: latest.delivery_pct > 60 ? T.green : latest.delivery_pct > 40 ? T.amber : T.textLo },
    { title: 'Turnover (Cr)',      value: latest.turnover != null ? `₹${fmt(latest.turnover, 0)}` : '—',
      accent: T.textHi },
    { title: 'Relative Volume',    value: fmt(latest.rel_volume),
      accent: latest.rel_volume > 2 ? T.amber : T.textHi },
  ] : [];

  const chartTabs = [
    { key: 'price',    label: 'Price' },
    { key: 'delivery', label: 'Delivery %' },
    { key: 'volume',   label: 'Volume' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Control bar */}
      <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>
          {/* Ticker */}
          <div style={cellStyle({ minWidth: 220 })}>
            <span style={sectionLabel()}>Ticker</span>
            <TermSelect value={ticker || tickers[0]} onChange={(e) => setTicker(e.target.value)} style={{ minWidth: 190 }}>
              {tickers.map((t) => <option key={t} value={t} style={{ background: T.surface }}>{t}</option>)}
            </TermSelect>
          </div>
          {/* Date range */}
          <div style={cellStyle({})}>
            <span style={sectionLabel()}>Date Range</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={dateInputStyle} />
              <span style={{ color: T.textLo, fontSize: 10 }}>→</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={dateInputStyle} />
            </div>
          </div>
          {/* Load + status */}
          <div style={{ ...cellStyle({ borderRight: 'none', marginLeft: 'auto' }), flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <button
              onClick={load}
              disabled={!ticker || loading}
              style={{
                padding: '4px 18px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                border: `1px solid ${T.amber}`,
                background: T.amberDim,
                color: T.amber,
                cursor: (!ticker || loading) ? 'not-allowed' : 'pointer',
                opacity: (!ticker || loading) ? 0.4 : 1,
                transition: 'background 0.15s',
                borderRadius: 0,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? 'Loading…' : 'Load'}
            </button>
            {data.length > 0 && (
              <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.10em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {data.length} sessions
              </span>
            )}
          </div>
      </div>

      {/* Metric strip */}
      {metrics.length > 0 && (
        <div style={{ marginTop: 1 }}>
          <MetricStrip items={metrics} />
        </div>
      )}

      {/* Chart panel */}
      {loading && (
        <div className="trm-panel trm-loading"><LoadingSpinner /></div>
      )}

      {!loading && data.length > 0 && (
        <div style={{ border: `1px solid ${T.border}`, borderTop: 'none' }}>
          {/* Black header bar: ticker context left, tabs centre */}
          <div style={{
            background: T.bg,
            borderBottom: `1px solid ${T.borderHi}`,
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'space-between',
          }}>
            {/* Ticker + exchange badge */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10, borderRight: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: T.textHi }}>{ticker}</span>
              <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.12em', textTransform: 'uppercase' }}>NSE · EQ</span>
            </div>

            {/* Chart tabs — centre */}
            <div style={{ display: 'flex', flex: 1 }}>
              {chartTabs.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setChartTab(key)}
                  style={{
                    padding: '9px 20px',
                    fontSize: 10,
                    fontFamily: 'inherit',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    background: chartTab === key ? T.surfaceHi : 'transparent',
                    color: chartTab === key ? T.amber : T.textMid,
                    border: 'none',
                    borderRight: `1px solid ${T.border}`,
                    borderBottom: chartTab === key ? `2px solid ${T.amber}` : '2px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 120ms',
                  }}
                >
                  {label}
                </button>
              ))}
              <div style={{ flex: 1 }} /> {/* spacer */}
            </div>
          </div>

          {/* Chart body */}
          <div style={{ background: T.surface, padding: '14px 14px 10px' }}>
            {chartTab === 'price' && (
              <CandlestickChart
                data={data}
                formatCurrency={formatCurrency}
              />
            )}

            {chartTab === 'delivery' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                    <XAxis dataKey="trade_date" {...axisStyle} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" />
                    <YAxis {...axisStyle} tickFormatter={(v) => `${v}%`} width={40} />
                    <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v)}%`} />} />
                    <Bar dataKey="delivery_pct" name="Del %" maxBarSize={12}>
                      {data.map((row, i) => (
                        <Cell key={i} fill={row.delivery_pct > 60 ? T.green : row.delivery_pct > 40 ? T.amber : T.textLo} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textMid, paddingLeft: 4 }}>
                  MA5 / MA20 — Delivery % Moving Averages
                </div>
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                    <XAxis dataKey="trade_date" {...axisStyle} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" />
                    <YAxis {...axisStyle} tickFormatter={(v) => `${v}%`} width={40} />
                    <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v)}%`} />} />
                    <Line dataKey="delivery_pct_ma5"  name="MA5"  stroke={T.blue}  dot={false} strokeWidth={1.5} />
                    <Line dataKey="delivery_pct_ma20" name="MA20" stroke={T.amber} dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {chartTab === 'volume' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                    <XAxis dataKey="trade_date" {...axisStyle} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" />
                    <YAxis {...axisStyle} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} width={48} />
                    <Tooltip content={<ChartTooltip valueFormatter={(v) => fmtInt(v)} />} />
                    <Bar dataKey="volume" name="Volume" maxBarSize={10}>
                      {data.map((row, i) => (
                        <Cell key={i} fill={row.rel_volume > 2 ? T.amber : row.rel_volume > 1.5 ? T.blue : T.textLo} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textMid, paddingLeft: 4 }}>
                  Relative Volume — vs 20-day average
                </div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                    <XAxis dataKey="trade_date" {...axisStyle} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" />
                    <YAxis {...axisStyle} width={40} />
                    <ReferenceLine y={1} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
                    <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v)} />} />
                    <Line dataKey="rel_volume" name="Rel Vol" stroke={T.pink} dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && data.length === 0 && ticker && (
        <div className="trm-panel trm-empty">No data for selected range</div>
      )}
      {!ticker && (
        <div className="trm-panel trm-empty">Select ticker to load chart data</div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   SCREENER VIEW
───────────────────────────────────────────────────────────────── */

function ScreenerView({ dates }) {
  const [tradeDate, setTradeDate] = useState(dates.at(-1) ?? '');
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [sortKey,   setSortKey]   = useState('pct_change');
  const [sortDir,   setSortDir]   = useState(-1);
  const [filter,    setFilter]    = useState('');

  const load = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try {
      const d = await stocks.snapshot(tradeDate, 500);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(-1); }
  };

  const displayed = useMemo(() =>
    [...data]
      .filter((r) => !filter || r.ticker.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => {
        const av = a[sortKey] ?? -Infinity;
        const bv = b[sortKey] ?? -Infinity;
        return (av - bv) * sortDir;
      })
      .slice(0, 150),
  [data, filter, sortKey, sortDir]);

  const cols = [
    { key: 'ticker',       label: 'Ticker',     align: 'left',
      render: (v) => <span style={{ color: T.amber, fontWeight: 600 }}>{v}</span> },
    { key: 'close',        label: 'LTP',        align: 'right',
      render: (v) => <span style={{ color: T.textHi }}>{formatCurrency(v, 2)}</span> },
    { key: 'pct_change',   label: 'Chg %',      align: 'right',
      render: (v) => <span style={{ color: pctColor(v) }}>{v > 0 ? '+' : ''}{fmt(v)}%</span> },
    { key: 'volume',       label: 'Volume',     align: 'right',
      render: (v) => fmtInt(v) },
    { key: 'turnover',     label: 'TO (Cr)',    align: 'right',
      render: (v) => fmt(v, 1) },
    { key: 'delivery_pct', label: 'Del %',      align: 'right',
      render: (v) => v != null
        ? <span style={{ color: v > 60 ? T.green : v > 40 ? T.amber : T.textHi }}>{fmt(v)}%</span>
        : '—' },
    { key: 'trade_count',  label: 'Trades',     align: 'right',
      render: (v) => fmtInt(v) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>
          {/* Date */}
          <div style={cellStyle({ minWidth: 200 })}>
            <span style={sectionLabel()}>Date</span>
            <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} style={dateInputStyle} />
          </div>
          {/* Filter */}
          <div style={cellStyle({})}>
            <span style={sectionLabel()}>Filter Ticker</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search…"
              style={filterInputStyle}
            />
          </div>
          {/* Row count */}
          <div style={{ ...cellStyle({ borderRight: 'none', marginLeft: 'auto' }), flexDirection: 'row', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {displayed.length} instruments
            </span>
          </div>
      </div>

      {loading ? (
        <div className="trm-panel trm-loading"><LoadingSpinner /></div>
      ) : (
        <div className="trm-panel" style={{ overflowX: 'auto' }}>
          <table className="trm-table">
            <thead>
              <tr>
                {cols.map(({ key, label, align }) => (
                  <th key={key} onClick={() => handleSort(key)} style={{ textAlign: align }}>
                    {label}{sortKey === key ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((row, i) => (
                <tr key={row.ticker + i} className={row.delivery_pct > 70 ? 'highlighted' : ''}>
                  {cols.map(({ key, align, render }) => (
                    <td key={key} style={{ textAlign: align }}>
                      {render(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DELIVERY LEADERS VIEW
───────────────────────────────────────────────────────────────── */

function DeliveryView({ dates }) {
  const [tradeDate, setTradeDate] = useState(dates.at(-1) ?? '');
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(false);

  const load = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try {
      const d = await stocks.deliveryLeaders(tradeDate, 50);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>
          {/* Date */}
          <div style={cellStyle({ minWidth: 200 })}>
            <span style={sectionLabel()}>Date</span>
            <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} style={dateInputStyle} />
          </div>
          {/* Context label */}
          <div style={{ ...cellStyle({ borderRight: 'none', flex: 1 }), flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
              Top 50 by delivery % · Institutional conviction signal
            </span>
          </div>
      </div>

      {loading ? (
        <div className="trm-panel trm-loading"><LoadingSpinner /></div>
      ) : (
        <div className="trm-panel" style={{ overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '32px 120px 1fr 80px 110px 80px',
            padding: '6px 14px',
            background: T.surfaceHi,
            borderBottom: `1px solid ${T.borderHi}`,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: T.textHi,
          }}>
            <span>#</span>
            <span>Ticker</span>
            <span>Name</span>
            <span style={{ textAlign: 'right' }}>Chg %</span>
            <span style={{ textAlign: 'right' }}>LTP</span>
            <span style={{ textAlign: 'right' }}>Del %</span>
          </div>

          {data.map((row, i) => {
            const barPct = Math.min(Math.max(row.delivery_pct ?? 0, 2), 100);
            const barColor = row.delivery_pct > 70 ? T.green : row.delivery_pct > 50 ? T.amber : T.blue;
            return (
              <div key={row.ticker} className="del-row">
                <div className="del-row-bar" style={{ width: `${barPct}%`, backgroundColor: barColor }} />
                <div className="del-row-inner" style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 120px 1fr 80px 110px 80px',
                }}>
                  <span style={{ fontSize: 9, color: T.textMid, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                  <span style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>{row.ticker}</span>
                  <span style={{ fontSize: 9, color: T.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.instrument_name}
                  </span>
                  <span style={{ fontSize: 11, color: pctColor(row.pct_change), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.pct_change > 0 ? '+' : ''}{fmt(row.pct_change)}%
                  </span>
                  <span style={{ fontSize: 11, color: T.textHi, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(row.close, 2)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: barColor, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.delivery_pct)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

export default function Stocks() {
  const [tickers, setTickers] = useState([]);
  const [dates,   setDates]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState('ohlc');

  useEffect(() => {
    (async () => {
      try {
        const [t, d] = await Promise.all([stocks.tickers(), stocks.dates()]);
        setTickers(t);
        setDates(d);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div className="trm-root" style={{ height: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <StyleInjector />
      <LoadingSpinner size="lg" />
    </div>
  );

  const views = [
    { key: 'ohlc',     label: 'OHLCV + Delivery' },
    { key: 'screener', label: 'Screener' },
    { key: 'delivery', label: 'Delivery Leaders' },
  ];

  return (
    <div className="trm-root" style={{ padding: '0' }}>
      <StyleInjector />

      {/* ── PAGE HEADER — matches Futures.jsx ── */}
      <div style={{
        padding: '8px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: T.surface,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 16,
          fontWeight: 700,
          color: T.textHi,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          EQ Stocks
        </span>
        <span style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          color: T.textLo,
          textTransform: 'uppercase',
          borderLeft: `1px solid ${T.border}`,
          paddingLeft: 16,
        }}>
          NSE · Cash Market
        </span>
        <span style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          color: T.textLo,
          textTransform: 'uppercase',
        }}>
          {tickers.length} tickers · {dates.length} sessions
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: T.green,
            boxShadow: `0 0 6px ${T.green}`,
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 9, letterSpacing: '0.12em', color: T.textLo, textTransform: 'uppercase' }}>
            {dates.at(-1)}
          </span>
        </div>
      </div>

      {/* ── VIEW TAB ROW ── */}
      <TabRow tabs={views} active={view} onChange={setView} />

      {/* ── CONTENT — no outer padding, views own their own spacing ── */}
      <main style={{ flex: 1, padding: '16px 20px', overflowX: 'hidden' }}>
        {view === 'ohlc'     && <OHLCView     tickers={tickers} dates={dates} />}
        {view === 'screener' && <ScreenerView dates={dates} />}
        {view === 'delivery' && <DeliveryView dates={dates} />}
      </main>
    </div>
  );
}
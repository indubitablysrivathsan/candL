// frontend/src/pages/Market.jsx
// Rewritten: correct field names, split gainers/losers, refined terminal-data aesthetic

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
  AreaChart, Area,
} from 'recharts';

import MetricCard     from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import {
  participant, fii, volatility, market, research,
} from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   DESIGN TOKENS
───────────────────────────────────────────────────────────────── */

const T = {
  bg:        '#0a0d12',
  surface:   '#0f1318',
  elevated:  '#141820',
  border:    'rgba(255,255,255,0.07)',
  borderMid: 'rgba(255,255,255,0.12)',

  cyan:   '#00c8ff',
  green:  '#00e5a0',
  red:    '#ff4d6a',
  amber:  '#ffb340',
  purple: '#a78bfa',
  slate:  'rgba(255,255,255,0.22)',

  text:    '#e8edf5',
  textMid: 'rgba(232,237,245,0.55)',
  textDim: 'rgba(232,237,245,0.28)',
};

/* ─────────────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────────────── */

const fmt = (n, dec = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });

const fmtInt = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const pctColor = (v) => v > 0 ? T.green : v < 0 ? T.red : T.slate;
const pctSign  = (v) => v > 0 ? '+' : '';

function defaultRange(allDates, months = 3) {
  if (!allDates?.length) return { start: '', end: '' };
  const end   = allDates.at(-1);
  const start = allDates.at(-(months * 22)) ?? allDates[0];
  return { start, end };
}

/* ─────────────────────────────────────────────────────────────────
   SHARED UI COMPONENTS
───────────────────────────────────────────────────────────────── */

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: '2px', marginBottom: '24px',
      background: T.surface, borderRadius: '10px', padding: '3px',
      border: `1px solid ${T.border}`, overflowX: 'auto',
    }}>
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '7px 16px', borderRadius: '7px', fontSize: '12px',
            fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
            border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            transition: 'all 0.15s',
            background: active === key ? T.elevated : 'transparent',
            color:      active === key ? T.cyan     : T.textDim,
            boxShadow:  active === key ? `0 0 0 1px ${T.border}` : 'none',
            letterSpacing: '0.02em',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SubTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '6px', marginBottom: '18px', overflowX: 'auto' }}>
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '4px 12px', borderRadius: '5px', fontSize: '11px',
            fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
            border: `1px solid ${active === key ? T.cyan + '44' : T.border}`,
            cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
            background: active === key ? T.cyan + '12' : 'transparent',
            color:      active === key ? T.cyan         : T.textDim,
            letterSpacing: '0.03em',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, badge, children }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: '12px', overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 20px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <span style={{ width: '3px', height: '16px', background: T.cyan, borderRadius: '2px', flexShrink: 0 }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: T.text, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.03em' }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontSize: '10px', color: T.textDim, background: T.elevated,
            padding: '2px 8px', borderRadius: '4px', border: `1px solid ${T.border}`,
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: '20px' }}>{children}</div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div style={{
      background: T.elevated, border: `1px solid ${T.border}`,
      borderRadius: '8px', padding: '14px 16px',
      borderTop: `2px solid ${accent || T.cyan}`,
    }}>
      <div style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: T.text, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '11px', color: T.textMid, marginTop: '4px', fontFamily: "'IBM Plex Mono', monospace" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function DateSelect({ label, dates, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {label && <span style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px',
          color: T.text, fontSize: '12px', padding: '5px 10px',
          fontFamily: "'IBM Plex Mono', monospace", cursor: 'pointer', outline: 'none',
        }}
      >
        {[...dates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

function RangeBar({ allDates, start, end, onStart, onEnd }) {
  const presets = [{ l: '1M', m: 1 }, { l: '3M', m: 3 }, { l: '6M', m: 6 }, { l: '1Y', m: 12 }];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        {presets.map(({ l, m }) => (
          <button
            key={l}
            onClick={() => { const r = defaultRange(allDates, m); onStart(r.start); onEnd(r.end); }}
            style={{
              padding: '4px 10px', borderRadius: '5px', fontSize: '11px',
              fontFamily: "'IBM Plex Mono', monospace",
              border: `1px solid ${T.border}`, background: T.elevated,
              color: T.textMid, cursor: 'pointer', transition: 'all 0.12s',
            }}
            onMouseEnter={(e) => { e.target.style.borderColor = T.cyan + '55'; e.target.style.color = T.text; }}
            onMouseLeave={(e) => { e.target.style.borderColor = T.border; e.target.style.color = T.textMid; }}
          >
            {l}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input type="date" value={start} onChange={(e) => onStart(e.target.value)}
          style={{ background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px', color: T.text, fontSize: '11px', padding: '4px 8px', fontFamily: "'IBM Plex Mono', monospace", outline: 'none' }}
        />
        <span style={{ color: T.textDim, fontSize: '11px' }}>→</span>
        <input type="date" value={end} onChange={(e) => onEnd(e.target.value)}
          style={{ background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px', color: T.text, fontSize: '11px', padding: '4px 8px', fontFamily: "'IBM Plex Mono', monospace", outline: 'none' }}
        />
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, valFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0a0d12ee', border: `1px solid ${T.borderMid}`,
      borderRadius: '8px', padding: '10px 14px', minWidth: '160px',
      backdropFilter: 'blur(8px)',
    }}>
      <p style={{ fontSize: '10px', color: T.textDim, marginBottom: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>{label}</p>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontSize: '12px', marginBottom: '3px', fontFamily: "'IBM Plex Mono', monospace" }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ color: T.text, fontWeight: 600 }}>
            {valFmt ? valFmt(p.value, p.name) : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

const AXIS = {
  tick: { fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" },
  axisLine: { stroke: 'rgba(255,255,255,0.06)' },
  grid: { strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.05)' },
};

function Empty({ msg = 'No data available.' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
      {msg}
    </div>
  );
}

function Loader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
      <LoadingSpinner />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DATA TABLE (reusable)
───────────────────────────────────────────────────────────────── */

function DataTable({ columns, rows, maxHeight = 480, rowKey }) {
  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: '8px', overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto', maxHeight }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace" }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: T.elevated, zIndex: 1 }}>
              {columns.map((col) => (
                <th key={col.key} style={{
                  padding: '9px 12px', textAlign: col.align || 'right',
                  color: T.textDim, fontWeight: 500, fontSize: '10px',
                  letterSpacing: '0.07em', textTransform: 'uppercase',
                  borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap',
                }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey ? (row[rowKey] ?? i) : i} style={{
                borderBottom: `1px solid ${T.border}`,
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = T.elevated}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {columns.map((col) => (
                  <td key={col.key} style={{
                    padding: '8px 12px', textAlign: col.align || 'right',
                    color: col.color ? col.color(row) : T.textMid,
                    whiteSpace: 'nowrap',
                  }}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   INDICES SECTION
───────────────────────────────────────────────────────────────── */

function IndexSnapshot({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (marketDates.length) setTradeDate(marketDates.at(-1));
  }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.indexSnapshot(tradeDate)
      .then(setData).catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  return (
    <>
      <div style={{ marginBottom: '18px' }}>
        <DateSelect label="Date" dates={marketDates} value={tradeDate} onChange={setTradeDate} />
      </div>
      {loading ? <Loader /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
          {data.map((idx) => (
            <Kpi
              key={idx.index_name}
              label={idx.index_name}
              value={fmt(idx.close, 2)}
              sub={
                <span style={{ color: pctColor(idx.pct_change) }}>
                  {pctSign(idx.pct_change)}{fmt(idx.pct_change)}%
                  <span style={{ color: T.textDim, marginLeft: '6px' }}>
                    ({pctSign(idx.gain_loss)}{fmt(idx.gain_loss, 1)})
                  </span>
                </span>
              }
              accent={idx.pct_change > 0 ? T.green : idx.pct_change < 0 ? T.red : T.slate}
            />
          ))}
        </div>
      )}
    </>
  );
}

function IndexHistory({ marketDates }) {
  const [indexNames, setIndexNames] = useState([]);
  const [selected, setSelected]     = useState('');
  const [start, setStart]           = useState('');
  const [end, setEnd]               = useState('');
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    market.indexNames().then((n) => { setIndexNames(n); if (n.length) setSelected(n[0]); }).catch(console.error);
    const r = defaultRange(marketDates, 6);
    setStart(r.start); setEnd(r.end);
  }, [marketDates]);

  const load = useCallback(async () => {
    if (!selected || !start || !end) return;
    setLoading(true);
    try { setData(await market.indexHistory(selected, start, end)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [selected, start, end]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '18px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em' }}>Index</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            style={{ background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px', color: T.text, fontSize: '12px', padding: '5px 10px', fontFamily: "'IBM Plex Mono', monospace", outline: 'none', cursor: 'pointer' }}>
            {indexNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <RangeBar allDates={marketDates} start={start} end={end} onStart={setStart} onEnd={setEnd} />
      </div>

      {loading ? <Loader /> : data.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cyanGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.cyan} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={T.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...AXIS.grid} />
              <XAxis dataKey="trade_date" {...AXIS.tick} tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
              <YAxis {...AXIS.tick} tick={AXIS.tick} tickFormatter={(v) => fmtInt(v)} width={64} tickLine={false} axisLine={AXIS.axisLine} />
              <Tooltip content={<ChartTip valFmt={(v) => fmt(v, 2)} />} />
              <Area dataKey="close" name="Close" stroke={T.cyan} fill="url(#cyanGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>

          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...AXIS.grid} />
              <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
              <YAxis tick={AXIS.tick} tickFormatter={(v) => `${fmt(v, 1)}%`} width={52} tickLine={false} axisLine={AXIS.axisLine} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTip valFmt={(v) => `${fmt(v, 2)}%`} />} />
              <Bar dataKey="pct_change" name="Change %" radius={[2, 2, 0, 0]}>
                {data.map((row, i) => <Cell key={i} fill={row.pct_change >= 0 ? T.green : T.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty />}
    </>
  );
}

function IndicesSection({ marketDates }) {
  const [sub, setSub] = useState('snapshot');
  return (
    <Panel title="Indices" badge="NSE · OHLC">
      <SubTabs tabs={[{ key: 'snapshot', label: 'Snapshot' }, { key: 'history', label: 'History' }]} active={sub} onChange={setSub} />
      {sub === 'snapshot' && <IndexSnapshot marketDates={marketDates} />}
      {sub === 'history'  && <IndexHistory  marketDates={marketDates} />}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────
   BREADTH SECTION
───────────────────────────────────────────────────────────────── */

function BreadthSection({ marketDates }) {
  const [sub, setSub]         = useState('history');
  const [start, setStart]     = useState('');
  const [end, setEnd]         = useState('');
  const [data, setData]       = useState([]);
  const [snap, setSnap]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const r = defaultRange(marketDates, 3);
    setStart(r.start); setEnd(r.end);
  }, [marketDates]);

  const loadHistory = useCallback(async () => {
    if (!start || !end) return;
    setLoading(true);
    try { setData(await market.breadth(start, end)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [start, end]);

  const loadSnap = useCallback(async () => {
    if (!marketDates.length) return;
    setLoading(true);
    try { setSnap(await market.breadthSnapshot(marketDates.at(-1))); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [marketDates]);

  useEffect(() => { if (sub === 'history')  loadHistory(); }, [sub, loadHistory]);
  useEffect(() => { if (sub === 'snapshot') loadSnap(); },   [sub, loadSnap]);

  return (
    <Panel title="Market Breadth" badge="Advances · Declines · A/D Ratio">
      <SubTabs tabs={[{ key: 'history', label: 'History' }, { key: 'snapshot', label: 'Snapshot' }]} active={sub} onChange={setSub} />

      {sub === 'snapshot' && (
        loading ? <Loader /> : snap ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            <Kpi label="Advances"        value={fmtInt(snap.advances)}        accent={T.green} />
            <Kpi label="Declines"        value={fmtInt(snap.declines)}        accent={T.red}   />
            <Kpi label="Unchanged"       value={fmtInt(snap.unchanged)}       accent={T.slate} />
            <Kpi label="Price Band Hits" value={fmtInt(snap.price_band_hits)} accent={T.amber} />
            {snap.advances != null && snap.declines != null && (
              <Kpi
                label="A/D Ratio"
                value={((snap.advances / (snap.advances + snap.declines)) || 0).toFixed(3)}
                accent={snap.advances > snap.declines ? T.green : T.red}
              />
            )}
          </div>
        ) : <Empty />
      )}

      {sub === 'history' && (
        <>
          <div style={{ marginBottom: '18px' }}>
            <RangeBar allDates={marketDates} start={start} end={end} onStart={setStart} onEnd={setEnd} />
          </div>
          {loading ? <Loader /> : data.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
                Advances vs Declines
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...AXIS.grid} />
                  <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
                  <YAxis tick={AXIS.tick} width={48} tickLine={false} axisLine={AXIS.axisLine} />
                  <Tooltip content={<ChartTip valFmt={(v) => fmtInt(v)} />} />
                  <Legend formatter={(v) => <span style={{ color: T.textDim, fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace" }}>{v}</span>} />
                  <Bar dataKey="advances" name="Advances" stackId="a" fill={T.green}  radius={[2, 2, 0, 0]} />
                  <Bar dataKey="declines" name="Declines" stackId="a" fill={T.red}    />
                </BarChart>
              </ResponsiveContainer>

              <p style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '8px', marginBottom: '4px' }}>
                A/D Ratio
              </p>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...AXIS.grid} />
                  <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
                  <YAxis tick={AXIS.tick} tickFormatter={(v) => fmt(v, 2)} width={48} tickLine={false} axisLine={AXIS.axisLine} domain={[0, 1]} />
                  <ReferenceLine y={0.5} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
                  <Tooltip content={<ChartTip valFmt={(v) => fmt(v, 3)} />} />
                  <Line dataKey="ad_ratio" name="A/D Ratio" stroke={T.cyan} dot={false} strokeWidth={1.8} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
        </>
      )}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────
   TOP STOCKS — 3 separate tabs, each with correct API call
   DB columns: trade_date, ticker, series, prev_close, open, high,
               low, close, volume, turnover, trade_count, pct_change
   gainers-losers also returns: buy_amount_cr (not present — only above)
───────────────────────────────────────────────────────────────── */

function TopByValue({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (marketDates.length) setTradeDate(marketDates.at(-1));
  }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    // Correct call: options object with series and limit
    market.topStocks(tradeDate, { series: 'EQ', limit: 25 })
      .then(setData).catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const columns = [
    { key: '_rank',     label: '#',         align: 'left',  render: (r) => r._rank, color: () => T.textDim },
    { key: 'ticker',    label: 'Symbol',    align: 'left',  color: () => T.text,     render: (r) => <strong style={{ color: T.text }}>{r.ticker}</strong> },
    { key: 'series',    label: 'Series',    align: 'left',  color: () => T.textDim   },
    { key: 'close',     label: 'Close',     align: 'right', render: (r) => fmt(r.close, 2) },
    { key: 'prev_close',label: 'Prev',      align: 'right', render: (r) => fmt(r.prev_close, 2), color: () => T.textDim },
    { key: 'pct_change',label: 'Chg %',     align: 'right',
      render: (r) => <span style={{ color: pctColor(r.pct_change), fontWeight: 600 }}>{pctSign(r.pct_change)}{fmt(r.pct_change)}%</span>
    },
    { key: 'turnover',  label: 'Value (Cr)',align: 'right', render: (r) => fmt(r.turnover, 1), color: () => T.textMid },
    { key: 'volume',    label: 'Volume',    align: 'right', render: (r) => fmtInt(r.volume), color: () => T.textDim },
  ];

  // Fix: render needs index; pass via row._rank trick
  const rows = data.map((r, i) => ({ ...r, _rank: i + 1 }));

  return (
    <>
      <div style={{ marginBottom: '16px' }}>
        <DateSelect label="Date" dates={marketDates} value={tradeDate} onChange={setTradeDate} />
      </div>
      {loading ? <Loader /> : data.length > 0 ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="ticker"
          maxHeight={520}
        />
      ) : <Empty />}
    </>
  );
}

function GainersLosers({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [gainers, setGainers]     = useState([]);
  const [losers, setLosers]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [side, setSide]           = useState('gainers');

  useEffect(() => {
    if (marketDates.length) setTradeDate(marketDates.at(-1));
  }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    // Correct call: separate endpoint, returns { gainers, losers }
    market.topGainersLosers(tradeDate, { series: 'EQ', limit: 15, minTurnover: 100 })
      .then((res) => {
        setGainers(res.gainers || []);
        setLosers(res.losers  || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tradeDate]);

  // DB columns: trade_date, ticker, series, prev_close, close, turnover, volume, pct_change
  const columns = [
    { key: '_rank',     label: '#',      align: 'left',  render: (r) => r._rank, color: () => T.textDim },
    { key: 'ticker',    label: 'Symbol', align: 'left',  render: (r) => <strong style={{ color: T.text }}>{r.ticker}</strong> },
    { key: 'prev_close',label: 'Prev',   align: 'right', render: (r) => fmt(r.prev_close, 2), color: () => T.textDim },
    { key: 'close',     label: 'Close',  align: 'right', render: (r) => fmt(r.close, 2),      color: () => T.text },
    { key: 'pct_change',label: 'Chg %',  align: 'right',
      render: (r) => (
        <span style={{ color: pctColor(r.pct_change), fontWeight: 700, fontSize: '13px' }}>
          {pctSign(r.pct_change)}{fmt(r.pct_change)}%
        </span>
      ),
    },
    { key: 'turnover', label: 'Value (Cr)', align: 'right', render: (r) => fmt(r.turnover, 1), color: () => T.textDim },
  ];

  const rows = (side === 'gainers' ? gainers : losers).map((r, i) => ({ ...r, _rank: i + 1 }));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <DateSelect label="Date" dates={marketDates} value={tradeDate} onChange={setTradeDate} />
        <div style={{ display: 'flex', gap: '4px' }}>
          {['gainers', 'losers'].map((s) => (
            <button key={s} onClick={() => setSide(s)} style={{
              padding: '5px 14px', borderRadius: '6px', fontSize: '11px',
              fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
              border: `1px solid ${side === s ? (s === 'gainers' ? T.green : T.red) + '55' : T.border}`,
              background: side === s ? (s === 'gainers' ? T.green : T.red) + '15' : 'transparent',
              color: side === s ? (s === 'gainers' ? T.green : T.red) : T.textDim,
              cursor: 'pointer', transition: 'all 0.15s', textTransform: 'capitalize',
            }}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {loading ? <Loader /> : rows.length > 0 ? (
        <DataTable columns={columns} rows={rows} rowKey="ticker" maxHeight={520} />
      ) : <Empty msg={`No ${side} data for selected date.`} />}
    </>
  );
}

function TopStocksSection({ marketDates }) {
  const [sub, setSub] = useState('value');
  return (
    <Panel title="Top Stocks" badge="NSE · EQ Series">
      <SubTabs
        tabs={[
          { key: 'value',   label: 'Top 25 by Value' },
          { key: 'movers',  label: 'Gainers / Losers' },
        ]}
        active={sub}
        onChange={setSub}
      />
      {sub === 'value'  && <TopByValue    marketDates={marketDates} />}
      {sub === 'movers' && <GainersLosers marketDates={marketDates} />}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────
   SECURITIES SECTION
   DB cols (snapshot & history): trade_date, ticker, series,
   prev_close, open, high, low, close, avg_price, volume, turnover,
   trade_count, delivery_qty, delivery_pct, pct_change
───────────────────────────────────────────────────────────────── */

function SecuritiesSection({ marketDates }) {
  const [sub, setSub]           = useState('snapshot');
  const [series, setSeries]     = useState('EQ');
  const [tradeDate, setDate]    = useState('');
  const [symbol, setSymbol]     = useState('');
  const [start, setStart]       = useState('');
  const [end, setEnd]           = useState('');
  const [snapData, setSnapData] = useState([]);
  const [histData, setHistData] = useState([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (marketDates.length) setDate(marketDates.at(-1));
    const r = defaultRange(marketDates, 3);
    setStart(r.start); setEnd(r.end);
  }, [marketDates]);

  const loadSnap = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try {
      // Correct: series as option, field names match DB
      setSnapData(await market.securitySnapshot(tradeDate, { series: series || 'EQ' }));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate, series]);

  const loadHist = useCallback(async () => {
    if (!symbol.trim() || !start || !end) return;
    setLoading(true);
    try {
      // Correct endpoint: /market/security/{symbol}?series=EQ&start_date=...&end_date=...
      setHistData(await market.securityHistory(symbol.trim(), start, end, series || 'EQ'));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [symbol, start, end, series]);

  useEffect(() => { if (sub === 'snapshot') loadSnap(); }, [sub, loadSnap]);

  // Snapshot columns — correct field names from DB
  const snapCols = [
    { key: 'ticker',       label: 'Symbol',     align: 'left',  render: (r) => <strong style={{ color: T.text }}>{r.ticker}</strong> },
    { key: 'series',       label: 'Series',     align: 'left',  color: () => T.textDim },
    { key: 'close',        label: 'Close',      align: 'right', render: (r) => fmt(r.close, 2),    color: () => T.text },
    { key: 'pct_change',   label: 'Chg %',      align: 'right',
      render: (r) => <span style={{ color: pctColor(r.pct_change) }}>{pctSign(r.pct_change)}{fmt(r.pct_change)}%</span>
    },
    { key: 'turnover',     label: 'Turnover (Cr)', align: 'right', render: (r) => fmt(r.turnover, 1), color: () => T.textMid },
    { key: 'volume',       label: 'Volume',     align: 'right', render: (r) => fmtInt(r.volume),   color: () => T.textDim },
    { key: 'delivery_pct', label: 'Del %',      align: 'right', render: (r) => r.delivery_pct != null ? `${fmt(r.delivery_pct, 1)}%` : '—', color: () => T.textDim },
  ];

  return (
    <Panel title="Securities" badge="NSE · Daily Data">
      <SubTabs
        tabs={[{ key: 'snapshot', label: 'Daily Snapshot' }, { key: 'history', label: 'Symbol History' }]}
        active={sub}
        onChange={setSub}
      />

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em' }}>Series</span>
          <select value={series} onChange={(e) => setSeries(e.target.value)}
            style={{ background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px', color: T.text, fontSize: '12px', padding: '5px 10px', fontFamily: "'IBM Plex Mono', monospace", outline: 'none', cursor: 'pointer' }}>
            {['EQ', 'BE', 'BZ', 'SM', 'ST'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {sub === 'snapshot' && (
          <DateSelect label="Date" dates={marketDates} value={tradeDate} onChange={setDate} />
        )}

        {sub === 'history' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em' }}>Symbol</span>
              <input
                type="text"
                value={symbol}
                placeholder="e.g. HDFCBANK"
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                style={{ background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px', color: T.text, fontSize: '12px', padding: '5px 10px', fontFamily: "'IBM Plex Mono', monospace", width: '140px', outline: 'none' }}
              />
            </div>
            <RangeBar allDates={marketDates} start={start} end={end} onStart={setStart} onEnd={setEnd} />
            <button onClick={loadHist} style={{
              padding: '6px 16px', borderRadius: '6px', fontSize: '11px',
              fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600,
              border: `1px solid ${T.cyan}55`, background: T.cyan + '18',
              color: T.cyan, cursor: 'pointer', letterSpacing: '0.05em',
            }}>
              LOAD
            </button>
          </>
        )}
      </div>

      {sub === 'snapshot' && (
        loading ? <Loader /> : snapData.length > 0 ? (
          <DataTable columns={snapCols} rows={snapData} rowKey="ticker" maxHeight={520} />
        ) : <Empty />
      )}

      {sub === 'history' && (
        loading ? <Loader /> : histData.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Price chart — correct field: close */}
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={histData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={T.purple} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={T.purple} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...AXIS.grid} />
                <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
                <YAxis tick={AXIS.tick} tickFormatter={(v) => fmt(v, 0)} width={64} tickLine={false} axisLine={AXIS.axisLine} />
                <Tooltip content={<ChartTip valFmt={(v) => fmt(v, 2)} />} />
                {/* Correct field name: close (not close_price) */}
                <Area dataKey="close" name="Close" stroke={T.purple} fill="url(#priceGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            {/* Turnover chart — correct field: turnover (not traded_value_rs) */}
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={histData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...AXIS.grid} />
                <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
                <YAxis tick={AXIS.tick} tickFormatter={(v) => `${fmt(v, 0)}Cr`} width={60} tickLine={false} axisLine={AXIS.axisLine} />
                <Tooltip content={<ChartTip valFmt={(v) => `₹${fmt(v, 1)} Cr`} />} />
                <Bar dataKey="turnover" name="Turnover" fill={T.cyan} radius={[2, 2, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>

            {/* Delivery % chart */}
            {histData.some((r) => r.delivery_pct != null) && (
              <ResponsiveContainer width="100%" height={90}>
                <LineChart data={histData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...AXIS.grid} />
                  <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
                  <YAxis tick={AXIS.tick} tickFormatter={(v) => `${fmt(v, 0)}%`} width={44} tickLine={false} axisLine={AXIS.axisLine} />
                  <Tooltip content={<ChartTip valFmt={(v) => `${fmt(v, 1)}%`} />} />
                  <Line dataKey="delivery_pct" name="Delivery %" stroke={T.amber} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : <Empty msg="Enter a symbol above and click LOAD." />
      )}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────
   FII STATS
   /fii/stats — instruments param is comma-separated STRING
   DB cols: trade_date, instrument, buy_contracts, buy_amount_cr,
            sell_contracts, sell_amount_cr, oi_contracts, oi_amount_cr
   The DB function aggregates → net_contracts = buy - sell
───────────────────────────────────────────────────────────────── */

function FIIStats({ allDates }) {
  const [instList, setInstList]   = useState([]);
  const [instFilter, setInstFilter] = useState('INDEX FUTURES');
  const [start, setStart]         = useState('');
  const [end, setEnd]             = useState('');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    fii.instruments().then((i) => { setInstList(i); }).catch(console.error);
    const r = defaultRange(allDates, 3);
    setStart(r.start); setEnd(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!start || !end || !instFilter) return;
    setLoading(true);
    try {
      // client.fii.stats does instruments.join(',') internally, so pass array
      setData(await fii.stats(start, end, [instFilter]));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [start, end, instFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <Panel title="FII Derivatives Statistics" badge="NSE FII Stats">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '18px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em' }}>Instrument</span>
          <select value={instFilter} onChange={(e) => setInstFilter(e.target.value)}
            style={{ background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px', color: T.text, fontSize: '12px', padding: '5px 10px', fontFamily: "'IBM Plex Mono', monospace", outline: 'none', cursor: 'pointer', minWidth: '160px' }}>
            {instList.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <RangeBar allDates={allDates} start={start} end={end} onStart={setStart} onEnd={setEnd} />
      </div>

      {loading ? <Loader /> : data.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em' }}>Net Contracts (Buy − Sell)</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...AXIS.grid} />
              <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
              <YAxis tick={AXIS.tick} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} width={52} tickLine={false} axisLine={AXIS.axisLine} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTip valFmt={(v) => fmtInt(v)} />} />
              <Bar dataKey="net_contracts" name="Net Contracts" radius={[2, 2, 0, 0]}>
                {data.map((row, i) => <Cell key={i} fill={(row.net_contracts ?? 0) >= 0 ? T.green : T.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <p style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '8px' }}>Open Interest (Contracts)</p>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="oiGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.cyan} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={T.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...AXIS.grid} />
              <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
              <YAxis tick={AXIS.tick} tickFormatter={(v) => `${(v / 1e5).toFixed(1)}L`} width={52} tickLine={false} axisLine={AXIS.axisLine} />
              <Tooltip content={<ChartTip valFmt={(v) => fmtInt(v)} />} />
              <Area dataKey="oi_contracts" name="OI Contracts" stroke={T.cyan} fill="url(#oiGrad)" strokeWidth={1.8} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty />}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────
   VOLATILITY SECTION
   /volatility/snapshot → fields: ticker, trade_date,
     applicable_annual_vol, underlying_annual_vol,
     futures_annual_vol, applicable_daily_vol
   /volatility/{ticker} → same fields over time
───────────────────────────────────────────────────────────────── */

function VolatilitySection() {
  const [tickers, setTickers]     = useState([]);
  const [volDates, setVolDates]   = useState([]);
  const [tradeDate, setDate]      = useState('');
  const [ticker, setTicker]       = useState('');
  const [snapData, setSnapData]   = useState([]);
  const [seriesData, setSeries]   = useState([]);
  const [sub, setSub]             = useState('snapshot');
  const [loading, setLoading]     = useState(false);
  const [start, setStart]         = useState('');
  const [end, setEnd]             = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [t, d] = await Promise.all([volatility.tickers(), volatility.dates()]);
        setTickers(t);
        setVolDates(d);
        setDate(d.at(-1) ?? '');
        const r = defaultRange(d, 6);
        setStart(r.start); setEnd(r.end);
      } catch (e) { console.error(e); }
    })();
  }, []);

  const loadSnap = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try { setSnapData(await volatility.snapshot(tradeDate, 60)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate]);

  const loadSeries = useCallback(async () => {
    if (!ticker || !start || !end) return;
    setLoading(true);
    try { setSeries(await volatility.series(ticker, start, end)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [ticker, start, end]);

  useEffect(() => { if (sub === 'snapshot') loadSnap();  }, [sub, loadSnap]);
  useEffect(() => { if (sub === 'series')   loadSeries(); }, [sub, loadSeries]);

  const volColor = (v) =>
    v == null ? T.textDim
    : v > 0.6  ? T.red
    : v > 0.35 ? T.amber
    : T.green;

  const snapCols = [
    { key: '_i',                   label: '#',            align: 'left', color: () => T.textDim, render: (r) => r._i },
    { key: 'ticker',               label: 'Ticker',       align: 'left', render: (r) => <strong style={{ color: T.text }}>{r.ticker}</strong> },
    { key: 'applicable_annual_vol',label: 'Ann. Vol',     align: 'right',
      render: (r) => <span style={{ color: volColor(r.applicable_annual_vol), fontWeight: 600 }}>
        {r.applicable_annual_vol != null ? `${(r.applicable_annual_vol * 100).toFixed(1)}%` : '—'}
      </span>
    },
    { key: 'underlying_annual_vol',label: 'Underlying',   align: 'right', render: (r) => r.underlying_annual_vol != null ? `${(r.underlying_annual_vol * 100).toFixed(1)}%` : '—', color: () => T.textMid },
    { key: 'futures_annual_vol',   label: 'Futures',      align: 'right', render: (r) => r.futures_annual_vol    != null ? `${(r.futures_annual_vol    * 100).toFixed(1)}%` : '—', color: () => T.textMid },
    { key: 'applicable_daily_vol', label: 'Daily Vol',    align: 'right', render: (r) => r.applicable_daily_vol  != null ? `${(r.applicable_daily_vol  * 100).toFixed(2)}%` : '—', color: () => T.textDim },
  ];

  return (
    <Panel title="FO Volatility" badge="EWMA · NSE FOVOLT">
      <SubTabs
        tabs={[{ key: 'snapshot', label: 'Cross-Section' }, { key: 'series', label: 'Time Series' }]}
        active={sub}
        onChange={setSub}
      />

      {sub === 'snapshot' && (
        <>
          <div style={{ marginBottom: '16px' }}>
            <DateSelect label="Date" dates={volDates} value={tradeDate} onChange={setDate} />
          </div>
          {loading ? <Loader /> : (
            <DataTable
              columns={snapCols}
              rows={snapData.map((r, i) => ({ ...r, _i: i + 1 }))}
              rowKey="ticker"
              maxHeight={500}
            />
          )}
        </>
      )}

      {sub === 'series' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '18px', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '10px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ticker</span>
              <select value={ticker} onChange={(e) => setTicker(e.target.value)}
                style={{ background: T.elevated, border: `1px solid ${T.border}`, borderRadius: '6px', color: T.text, fontSize: '12px', padding: '5px 10px', fontFamily: "'IBM Plex Mono', monospace", outline: 'none', cursor: 'pointer' }}>
                <option value="">— Select —</option>
                {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <RangeBar allDates={volDates} start={start} end={end} onStart={setStart} onEnd={setEnd} />
          </div>

          {loading ? <Loader /> : seriesData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={seriesData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...AXIS.grid} />
                <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
                <YAxis tick={AXIS.tick} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} width={48} tickLine={false} axisLine={AXIS.axisLine} />
                <Tooltip content={<ChartTip valFmt={(v) => `${(v * 100).toFixed(1)}%`} />} />
                <Legend formatter={(v) => <span style={{ color: T.textDim, fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace" }}>{v}</span>} />
                <Line dataKey="applicable_annual_vol" name="Applicable"  stroke={T.cyan}   dot={false} strokeWidth={2} />
                <Line dataKey="underlying_annual_vol" name="Underlying"  stroke={T.green}  dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
                <Line dataKey="futures_annual_vol"    name="Futures"     stroke={T.amber}  dot={false} strokeWidth={1.2} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty msg="Select a ticker and date range above." />}
        </>
      )}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────
   RESEARCH — FII vs Nifty
   /research/fii-vs-nifty → fields: trade_date, fii_net_oi,
     nifty_close, nifty_return_pct, fii_net_oi_lag1, nifty_return_next
───────────────────────────────────────────────────────────────── */

function FIIVsNifty({ allDates }) {
  const [start, setStart] = useState('');
  const [end, setEnd]     = useState('');
  const [data, setData]   = useState([]);
  const [corr, setCorr]   = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const r = defaultRange(allDates, 6);
    setStart(r.start); setEnd(r.end);
  }, [allDates]);

  function pearson(rows, xKey, yKey) {
    const pairs = rows.filter((r) => r[xKey] != null && r[yKey] != null);
    const n = pairs.length;
    if (n < 5) return null;
    const mx = pairs.reduce((s, r) => s + r[xKey], 0) / n;
    const my = pairs.reduce((s, r) => s + r[yKey], 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    pairs.forEach((r) => {
      num += (r[xKey] - mx) * (r[yKey] - my);
      dx2 += (r[xKey] - mx) ** 2;
      dy2 += (r[yKey] - my) ** 2;
    });
    return num / Math.sqrt(dx2 * dy2);
  }

  const load = useCallback(async () => {
    if (!start || !end) return;
    setLoading(true);
    try {
      const raw = await research.fiiVsNifty(start, end);
      setData(raw);
      setCorr(pearson(raw, 'fii_net_oi_lag1', 'nifty_return_next'));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  const corrAccent = corr == null ? T.slate : Math.abs(corr) > 0.3 ? T.green : Math.abs(corr) > 0.15 ? T.amber : T.red;
  const corrLabel  = corr == null ? '' : Math.abs(corr) > 0.3 ? 'Strong signal' : Math.abs(corr) > 0.15 ? 'Weak signal' : 'Noise';

  return (
    <Panel title="FII Futures OI vs Nifty Returns" badge="Lag-1 Correlation · Research">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'center' }}>
        <RangeBar allDates={allDates} start={start} end={end} onStart={setStart} onEnd={setEnd} />
        {corr != null && (
          <Kpi
            label="Lag-1 Correlation"
            value={corr.toFixed(3)}
            sub={corrLabel}
            accent={corrAccent}
          />
        )}
      </div>

      {loading ? <Loader /> : data.length > 0 ? (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...AXIS.grid} />
              <XAxis dataKey="trade_date" tick={AXIS.tick} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS.axisLine} />
              <YAxis yAxisId="oi"  tick={AXIS.tick} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} width={52} tickLine={false} axisLine={AXIS.axisLine} />
              <YAxis yAxisId="ret" orientation="right" tick={AXIS.tick} tickFormatter={(v) => `${v.toFixed(1)}%`} width={44} tickLine={false} axisLine={AXIS.axisLine} />
              <ReferenceLine yAxisId="oi" y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTip valFmt={(v, n) => n === 'FII Net OI' ? fmtInt(v) : `${fmt(v, 2)}%`} />} />
              <Legend formatter={(v) => <span style={{ color: T.textDim, fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace" }}>{v}</span>} />
              <Line yAxisId="oi"  dataKey="fii_net_oi"       name="FII Net OI"    stroke={T.cyan}  dot={false} strokeWidth={1.5} />
              <Line yAxisId="ret" dataKey="nifty_return_pct" name="Nifty Return%" stroke={T.amber} dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <p style={{ marginTop: '10px', fontSize: '11px', color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.6 }}>
            FII Net OI (blue, left axis) vs Nifty daily return % (amber dashed, right axis).
            Lag-1 correlation uses T-1 FII net OI to predict T Nifty return.
          </p>
        </>
      ) : <Empty />}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'indices',    label: 'Indices'    },
  { key: 'breadth',    label: 'Breadth'    },
  { key: 'stocks',     label: 'Stocks'     },
  { key: 'securities', label: 'Securities' },
  { key: 'fii',        label: 'FII Stats'  },
  { key: 'volatility', label: 'Volatility' },
  { key: 'research',   label: 'Research'   },
];

export default function Market() {
  const [allDates, setAllDates]     = useState([]);
  const [marketDates, setMktDates]  = useState([]);
  const [tab, setTab]               = useState('indices');
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [pd, md] = await Promise.all([participant.dates(), market.dates()]);
        setAllDates(pd);
        setMktDates(md);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <LoadingSpinner size="lg" />
    </div>
  );

  return (
    <div style={{
      padding: '28px 24px', maxWidth: '1400px', margin: '0 auto',
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: T.text, margin: 0, letterSpacing: '-0.01em' }}>
          Market & Institutional Flow
        </h1>
        <p style={{ marginTop: '4px', fontSize: '11px', color: T.textDim, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Indices · Breadth · Securities · FII · Volatility · Research
        </p>
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'indices'    && <IndicesSection    marketDates={marketDates} />}
      {tab === 'breadth'    && <BreadthSection    marketDates={marketDates} />}
      {tab === 'stocks'     && <TopStocksSection  marketDates={marketDates} />}
      {tab === 'securities' && <SecuritiesSection marketDates={marketDates} />}
      {tab === 'fii'        && <FIIStats          allDates={allDates}       />}
      {tab === 'volatility' && <VolatilitySection />}
      {tab === 'research'   && <FIIVsNifty        allDates={allDates}       />}
    </div>
  );
}
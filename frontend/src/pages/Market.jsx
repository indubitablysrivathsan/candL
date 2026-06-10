// frontend/src/pages/Market.jsx
// ── Institutional Terminal Aesthetic ──────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
  AreaChart, Area,
} from 'recharts';

import MetricCard     from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { participant, fii, volatility, market } from '../api/client';

/* ─── DESIGN TOKENS ──────────────────────────────────────────── */
const T = {
  bg:         '#06080c',
  surface:    '#0b0f16',
  surfaceHi:  '#111720',
  border:     'rgba(255,255,255,0.07)',
  borderHi:   'rgba(255,255,255,0.14)',
  amber:      '#F0A500',
  amberDim:   'rgba(240,165,0,0.12)',
  amberBorder:'rgba(240,165,0,0.35)',
  green:      '#00C896',
  greenDim:   'rgba(0,200,150,0.10)',
  red:        '#E05252',
  redDim:     'rgba(224,82,82,0.10)',
  pink:       '#D66E9A',
  blue:       '#4A9EFF',
  purple:     '#A855F7',
  textHi:     'rgba(255,255,255,0.90)',
  textMid:    'rgba(255,255,255,0.50)',
  textLo:     'rgba(255,255,255,0.25)',
  textGhost:  'rgba(255,255,255,0.10)',
};

/* ─── SHARED STYLE HELPERS ───────────────────────────────────── */
const mono = { fontFamily: "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace" };

const labelStyle = (extra = {}) => ({
  ...mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.textLo,
  ...extra,
});

/* ─── HELPERS ────────────────────────────────────────────────── */
const fmt    = (n, dec = 2) => n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });
const fmtInt = (n)          => n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtK   = (v) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_00_000) return `${(v / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)    return `${(v / 1_000).toFixed(1)}K`;
  return fmtInt(v);
};
const pctColor = (v) => v > 0 ? T.green : v < 0 ? T.red : T.textLo;
const pctSign  = (v) => v > 0 ? '+' : '';

function defaultRange(allDates, months = 3) {
  if (!allDates?.length) return { start: '', end: '' };
  return { start: allDates.at(-(months * 22)) ?? allDates[0], end: allDates.at(-1) };
}

/* ─── CHART SHARED PROPS ─────────────────────────────────────── */
const chartAxisProps = {
  tick: { fill: T.textLo, fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.04em' },
  tickLine: false,
  axisLine: { stroke: T.border },
};
const gridProps = { strokeDasharray: '2 4', stroke: T.textGhost, vertical: false };

/* ─── SHARED COMPONENTS ──────────────────────────────────────── */

function Divider({ vertical, style = {} }) {
  return vertical
    ? <div style={{ width: 1, alignSelf: 'stretch', background: T.border, flexShrink: 0, ...style }} />
    : <div style={{ height: 1, background: T.border, ...style }} />;
}

function TerminalBtn({ active, children, onClick, disabled, color, style = {} }) {
  const ac = color ?? T.amber;
  const acDim = color ? `${color}20` : T.amberDim;
  const acBorder = color ? `${color}50` : T.amberBorder;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...mono,
      padding: '4px 11px',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      border: `1px solid ${active ? acBorder : T.border}`,
      background: active ? acDim : 'transparent',
      color: active ? ac : T.textMid,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'all 0.12s',
      whiteSpace: 'nowrap',
      borderRadius: 0,
      ...style,
    }}>
      {children}
    </button>
  );
}

function PanelHeader({ title, subtitle, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 14px',
      borderBottom: `1px solid ${T.border}`,
      background: T.surfaceHi,
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={labelStyle({ color: T.amber, letterSpacing: '0.16em' })}>{title}</span>
        {subtitle && <span style={{ ...mono, fontSize: 10, color: T.textLo }}>{subtitle}</span>}
      </div>
      {right && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{right}</div>}
    </div>
  );
}

function Panel({ title, subtitle, right, children, style = {} }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 0, overflow: 'hidden', ...style }}>
      <PanelHeader title={title} subtitle={subtitle} right={right} />
      <div style={{ padding: '14px' }}>{children}</div>
    </div>
  );
}

function MetricStrip({ items }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
      {items.map(({ title, value, sub, accent = T.amber }, i) => (
        <div key={title} style={{
          flex: 1, padding: '10px 14px',
          borderRight: i < items.length - 1 ? `1px solid ${T.border}` : 'none',
          background: T.surface, minWidth: 0,
        }}>
          <div style={labelStyle({ marginBottom: 5 })}>{title}</div>
          <div style={{ ...mono, fontSize: 14, fontWeight: 600, color: accent, letterSpacing: '0.04em' }}>{value}</div>
          {sub && <div style={{ ...mono, fontSize: 9, color: T.textLo, marginTop: 3 }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}

function RangePresets({ allDates, onStart, onEnd }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${T.border}` }}>
      {[{ l: '1M', m: 1 }, { l: '3M', m: 3 }, { l: '6M', m: 6 }, { l: '1Y', m: 12 }].map(({ l, m }, i) => (
        <TerminalBtn key={l}
          onClick={() => { const r = defaultRange(allDates, m); onStart(r.start); onEnd(r.end); }}
          style={{ borderWidth: 0, borderRight: i < 3 ? `1px solid ${T.border}` : 0 }}>
          {l}
        </TerminalBtn>
      ))}
    </div>
  );
}

function DateRangeRow({ allDates, startDate, endDate, onStart, onEnd }) {
  const inputStyle = {
    ...mono, fontSize: 10, padding: '4px 8px',
    background: T.surfaceHi, border: `1px solid ${T.border}`,
    color: T.textMid, outline: 'none', borderRadius: 0, letterSpacing: '0.04em',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <RangePresets allDates={allDates} onStart={onStart} onEnd={onEnd} />
      <input type="date" value={startDate} onChange={e => onStart(e.target.value)} style={inputStyle} />
      <span style={{ color: T.textLo, fontSize: 10 }}>→</span>
      <input type="date" value={endDate}   onChange={e => onEnd(e.target.value)}   style={inputStyle} />
    </div>
  );
}

function TermSelect({ value, onChange, children, style = {} }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      ...mono,
      fontSize: 10,
      padding: '4px 24px 4px 8px',
      background: T.surfaceHi,
      border: `1px solid ${T.border}`,
      color: T.textMid,
      outline: 'none',
      borderRadius: 0,
      letterSpacing: '0.04em',
      cursor: 'pointer',
      appearance: 'none',
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(255,255,255,0.25)'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 8px center',
      ...style,
    }}>
      {children}
    </select>
  );
}

function SectionLabel({ children, style = {} }) {
  return (
    <div style={{ ...labelStyle({ color: T.amber }), marginBottom: 8, paddingTop: 2, ...style }}>
      {children}
    </div>
  );
}

function TermTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
      padding: '10px 14px', minWidth: 180,
    }}>
      <div style={labelStyle({ color: T.amber, marginBottom: 8 })}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, background: p.color, flexShrink: 0 }} />
            <span style={{ ...mono, fontSize: 10, color: p.color }}>{p.name}</span>
          </div>
          <span style={{ ...mono, fontSize: 11, color: T.textHi, fontWeight: 600 }}>
            {valueFormatter ? valueFormatter(p.value, p.name) : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TerminalLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
      <span style={{ ...mono, fontSize: 10, color: T.textLo, letterSpacing: '0.14em' }}>LOADING DATA…</span>
    </div>
  );
}

function Empty({ msg = 'No data for selected range.' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
      <span style={{ ...mono, fontSize: 10, color: T.textLo, letterSpacing: '0.10em' }}>{msg.toUpperCase()}</span>
    </div>
  );
}

/* ─── TABLE ──────────────────────────────────────────────────── */
const thStyle = {
  ...mono,
  padding: '6px 10px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.textLo,
  borderBottom: `1px solid ${T.borderHi}`,
  whiteSpace: 'nowrap',
  background: T.surfaceHi,
};

function DataTable({ columns, rows, maxHeight = 480, rowKey }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, overflowX: 'auto', overflowY: 'auto', maxHeight }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{ ...thStyle, textAlign: col.align || 'right' }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? (row[rowKey] ?? i) : i} style={{ background: i % 2 === 0 ? T.surface : 'transparent' }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  ...mono, textAlign: col.align || 'right',
                  padding: '5px 10px', fontSize: 11, color: T.textMid,
                  borderBottom: `1px solid ${T.border}`,
                }}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── SUB-TAB STRIP ──────────────────────────────────────────── */
function SubTabStrip({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, marginBottom: 14 }}>
      {tabs.map(({ key, label }) => (
        <button key={key} onClick={() => onChange(key)} style={{
          ...mono,
          padding: '6px 14px',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          background: 'transparent',
          border: 'none',
          borderBottom: active === key ? `2px solid ${T.blue}` : '2px solid transparent',
          color: active === key ? T.blue : T.textLo,
          cursor: 'pointer',
          transition: 'all 0.12s',
          marginBottom: -1,
        }}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   INDICES
═══════════════════════════════════════════════════════════════ */
function IndexSnapshot({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => { if (marketDates.length) setTradeDate(marketDates.at(-1)); }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.indexSnapshot(tradeDate).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const advances = data.filter(d => d.pct_change > 0).length;
  const declines = data.filter(d => d.pct_change < 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.length > 0 && (
        <MetricStrip items={[
          { title: 'Session Date', value: tradeDate, accent: T.textMid },
          { title: 'Indices',      value: data.length, accent: T.textHi },
          { title: 'Advancing',    value: advances, accent: T.green },
          { title: 'Declining',    value: declines, accent: T.red },
        ]} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
        <span style={labelStyle()}>Session</span>
        <TermSelect value={tradeDate} onChange={setTradeDate}>
          {[...marketDates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
        </TermSelect>
      </div>

      {loading ? <TerminalLoading /> : (
        <div style={{ overflowX: 'auto', border: `1px solid ${T.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Index','Close','Prev Close','Change','Change %'].map((h, i) => (
                  <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((idx, i) => {
                const col = pctColor(idx.pct_change);
                return (
                  <tr key={idx.index_name} style={{ background: i % 2 === 0 ? T.surface : 'transparent' }}>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: T.textHi, borderBottom: `1px solid ${T.border}`, textAlign: 'left' }}>
                      {idx.index_name}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 600, color: col, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {fmt(idx.close, 2)}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, color: T.textMid, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {fmt(idx.prev_close ?? (idx.close - idx.gain_loss), 2)}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 600, color: col, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {pctSign(idx.gain_loss)}{fmt(idx.gain_loss, 1)}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: col, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {pctSign(idx.pct_change)}{fmt(idx.pct_change)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IndexHistory({ marketDates }) {
  const [indexNames, setIndexNames] = useState([]);
  const [selected, setSelected]     = useState('');
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    market.indexNames().then(n => { setIndexNames(n); if (n.length) setSelected(n[0]); }).catch(console.error);
    const r = defaultRange(marketDates, 6); setStartDate(r.start); setEndDate(r.end);
  }, [marketDates]);

  const load = useCallback(async () => {
    if (!selected || !startDate || !endDate) return;
    setLoading(true);
    try { setData(await market.indexHistory(selected, startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [selected, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const last = data.at(-1);
  const first = data[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {last && (
        <MetricStrip items={[
          { title: 'Index',   value: selected,           accent: T.textMid },
          { title: 'Latest',  value: fmt(last.close, 0), accent: T.textHi },
          { title: 'Period Δ',
            value: first ? `${pctSign(((last.close - first.close) / first.close) * 100)}${(((last.close - first.close) / first.close) * 100).toFixed(1)}%` : '—',
            accent: last.close >= (first?.close ?? last.close) ? T.green : T.red,
          },
          { title: 'Sessions', value: data.length, accent: T.textMid },
        ]} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={labelStyle()}>Index</span>
          <TermSelect value={selected} onChange={setSelected}>
            {indexNames.map(n => <option key={n} value={n}>{n}</option>)}
          </TermSelect>
        </div>
        <Divider vertical style={{ height: 20 }} />
        <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      {loading ? <TerminalLoading /> : data.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SectionLabel>Price — {selected}</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={T.blue} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={T.blue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
              <YAxis {...chartAxisProps} tickFormatter={v => fmtInt(v)} width={62} />
              <Tooltip content={<TermTooltip valueFormatter={v => fmt(v, 2)} />} />
              <Area dataKey="close" name="Close" stroke={T.blue} fill="url(#areaGrad)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>

          <SectionLabel style={{ marginTop: 10 }}>Daily Change %</SectionLabel>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
              <YAxis {...chartAxisProps} tickFormatter={v => `${fmt(v, 1)}%`} width={46} />
              <ReferenceLine y={0} stroke={T.borderHi} strokeDasharray="3 3" />
              <Tooltip content={<TermTooltip valueFormatter={v => `${fmt(v, 2)}%`} />} />
              <Bar dataKey="pct_change" name="Change %" radius={0}>
                {data.map((row, i) => <Cell key={i} fill={row.pct_change >= 0 ? T.green : T.red} opacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty />}
    </div>
  );
}

function IndicesSection({ marketDates }) {
  const [sub, setSub] = useState('snapshot');
  return (
    <Panel title="Indices" subtitle="NSE index OHLC · all index types">
      <SubTabStrip
        tabs={[{ key: 'snapshot', label: 'Snapshot' }, { key: 'history', label: 'History' }]}
        active={sub} onChange={setSub}
      />
      {sub === 'snapshot' && <IndexSnapshot marketDates={marketDates} />}
      {sub === 'history'  && <IndexHistory  marketDates={marketDates} />}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BREADTH
═══════════════════════════════════════════════════════════════ */
function BreadthSection({ marketDates }) {
  const [sub, setSub]         = useState('history');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd]     = useState('');
  const [data, setData]       = useState([]);
  const [snap, setSnap]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const r = defaultRange(marketDates, 3); setStart(r.start); setEnd(r.end);
  }, [marketDates]);

  const loadHistory = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try { setData(await market.breadth(startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate]);

  const loadSnap = useCallback(async () => {
    if (!marketDates.length) return;
    setLoading(true);
    try { setSnap(await market.breadthSnapshot(marketDates.at(-1))); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [marketDates]);

  useEffect(() => { if (sub === 'history')  loadHistory(); }, [sub, loadHistory]);
  useEffect(() => { if (sub === 'snapshot') loadSnap();    }, [sub, loadSnap]);

  return (
    <Panel title="Market Breadth" subtitle="Advances · declines · unchanged · price-band hits">
      <SubTabStrip
        tabs={[{ key: 'history', label: 'History' }, { key: 'snapshot', label: 'Snapshot' }]}
        active={sub} onChange={setSub}
      />

      {sub === 'snapshot' && (
        loading ? <TerminalLoading /> : snap ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <MetricStrip items={[
              { title: 'Advances',        value: fmtInt(snap.advances),        accent: T.green },
              { title: 'Declines',        value: fmtInt(snap.declines),        accent: T.red },
              { title: 'Unchanged',       value: fmtInt(snap.unchanged),       accent: T.textMid },
              { title: 'Price Band Hits', value: fmtInt(snap.price_band_hits), accent: T.amber },
              {
                title: 'A/D Ratio',
                value: snap.advances != null && snap.declines != null
                  ? ((snap.advances / (snap.advances + snap.declines)) || 0).toFixed(3) : '—',
                accent: snap.advances > snap.declines ? T.green : T.red,
              },
            ]} />
          </div>
        ) : <Empty msg="No breadth data." />
      )}

      {sub === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '4px 0' }}>
            <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
          </div>
          {loading ? <TerminalLoading /> : data.length > 0 ? (
            <>
              <SectionLabel>Advances vs Declines</SectionLabel>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis {...chartAxisProps} width={46} />
                  <Tooltip content={<TermTooltip valueFormatter={v => fmtInt(v)} />} />
                  <Legend formatter={v => <span style={{ ...mono, fontSize: 9, color: T.textMid }}>{v}</span>} />
                  <Bar dataKey="advances" name="Advances" stackId="a" fill={T.green} opacity={0.8} radius={0} />
                  <Bar dataKey="declines" name="Declines" stackId="a" fill={T.red}   opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>

              <SectionLabel style={{ marginTop: 6 }}>AD Ratio</SectionLabel>
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis {...chartAxisProps} tickFormatter={v => fmt(v, 2)} width={40} domain={[0, 1]} />
                  <ReferenceLine y={0.5} stroke={T.borderHi} strokeDasharray="3 3" />
                  <Tooltip content={<TermTooltip valueFormatter={v => fmt(v, 3)} />} />
                  <Line dataKey="ad_ratio" name="AD Ratio" stroke={T.blue} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : <Empty />}
        </div>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TOP STOCKS
═══════════════════════════════════════════════════════════════ */
function TopByValue({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => { if (marketDates.length) setTradeDate(marketDates.at(-1)); }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.topStocks(tradeDate, { series: 'EQ', limit: 25 })
      .then(setData).catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const columns = [
    { key: '_rank',      label: '#',          align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r._rank}</span> },
    { key: 'ticker',     label: 'Symbol',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: T.textHi }}>{r.ticker}</span> },
    { key: 'series',     label: 'Series',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r.series}</span> },
    { key: 'close',      label: 'Close',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: T.textHi }}>{fmt(r.close, 2)}</span> },
    { key: 'prev_close', label: 'Prev',       align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>{fmt(r.prev_close, 2)}</span> },
    { key: 'pct_change', label: 'Chg %',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: pctColor(r.pct_change) }}>
        {pctSign(r.pct_change)}{fmt(r.pct_change)}%
      </span> },
    { key: 'turnover',   label: 'Value (Cr)', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.amber }}>{fmt(r.turnover, 1)}</span> },
    { key: 'volume',     label: 'Volume',     align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>{fmtInt(r.volume)}</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={labelStyle()}>Session</span>
        <TermSelect value={tradeDate} onChange={setTradeDate}>
          {[...marketDates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
        </TermSelect>
      </div>
      {loading ? <TerminalLoading /> : data.length > 0
        ? <DataTable columns={columns} rows={data.map((r, i) => ({ ...r, _rank: i + 1 }))} rowKey="ticker" maxHeight={520} />
        : <Empty />}
    </div>
  );
}

function GainersLosers({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [gainers, setGainers]     = useState([]);
  const [losers, setLosers]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [side, setSide]           = useState('gainers');

  useEffect(() => { if (marketDates.length) setTradeDate(marketDates.at(-1)); }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.topGainersLosers(tradeDate, { series: 'EQ', limit: 15, minTurnover: 100 })
      .then(res => { setGainers(res.gainers || []); setLosers(res.losers || []); })
      .catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const columns = [
    { key: '_rank',      label: '#',          align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r._rank}</span> },
    { key: 'ticker',     label: 'Symbol',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: T.textHi }}>{r.ticker}</span> },
    { key: 'prev_close', label: 'Prev',       align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>{fmt(r.prev_close, 2)}</span> },
    { key: 'close',      label: 'Close',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: T.textHi }}>{fmt(r.close, 2)}</span> },
    { key: 'pct_change', label: 'Chg %',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: pctColor(r.pct_change) }}>
        {pctSign(r.pct_change)}{fmt(r.pct_change)}%
      </span> },
    { key: 'turnover',   label: 'Value (Cr)', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.amber }}>{fmt(r.turnover, 1)}</span> },
  ];

  const rows = (side === 'gainers' ? gainers : losers).map((r, i) => ({ ...r, _rank: i + 1 }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={labelStyle()}>Session</span>
          <TermSelect value={tradeDate} onChange={setTradeDate}>
            {[...marketDates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
          </TermSelect>
        </div>
        <div style={{ display: 'flex', border: `1px solid ${T.border}` }}>
          <TerminalBtn active={side === 'gainers'} color={T.green}
            onClick={() => setSide('gainers')}
            style={{ borderWidth: 0, borderRight: `1px solid ${T.border}` }}>
            ▲ Gainers
          </TerminalBtn>
          <TerminalBtn active={side === 'losers'} color={T.red}
            onClick={() => setSide('losers')}
            style={{ borderWidth: 0 }}>
            ▼ Losers
          </TerminalBtn>
        </div>
      </div>
      {loading ? <TerminalLoading /> : rows.length > 0
        ? <DataTable columns={columns} rows={rows} rowKey="ticker" maxHeight={520} />
        : <Empty msg={`No ${side} data.`} />}
    </div>
  );
}

function TopStocksSection({ marketDates }) {
  const [sub, setSub] = useState('value');
  return (
    <Panel title="Top Stocks" subtitle="Daily ranked lists from NSE market activity">
      <SubTabStrip
        tabs={[{ key: 'value', label: 'Top 25 by Value' }, { key: 'movers', label: 'Gainers / Losers' }]}
        active={sub} onChange={setSub}
      />
      {sub === 'value'  && <TopByValue    marketDates={marketDates} />}
      {sub === 'movers' && <GainersLosers marketDates={marketDates} />}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FII STATS
═══════════════════════════════════════════════════════════════ */
function FIIStats({ allDates }) {
  const [instList, setInstList]     = useState([]);
  const [instFilter, setInstFilter] = useState('INDEX FUTURES');
  const [startDate, setStart]       = useState('');
  const [endDate, setEnd]           = useState('');
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    fii.instruments().then(setInstList).catch(console.error);
    const r = defaultRange(allDates, 3); setStart(r.start); setEnd(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate || !instFilter) return;
    setLoading(true);
    try { setData(await fii.stats(startDate, endDate, [instFilter])); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, instFilter]);

  useEffect(() => { load(); }, [load]);

  const last = data.at(-1);
  const cumNet = data.reduce((acc, r) => acc + (r.net_contracts ?? 0), 0);

  return (
    <Panel title="FII Derivatives Statistics" subtitle="Buy · sell · net contracts · OI from NSE FII stats file">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {last && (
          <MetricStrip items={[
            { title: 'Instrument',   value: instFilter, accent: T.textMid },
            { title: 'Latest Net',   value: last.net_contracts != null ? (last.net_contracts >= 0 ? '+' : '') + fmtInt(last.net_contracts) : '—',
              accent: last.net_contracts >= 0 ? T.green : T.red },
            { title: 'Latest OI',    value: last.oi_contracts != null ? fmtK(last.oi_contracts) : '—', accent: T.blue },
            { title: 'Period Cum Net', value: (cumNet >= 0 ? '+' : '') + fmtInt(cumNet), accent: cumNet >= 0 ? T.green : T.red },
          ]} />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0' }}>
          <span style={labelStyle()}>Instrument</span>
          <TermSelect value={instFilter} onChange={setInstFilter}>
            {instList.map(i => <option key={i} value={i}>{i}</option>)}
          </TermSelect>
          <Divider vertical style={{ height: 20 }} />
          <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
        </div>

        {loading ? <TerminalLoading /> : data.length > 0 ? (
          <>
            <SectionLabel>Net Contracts (Buy − Sell)</SectionLabel>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis {...chartAxisProps} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} width={46} />
                <ReferenceLine y={0} stroke={T.borderHi} strokeDasharray="3 3" />
                <Tooltip content={<TermTooltip valueFormatter={v => fmtInt(v)} />} />
                <Bar dataKey="net_contracts" name="Net Contracts" radius={0}>
                  {data.map((row, i) => <Cell key={i} fill={(row.net_contracts ?? 0) >= 0 ? T.green : T.red} opacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <SectionLabel style={{ marginTop: 6 }}>Open Interest (Contracts)</SectionLabel>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis {...chartAxisProps} tickFormatter={v => `${(v / 1e5).toFixed(1)}L`} width={46} />
                <Tooltip content={<TermTooltip valueFormatter={v => fmtInt(v)} />} />
                <Line dataKey="oi_contracts" name="OI" stroke={T.blue} dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : <Empty />}
      </div>
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VOLATILITY
═══════════════════════════════════════════════════════════════ */
function VolatilitySection() {
  const [tickers, setTickers]   = useState([]);
  const [volDates, setVolDates] = useState([]);
  const [tradeDate, setDate]    = useState('');
  const [ticker, setTicker]     = useState('');
  const [snapData, setSnapData] = useState([]);
  const [seriesData, setSeries] = useState([]);
  const [sub, setSub]           = useState('snapshot');
  const [loading, setLoading]   = useState(false);
  const [startDate, setStart]   = useState('');
  const [endDate, setEnd]       = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [t, d] = await Promise.all([volatility.tickers(), volatility.dates()]);
        setTickers(t); setVolDates(d); setDate(d.at(-1) ?? '');
        const r = defaultRange(d, 6); setStart(r.start); setEnd(r.end);
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
    if (!ticker || !startDate || !endDate) return;
    setLoading(true);
    try { setSeries(await volatility.series(ticker, startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [ticker, startDate, endDate]);

  useEffect(() => { if (sub === 'snapshot') loadSnap();  }, [sub, loadSnap]);
  useEffect(() => { if (sub === 'series')   loadSeries(); }, [sub, loadSeries]);

  const volColor = (v) =>
    v == null   ? T.textLo
    : v > 0.6   ? T.red
    : v > 0.35  ? T.amber
    : T.green;

  const snapCols = [
    { key: '_i',     label: '#',          align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r._i}</span> },
    { key: 'ticker', label: 'Ticker',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: T.textHi }}>{r.ticker}</span> },
    { key: 'applicable_annual_vol', label: 'Ann. Vol', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: volColor(r.applicable_annual_vol) }}>
        {r.applicable_annual_vol != null ? `${(r.applicable_annual_vol * 100).toFixed(1)}%` : '—'}
      </span> },
    { key: 'underlying_annual_vol', label: 'Underlying', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>
        {r.underlying_annual_vol != null ? `${(r.underlying_annual_vol * 100).toFixed(1)}%` : '—'}
      </span> },
    { key: 'futures_annual_vol', label: 'Futures', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>
        {r.futures_annual_vol != null ? `${(r.futures_annual_vol * 100).toFixed(1)}%` : '—'}
      </span> },
    { key: 'applicable_daily_vol', label: 'Daily Vol', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textLo }}>
        {r.applicable_daily_vol != null ? `${(r.applicable_daily_vol * 100).toFixed(2)}%` : '—'}
      </span> },
  ];

  return (
    <Panel title="FO Volatility (EWMA)" subtitle="Underlying and futures EWMA daily + annualised volatility from NSE FOVOLT files">
      <SubTabStrip
        tabs={[{ key: 'snapshot', label: 'Cross-Section' }, { key: 'series', label: 'Time Series' }]}
        active={sub} onChange={setSub}
      />

      {sub === 'snapshot' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={labelStyle()}>Date</span>
            <TermSelect value={tradeDate} onChange={setDate}>
              {[...volDates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
            </TermSelect>
          </div>
          {loading ? <TerminalLoading /> : (
            <DataTable columns={snapCols} rows={snapData.map((r, i) => ({ ...r, _i: i + 1 }))} rowKey="ticker" maxHeight={500} />
          )}
        </div>
      )}

      {sub === 'series' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0' }}>
            <span style={labelStyle()}>Ticker</span>
            <TermSelect value={ticker} onChange={setTicker}>
              <option value="">— Select —</option>
              {tickers.map(t => <option key={t} value={t}>{t}</option>)}
            </TermSelect>
            <Divider vertical style={{ height: 20 }} />
            <DateRangeRow allDates={volDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
          </div>

          {loading ? <TerminalLoading /> : seriesData.length > 0 ? (
            <>
              {ticker && (
                <MetricStrip items={[
                  { title: 'Ticker', value: ticker, accent: T.textMid },
                  { title: 'Latest Ann. Vol',
                    value: seriesData.at(-1)?.applicable_annual_vol != null
                      ? `${(seriesData.at(-1).applicable_annual_vol * 100).toFixed(1)}%` : '—',
                    accent: volColor(seriesData.at(-1)?.applicable_annual_vol) },
                  { title: 'Sessions', value: seriesData.length, accent: T.textMid },
                ]} />
              )}
              <SectionLabel>Annualised Volatility — {ticker}</SectionLabel>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={seriesData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis {...chartAxisProps} tickFormatter={v => `${(v * 100).toFixed(0)}%`} width={40} />
                  <Tooltip content={<TermTooltip valueFormatter={v => `${(v * 100).toFixed(1)}%`} />} />
                  <Legend formatter={v => <span style={{ ...mono, fontSize: 9, color: T.textMid }}>{v}</span>} />
                  <Line dataKey="applicable_annual_vol" name="Applicable" stroke={T.blue}  dot={false} strokeWidth={2} />
                  <Line dataKey="underlying_annual_vol" name="Underlying" stroke={T.green} dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
                  <Line dataKey="futures_annual_vol"    name="Futures"    stroke={T.amber} dot={false} strokeWidth={1.2} strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : <Empty msg="Select a ticker and date range." />}
        </div>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
const TOP_TABS = [
  { key: 'indices',    label: 'Indices'    },
  { key: 'breadth',   label: 'Breadth'    },
  { key: 'top_stocks', label: 'Top Stocks' },
  { key: 'fii_stats',  label: 'FII Stats'  },
  { key: 'volatility', label: 'Volatility' },
];

export default function Market() {
  const [allDates, setAllDates]    = useState([]);
  const [marketDates, setMktDates] = useState([]);
  const [loading, setLoading]      = useState(true);
  const [activeSection, setActive] = useState('indices');

  useEffect(() => {
    (async () => {
      try {
        const [pd, md] = await Promise.all([participant.dates(), market.dates()]);
        setAllDates(pd); setMktDates(md);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
      <span style={{ ...mono, fontSize: 11, color: T.textLo, letterSpacing: '0.14em' }}>INITIALIZING…</span>
    </div>
  );

  return (
    <div style={{ background: T.bg, minHeight: '100vh', ...mono }}>
      {/* ── Page Header ── */}
      <div style={{ borderBottom: `1px solid ${T.border}`, background: T.surface, padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textHi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Market & Institutional Flow
            </span>
            <span style={{ fontSize: 10, color: T.textLo, letterSpacing: '0.06em' }}>
              Indices · Breadth · Stocks · FII · Volatility
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, background: T.green, borderRadius: '50%' }} />
            <span style={{ fontSize: 9, color: T.green, letterSpacing: '0.12em', fontWeight: 700 }}>NSE LIVE</span>
          </div>
        </div>

        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 0, marginTop: 8 }}>
          {TOP_TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setActive(key)} style={{
              ...mono,
              padding: '8px 14px',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              background: 'transparent',
              border: 'none',
              borderBottom: activeSection === key ? `2px solid ${T.amber}` : '2px solid transparent',
              color: activeSection === key ? T.amber : T.textMid,
              cursor: 'pointer',
              transition: 'all 0.12s',
              marginBottom: -1,
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: '16px 20px' }}>
        {activeSection === 'indices'     && <IndicesSection    marketDates={marketDates} />}
        {activeSection === 'breadth'     && <BreadthSection    marketDates={marketDates} />}
        {activeSection === 'top_stocks'  && <TopStocksSection  marketDates={marketDates} />}
        {activeSection === 'fii_stats'   && <FIIStats          allDates={allDates} />}
        {activeSection === 'volatility'  && <VolatilitySection />}
      </div>
    </div>
  );
}
// frontend/src/pages/Market.jsx

import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
  AreaChart, Area,
} from 'recharts';

import MetricCard     from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { participant, fii, volatility, market, research } from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS  (matching Options.jsx palette)
───────────────────────────────────────────────────────────────── */

const C = {
  accent: '#00B0F0',
  green:  '#26a69a',
  red:    '#ef5350',
  amber:  '#FFA726',
  purple: '#B39DDB',
  gold:   '#FFD700',
  pink:   '#FF69B4',
  muted:  'rgba(255,255,255,0.25)',
};

/* ─────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────── */

const fmt = (n, dec = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });

const fmtInt = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const pctColor = (v) => v > 0 ? C.green : v < 0 ? C.red : C.muted;
const pctSign  = (v) => v > 0 ? '+' : '';

function defaultRange(allDates, months = 3) {
  if (!allDates?.length) return { start: '', end: '' };
  const end   = allDates.at(-1);
  const start = allDates.at(-(months * 22)) ?? allDates[0];
  return { start, end };
}

/* ─────────────────────────────────────────────────────────────────
   SHARED UI
───────────────────────────────────────────────────────────────── */

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-4 py-2 rounded-xl border text-sm transition whitespace-nowrap ${
            active === key
              ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
              : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SubTabBar({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1 rounded-md border text-xs transition whitespace-nowrap ${
            active === key
              ? 'border-[#00B0F0]/20 bg-[#00B0F0]/8 text-[#00B0F0]/90'
              : 'border-white/8 bg-transparent text-white/45 hover:text-white/65'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-white/8">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function RangePresets({ allDates, onStart, onEnd }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {[{ label: '1M', months: 1 }, { label: '3M', months: 3 }, { label: '6M', months: 6 }, { label: '1Y', months: 12 }].map(({ label, months }) => (
        <button
          key={label}
          onClick={() => { const r = defaultRange(allDates, months); onStart(r.start); onEnd(r.end); }}
          className="px-3 py-1.5 rounded-lg border border-white/10 bg-[#151922] text-white/55 text-xs transition hover:bg-white/5 hover:text-white"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DateRangeRow({ allDates, startDate, endDate, onStart, onEnd }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RangePresets allDates={allDates} onStart={onStart} onEnd={onEnd} />
      <div className="flex items-center gap-2">
        <input type="date" value={startDate} onChange={(e) => onStart(e.target.value)} />
        <span className="text-white/30">→</span>
        <input type="date" value={endDate}   onChange={(e) => onEnd(e.target.value)} />
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#11151d] border border-white/10 rounded-xl px-4 py-3 shadow-2xl min-w-[180px]">
      <p className="text-xs text-white/50 mb-2">{label}</p>
      <div className="space-y-1.5">
        {payload.map((p, i) => p.value != null && (
          <div key={i} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span style={{ color: p.color }}>{p.name}</span>
            </div>
            <span className="text-white font-medium tabular-nums">
              {valueFormatter ? valueFormatter(p.value, p.name) : fmt(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const AXIS_TICK  = { fill: 'rgba(255,255,255,0.5)', fontSize: 10 };
const AXIS_LINE  = { stroke: 'rgba(255,255,255,0.08)' };
const GRID_PROPS = { strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.06)' };

function Loader() {
  return <div className="flex justify-center py-8"><LoadingSpinner /></div>;
}

function Empty({ msg = 'No data for selected range.' }) {
  return <p className="text-white/40 text-sm py-8 text-center">{msg}</p>;
}

/* ─────────────────────────────────────────────────────────────────
   DATA TABLE
───────────────────────────────────────────────────────────────── */

function DataTable({ columns, rows, maxHeight = 480, rowKey }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto" style={{ maxHeight }}>
        <table>
          <thead className="sticky top-0 bg-[#11151d]">
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ textAlign: col.align || 'right' }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey ? (row[rowKey] ?? i) : i}>
                {columns.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align || 'right' }}>
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
      <div className="flex items-center gap-3 mb-5">
        <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
        <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
          {[...marketDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      {loading ? <Loader /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {data.map((idx) => (
            <MetricCard
              key={idx.index_name}
              title={idx.index_name}
              value={fmt(idx.close, 2)}
              subtitle={
                <span style={{ color: pctColor(idx.pct_change) }}>
                  {pctSign(idx.pct_change)}{fmt(idx.pct_change)}%
                  <span className="text-white/30 ml-1">
                    ({pctSign(idx.gain_loss)}{fmt(idx.gain_loss, 1)})
                  </span>
                </span>
              }
              accent={idx.pct_change > 0 ? C.green : idx.pct_change < 0 ? C.red : C.muted}
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
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    market.indexNames().then((n) => { setIndexNames(n); if (n.length) setSelected(n[0]); }).catch(console.error);
    const r = defaultRange(marketDates, 6);
    setStartDate(r.start); setEndDate(r.end);
  }, [marketDates]);

  const load = useCallback(async () => {
    if (!selected || !startDate || !endDate) return;
    setLoading(true);
    try { setData(await market.indexHistory(selected, startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [selected, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-white/50 uppercase tracking-wider">Index</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {indexNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      {loading ? <Loader /> : data.length > 0 ? (
        <div className="space-y-4">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.accent} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
              <YAxis tick={AXIS_TICK} tickFormatter={(v) => fmtInt(v)} width={64} tickLine={false} axisLine={AXIS_LINE} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v, 2)} />} />
              <Area dataKey="close" name="Close" stroke={C.accent} fill="url(#areaGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>

          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
              <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${fmt(v, 1)}%`} width={52} tickLine={false} axisLine={AXIS_LINE} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v, 2)}%`} />} />
              <Bar dataKey="pct_change" name="Change %" radius={[2, 2, 0, 0]}>
                {data.map((row, i) => <Cell key={i} fill={row.pct_change >= 0 ? C.green : C.red} />)}
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
    <SectionCard title="Indices" subtitle="NSE index OHLC · all index types included">
      <SubTabBar tabs={[{ key: 'snapshot', label: 'Snapshot' }, { key: 'history', label: 'History' }]} active={sub} onChange={setSub} />
      {sub === 'snapshot' && <IndexSnapshot marketDates={marketDates} />}
      {sub === 'history'  && <IndexHistory  marketDates={marketDates} />}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   BREADTH SECTION
───────────────────────────────────────────────────────────────── */

function BreadthSection({ marketDates }) {
  const [sub, setSub]         = useState('history');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd]     = useState('');
  const [data, setData]       = useState([]);
  const [snap, setSnap]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const r = defaultRange(marketDates, 3);
    setStart(r.start); setEnd(r.end);
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
    <SectionCard title="Market Breadth" subtitle="Advances · Declines · Unchanged · Price-band hits">
      <SubTabBar tabs={[{ key: 'history', label: 'History' }, { key: 'snapshot', label: 'Snapshot' }]} active={sub} onChange={setSub} />

      {sub === 'snapshot' && (
        loading ? <Loader /> : snap ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <MetricCard title="Advances"        value={fmtInt(snap.advances)}        accent={C.green} />
            <MetricCard title="Declines"        value={fmtInt(snap.declines)}        accent={C.red}   />
            <MetricCard title="Unchanged"       value={fmtInt(snap.unchanged)}       accent={C.muted} />
            <MetricCard title="Price Band Hits" value={fmtInt(snap.price_band_hits)} accent={C.amber} />
            {snap.advances != null && snap.declines != null && (
              <MetricCard
                title="A/D Ratio"
                value={((snap.advances / (snap.advances + snap.declines)) || 0).toFixed(3)}
                accent={snap.advances > snap.declines ? C.green : C.red}
              />
            )}
          </div>
        ) : <Empty msg="No breadth data." />
      )}

      {sub === 'history' && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
          </div>
          {loading ? <Loader /> : data.length > 0 ? (
            <div className="space-y-4">
              <p className="text-xs text-white/40 uppercase tracking-wider">Advances vs Declines</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                  <YAxis tick={AXIS_TICK} width={48} tickLine={false} axisLine={AXIS_LINE} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => fmtInt(v)} />} />
                  <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
                  <Bar dataKey="advances" name="Advances" stackId="a" fill={C.green} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="declines" name="Declines" stackId="a" fill={C.red} />
                </BarChart>
              </ResponsiveContainer>

              <p className="text-xs text-white/40 uppercase tracking-wider mt-4">AD Ratio</p>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                  <YAxis tick={AXIS_TICK} tickFormatter={(v) => fmt(v, 2)} width={48} tickLine={false} axisLine={AXIS_LINE} domain={[0, 1]} />
                  <ReferenceLine y={0.5} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v, 3)} />} />
                  <Line dataKey="ad_ratio" name="AD Ratio" stroke={C.accent} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
        </>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   TOP STOCKS
   DB cols: trade_date, ticker, series, prev_close, open, high,
            low, close, volume, turnover, trade_count, pct_change
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
    market.topStocks(tradeDate, { series: 'EQ', limit: 25 })
      .then(setData).catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const columns = [
    { key: '_rank',      label: '#',          align: 'left',  render: (r) => <span className="text-white/30 text-xs">{r._rank}</span> },
    { key: 'ticker',     label: 'Symbol',     align: 'left',  render: (r) => <span className="font-semibold text-white">{r.ticker}</span> },
    { key: 'series',     label: 'Series',     align: 'left',  render: (r) => <span className="text-white/40 text-xs">{r.series}</span> },
    { key: 'close',      label: 'Close',      align: 'right', render: (r) => <span className="text-white">{fmt(r.close, 2)}</span> },
    { key: 'prev_close', label: 'Prev Close', align: 'right', render: (r) => <span className="text-white/55">{fmt(r.prev_close, 2)}</span> },
    { key: 'pct_change', label: 'Change %',   align: 'right',
      render: (r) => (
        <span className="font-medium tabular-nums" style={{ color: pctColor(r.pct_change) }}>
          {pctSign(r.pct_change)}{fmt(r.pct_change)}%
        </span>
      ),
    },
    { key: 'turnover',   label: 'Value (Cr)', align: 'right', render: (r) => <span className="text-white/70">{fmt(r.turnover, 1)}</span> },
    { key: 'volume',     label: 'Volume',     align: 'right', render: (r) => <span className="text-white/50">{fmtInt(r.volume)}</span> },
  ];

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
        <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
          {[...marketDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      {loading ? <Loader /> : data.length > 0
        ? <DataTable columns={columns} rows={data.map((r, i) => ({ ...r, _rank: i + 1 }))} rowKey="ticker" maxHeight={520} />
        : <Empty />}
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
    // Returns { gainers: [...], losers: [...] }
    // DB cols: trade_date, ticker, series, prev_close, close, turnover, volume, pct_change
    market.topGainersLosers(tradeDate, { series: 'EQ', limit: 15, minTurnover: 100 })
      .then((res) => { setGainers(res.gainers || []); setLosers(res.losers || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tradeDate]);

  const columns = [
    { key: '_rank',      label: '#',          align: 'left',  render: (r) => <span className="text-white/30 text-xs">{r._rank}</span> },
    { key: 'ticker',     label: 'Symbol',     align: 'left',  render: (r) => <span className="font-semibold text-white">{r.ticker}</span> },
    { key: 'prev_close', label: 'Prev Close', align: 'right', render: (r) => <span className="text-white/55">{fmt(r.prev_close, 2)}</span> },
    { key: 'close',      label: 'Close',      align: 'right', render: (r) => <span className="text-white">{fmt(r.close, 2)}</span> },
    { key: 'pct_change', label: 'Change %',   align: 'right',
      render: (r) => (
        <span className="font-medium tabular-nums" style={{ color: pctColor(r.pct_change) }}>
          {pctSign(r.pct_change)}{fmt(r.pct_change)}%
        </span>
      ),
    },
    { key: 'turnover',   label: 'Value (Cr)', align: 'right', render: (r) => <span className="text-white/70">{fmt(r.turnover, 1)}</span> },
  ];

  const rows = (side === 'gainers' ? gainers : losers).map((r, i) => ({ ...r, _rank: i + 1 }));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
          <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
            {[...marketDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSide('gainers')}
            className={`px-4 py-2 rounded-xl border text-sm transition ${
              side === 'gainers'
                ? 'border-[#26a69a]/30 bg-[#26a69a]/10 text-[#26a69a]'
                : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
            }`}
          >
            Gainers
          </button>
          <button
            onClick={() => setSide('losers')}
            className={`px-4 py-2 rounded-xl border text-sm transition ${
              side === 'losers'
                ? 'border-[#ef5350]/30 bg-[#ef5350]/10 text-[#ef5350]'
                : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
            }`}
          >
            Losers
          </button>
        </div>
      </div>
      {loading ? <Loader /> : rows.length > 0
        ? <DataTable columns={columns} rows={rows} rowKey="ticker" maxHeight={520} />
        : <Empty msg={`No ${side} data for selected date.`} />}
    </>
  );
}

function TopStocksSection({ marketDates }) {
  const [sub, setSub] = useState('value');
  return (
    <SectionCard title="Top Stocks" subtitle="Daily ranked lists from NSE market activity">
      <SubTabBar
        tabs={[{ key: 'value', label: 'Top 25 by Value' }, { key: 'movers', label: 'Gainers / Losers' }]}
        active={sub}
        onChange={setSub}
      />
      {sub === 'value'  && <TopByValue    marketDates={marketDates} />}
      {sub === 'movers' && <GainersLosers marketDates={marketDates} />}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   SECURITIES
   DB cols: trade_date, ticker, series, prev_close, open, high,
            low, close, avg_price, volume, turnover, trade_count,
            delivery_qty, delivery_pct, pct_change
───────────────────────────────────────────────────────────────── */

function SecuritiesSection({ marketDates }) {
  const [sub, setSub]           = useState('snapshot');
  const [series, setSeries]     = useState('EQ');
  const [tradeDate, setDate]    = useState('');
  const [symbol, setSymbol]     = useState('');
  const [startDate, setStart]   = useState('');
  const [endDate, setEnd]       = useState('');
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
    try { setSnapData(await market.securitySnapshot(tradeDate, { series: series || 'EQ' })); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate, series]);

  const loadHist = useCallback(async () => {
    if (!symbol.trim() || !startDate || !endDate) return;
    setLoading(true);
    try { setHistData(await market.securityHistory(symbol.trim(), startDate, endDate, series || 'EQ')); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [symbol, startDate, endDate, series]);

  useEffect(() => { if (sub === 'snapshot') loadSnap(); }, [sub, loadSnap]);

  const snapCols = [
    { key: 'ticker',       label: 'Symbol',        align: 'left',  render: (r) => <span className="font-semibold text-white">{r.ticker}</span> },
    { key: 'series',       label: 'Series',        align: 'left',  render: (r) => <span className="text-white/40 text-xs">{r.series}</span> },
    { key: 'close',        label: 'Close',         align: 'right', render: (r) => <span className="text-white">{fmt(r.close, 2)}</span> },
    { key: 'pct_change',   label: 'Change %',      align: 'right',
      render: (r) => <span className="font-medium tabular-nums" style={{ color: pctColor(r.pct_change) }}>{pctSign(r.pct_change)}{fmt(r.pct_change)}%</span>
    },
    { key: 'turnover',     label: 'Turnover (Cr)', align: 'right', render: (r) => <span className="text-white/70">{fmt(r.turnover, 1)}</span> },
    { key: 'volume',       label: 'Volume',        align: 'right', render: (r) => <span className="text-white/55">{fmtInt(r.volume)}</span> },
    { key: 'delivery_pct', label: 'Del %',         align: 'right',
      render: (r) => <span className="text-white/40">{r.delivery_pct != null ? `${fmt(r.delivery_pct, 1)}%` : '—'}</span>
    },
  ];

  return (
    <SectionCard title="Securities" subtitle="Close · Traded value · Quantity for every NSE-traded symbol">
      <SubTabBar
        tabs={[{ key: 'snapshot', label: 'Daily Snapshot' }, { key: 'history', label: 'Symbol History' }]}
        active={sub}
        onChange={setSub}
      />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <label className="text-xs text-white/50 uppercase tracking-wider">Series</label>
          <select value={series} onChange={(e) => setSeries(e.target.value)}>
            {['EQ', 'BE', 'BZ', 'SM', 'ST'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {sub === 'snapshot' && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
            <select value={tradeDate} onChange={(e) => setDate(e.target.value)}>
              {[...marketDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}

        {sub === 'history' && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-white/50 uppercase tracking-wider">Symbol</label>
              <input
                type="text"
                value={symbol}
                placeholder="e.g. HDFCBANK"
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="w-36"
              />
            </div>
            <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
            <button
              onClick={loadHist}
              className="px-4 py-1.5 rounded-lg border border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0] text-xs transition hover:bg-[#00B0F0]/20"
            >
              Load
            </button>
          </>
        )}
      </div>

      {sub === 'snapshot' && (
        loading ? <Loader /> : snapData.length > 0
          ? <DataTable columns={snapCols} rows={snapData} rowKey="ticker" maxHeight={520} />
          : <Empty />
      )}

      {sub === 'history' && (
        loading ? <Loader /> : histData.length > 0 ? (
          <div className="space-y-4">
            {/* Price — correct field: close */}
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={histData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.purple} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => fmt(v, 0)} width={64} tickLine={false} axisLine={AXIS_LINE} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v, 2)} />} />
                <Area dataKey="close" name="Close" stroke={C.purple} fill="url(#priceGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            {/* Turnover — correct field: turnover */}
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={histData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${fmt(v, 0)}Cr`} width={60} tickLine={false} axisLine={AXIS_LINE} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => `₹${fmt(v, 1)} Cr`} />} />
                <Bar dataKey="turnover" name="Turnover" fill={C.accent} radius={[2, 2, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>

            {histData.some((r) => r.delivery_pct != null) && (
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={histData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                  <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${fmt(v, 0)}%`} width={44} tickLine={false} axisLine={AXIS_LINE} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v, 1)}%`} />} />
                  <Line dataKey="delivery_pct" name="Delivery %" stroke={C.amber} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : <Empty msg="Enter a symbol and click Load." />
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   FII STATS
   client.fii.stats(start, end, instruments) — instruments is array,
   client does .join(',') internally
───────────────────────────────────────────────────────────────── */

function FIIStats({ allDates }) {
  const [instList, setInstList]     = useState([]);
  const [instFilter, setInstFilter] = useState('INDEX FUTURES');
  const [startDate, setStart]       = useState('');
  const [endDate, setEnd]           = useState('');
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    fii.instruments().then(setInstList).catch(console.error);
    const r = defaultRange(allDates, 3);
    setStart(r.start); setEnd(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate || !instFilter) return;
    setLoading(true);
    try {
      // client does .join(',') — must pass array
      setData(await fii.stats(startDate, endDate, [instFilter]));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, instFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <SectionCard title="FII Derivatives Statistics" subtitle="Buy · Sell · Net contracts · OI from NSE FII stats file">
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-white/50 uppercase tracking-wider">Instrument</label>
          <select value={instFilter} onChange={(e) => setInstFilter(e.target.value)}>
            {instList.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
      </div>

      {loading ? <Loader /> : data.length > 0 ? (
        <div className="space-y-5">
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Net Contracts (Buy − Sell)</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} width={52} tickLine={false} axisLine={AXIS_LINE} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => fmtInt(v)} />} />
                <Bar dataKey="net_contracts" name="Net Contracts" radius={[2, 2, 0, 0]}>
                  {data.map((row, i) => <Cell key={i} fill={(row.net_contracts ?? 0) >= 0 ? C.green : C.red} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Open Interest (Contracts)</p>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${(v / 1e5).toFixed(1)}L`} width={52} tickLine={false} axisLine={AXIS_LINE} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => fmtInt(v)} />} />
                <Line dataKey="oi_contracts" name="OI Contracts" stroke={C.accent} dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : <Empty />}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   VOLATILITY
───────────────────────────────────────────────────────────────── */

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
    if (!ticker || !startDate || !endDate) return;
    setLoading(true);
    try { setSeries(await volatility.series(ticker, startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [ticker, startDate, endDate]);

  useEffect(() => { if (sub === 'snapshot') loadSnap();  }, [sub, loadSnap]);
  useEffect(() => { if (sub === 'series')   loadSeries(); }, [sub, loadSeries]);

  const volClass = (v) =>
    v == null    ? 'text-white/40'
    : v > 0.6   ? 'text-[#ef5350]'
    : v > 0.35  ? 'text-[#FFA726]'
    : 'text-[#26a69a]';

  const snapCols = [
    { key: '_i',                    label: '#',          align: 'left',  render: (r) => <span className="text-white/30 text-xs">{r._i}</span> },
    { key: 'ticker',                label: 'Ticker',     align: 'left',  render: (r) => <span className="font-semibold text-white">{r.ticker}</span> },
    { key: 'applicable_annual_vol', label: 'Ann. Vol',   align: 'right',
      render: (r) => (
        <span className={`font-medium ${volClass(r.applicable_annual_vol)}`}>
          {r.applicable_annual_vol != null ? `${(r.applicable_annual_vol * 100).toFixed(1)}%` : '—'}
        </span>
      ),
    },
    { key: 'underlying_annual_vol', label: 'Underlying', align: 'right',
      render: (r) => <span className="text-white/70">{r.underlying_annual_vol != null ? `${(r.underlying_annual_vol * 100).toFixed(1)}%` : '—'}</span>
    },
    { key: 'futures_annual_vol',    label: 'Futures',    align: 'right',
      render: (r) => <span className="text-white/70">{r.futures_annual_vol != null ? `${(r.futures_annual_vol * 100).toFixed(1)}%` : '—'}</span>
    },
    { key: 'applicable_daily_vol',  label: 'Daily Vol',  align: 'right',
      render: (r) => <span className="text-white/40">{r.applicable_daily_vol != null ? `${(r.applicable_daily_vol * 100).toFixed(2)}%` : '—'}</span>
    },
  ];

  return (
    <SectionCard title="FO Volatility (EWMA)" subtitle="Underlying and futures EWMA daily + annualised volatility from NSE FOVOLT files">
      <SubTabBar tabs={[{ key: 'snapshot', label: 'Cross-section' }, { key: 'series', label: 'Time Series' }]} active={sub} onChange={setSub} />

      {sub === 'snapshot' && (
        <>
          <div className="flex items-center gap-3 mb-5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
            <select value={tradeDate} onChange={(e) => setDate(e.target.value)}>
              {[...volDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {loading ? <Loader /> : (
            <DataTable columns={snapCols} rows={snapData.map((r, i) => ({ ...r, _i: i + 1 }))} rowKey="ticker" maxHeight={500} />
          )}
        </>
      )}

      {sub === 'series' && (
        <>
          <div className="flex flex-wrap items-end gap-4 mb-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-white/50 uppercase tracking-wider">Ticker</label>
              <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
                <option value="">— Select —</option>
                {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <DateRangeRow allDates={volDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
          </div>

          {loading ? <Loader /> : seriesData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={seriesData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} width={48} tickLine={false} axisLine={AXIS_LINE} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
                <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
                <Line dataKey="applicable_annual_vol" name="Applicable" stroke={C.accent}  dot={false} strokeWidth={2} />
                <Line dataKey="underlying_annual_vol" name="Underlying" stroke={C.green}   dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
                <Line dataKey="futures_annual_vol"    name="Futures"    stroke={C.amber}   dot={false} strokeWidth={1.2} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty msg="Select a ticker and date range." />}
        </>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   RESEARCH — FII vs Nifty
───────────────────────────────────────────────────────────────── */

function FIIVsNifty({ allDates }) {
  const [startDate, setStart] = useState('');
  const [endDate, setEnd]     = useState('');
  const [data, setData]       = useState([]);
  const [corr, setCorr]       = useState(null);
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
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await research.fiiVsNifty(startDate, endDate);
      setData(raw);
      setCorr(pearson(raw, 'fii_net_oi_lag1', 'nifty_return_next'));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const corrAccent =
    corr == null             ? C.muted
    : Math.abs(corr) > 0.3  ? C.green
    : Math.abs(corr) > 0.15 ? C.amber
    : C.red;

  const corrLabel =
    corr == null             ? ''
    : Math.abs(corr) > 0.3  ? 'strong'
    : Math.abs(corr) > 0.15 ? 'weak'
    : 'noise';

  return (
    <SectionCard
      title="FII Index Futures OI vs Nifty Returns"
      subtitle="Lagged correlation — does FII net futures OI on day T predict Nifty return on day T+1?"
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
        {corr != null && (
          <MetricCard title="Lag-1 Correlation" value={corr.toFixed(3)} subtitle={corrLabel} accent={corrAccent} />
        )}
      </div>

      {loading ? <Loader /> : data.length > 0 ? (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="trade_date" tick={AXIS_TICK} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false} axisLine={AXIS_LINE} />
              <YAxis yAxisId="oi"  tick={AXIS_TICK} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} width={52} tickLine={false} axisLine={AXIS_LINE} />
              <YAxis yAxisId="ret" orientation="right" tick={AXIS_TICK} tickFormatter={(v) => `${v.toFixed(1)}%`} width={48} tickLine={false} axisLine={AXIS_LINE} />
              <ReferenceLine yAxisId="oi" y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTooltip valueFormatter={(v, name) => name === 'FII Net OI' ? fmtInt(v) : `${fmt(v, 2)}%`} />} />
              <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
              <Line yAxisId="oi"  dataKey="fii_net_oi"       name="FII Net OI"    stroke={C.accent} dot={false} strokeWidth={1.5} />
              <Line yAxisId="ret" dataKey="nifty_return_pct" name="Nifty Return%" stroke={C.amber}  dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-3 text-xs text-white/35">
            FII Net OI (blue, left axis) vs Nifty daily return % (amber dashed, right axis).
            Lag-1 correlation uses T-1 FII OI to predict T Nifty return.
          </p>
        </>
      ) : <Empty />}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

const TOP_TABS = [
  { key: 'indices',    label: 'Indices'    },
  { key: 'breadth',   label: 'Breadth'    },
  { key: 'top_stocks', label: 'Top Stocks' },
  { key: 'securities', label: 'Securities' },
  { key: 'fii_stats',  label: 'FII Stats'  },
  { key: 'volatility', label: 'Volatility' },
  { key: 'research',   label: 'Research'   },
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
        setAllDates(pd);
        setMktDates(md);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div className="h-[calc(100vh-64px)] flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Market & Institutional Flow</h1>
        <p className="mt-1 text-sm text-white/45">
          Indices · Breadth · Securities · FII · Volatility · Research
        </p>
      </div>

      <TabBar tabs={TOP_TABS} active={activeSection} onChange={setActive} />

      {activeSection === 'indices'    && <IndicesSection    marketDates={marketDates} />}
      {activeSection === 'breadth'    && <BreadthSection    marketDates={marketDates} />}
      {activeSection === 'top_stocks' && <TopStocksSection  marketDates={marketDates} />}
      {activeSection === 'securities' && <SecuritiesSection marketDates={marketDates} />}
      {activeSection === 'fii_stats'  && <FIIStats          allDates={allDates} />}
      {activeSection === 'volatility' && <VolatilitySection />}
      {activeSection === 'research'   && <FIIVsNifty        allDates={allDates} />}
    </div>
  );
}
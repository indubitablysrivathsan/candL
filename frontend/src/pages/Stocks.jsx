// frontend/src/pages/Stocks.jsx

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

import MetricCard    from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { stocks, formatCurrency, formatNumber } from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */

const CHART_COLORS = {
  accent:  '#00B0F0',
  green:   '#26a69a',
  red:     '#ef5350',
  amber:   '#FFA726',
  purple:  '#B39DDB',
  gold:    '#FFD700',
  muted:   'rgba(255,255,255,0.25)',
};

/* ─────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────── */

const fmt = (n, dec = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec });

const pctColor = (v) =>
  v > 0 ? CHART_COLORS.green : v < 0 ? CHART_COLORS.red : CHART_COLORS.muted;

/* ─────────────────────────────────────────────────────────────────
   CHART TOOLTIP
───────────────────────────────────────────────────────────────── */

function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#11151d] border border-white/10 rounded-xl px-4 py-3 shadow-2xl min-w-[160px]">
      <p className="text-xs text-white/50 mb-2">{label}</p>
      <div className="space-y-1.5">
        {payload.map((p, i) => (
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

/* ─────────────────────────────────────────────────────────────────
   TAB BAR
───────────────────────────────────────────────────────────────── */

function TabBar({ tabs, activeTab, onChange }) {
  return (
    <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-4 py-2 rounded-xl border text-sm transition whitespace-nowrap ${
            activeTab === key
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

/* ─────────────────────────────────────────────────────────────────
   SECTION CARD
───────────────────────────────────────────────────────────────── */

function SectionCard({ title, subtitle, children, action }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   OHLCV + DELIVERY VIEW
───────────────────────────────────────────────────────────────── */

function OHLCView({ tickers, dates }) {
  const [ticker,    setTicker]    = useState('');
  const [startDate, setStartDate] = useState(dates.at(-60) ?? '');
  const [endDate,   setEndDate]   = useState(dates.at(-1)  ?? '');
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [chartTab,  setChartTab]  = useState('price');

  const load = useCallback(async () => {
    if (!ticker || !startDate || !endDate) return;
    setLoading(true);
    try {
      const d = await stocks.rolling(ticker, startDate, endDate);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [ticker, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const latest = data.at(-1);

  const metricCards = latest ? [
    { title: 'Close',       value: formatCurrency(latest.close, 2),                            accent: CHART_COLORS.gold   },
    { title: 'Day Change',  value: `${latest.daily_return > 0 ? '+' : ''}${fmt(latest.daily_return)}%`,
      accent: latest.daily_return >= 0 ? CHART_COLORS.green : CHART_COLORS.red },
    { title: 'Volume',      value: fmt(latest.volume, 0),                                       accent: CHART_COLORS.accent },
    { title: 'Delivery %',  value: latest.delivery_pct != null ? `${fmt(latest.delivery_pct)}%` : '—',
      accent: latest.delivery_pct > 60 ? CHART_COLORS.green : latest.delivery_pct > 40 ? CHART_COLORS.amber : CHART_COLORS.muted },
    { title: 'Turnover',    value: latest.turnover != null ? `₹${fmt(latest.turnover, 0)} Cr` : '—', accent: CHART_COLORS.purple },
    { title: 'Rel. Volume', value: fmt(latest.rel_volume),                                      accent: CHART_COLORS.amber  },
  ] : [];

  const chartTabs = [
    { key: 'price',    label: 'Price' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'volume',   label: 'Volume' },
  ];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Ticker</label>
            <select
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="w-44"
            >
              <option value="">— Select —</option>
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button
            onClick={load}
            disabled={!ticker || loading}
            className="px-5 py-2 rounded-xl border border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0] text-sm transition hover:bg-[#00B0F0]/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      {metricCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {metricCards.map((c) => (
            <MetricCard key={c.title} title={c.title} value={c.value} accent={c.accent} />
          ))}
        </div>
      )}

      {/* Charts */}
      {loading && (
        <div className="card min-h-[300px] flex items-center justify-center">
          <LoadingSpinner />
        </div>
      )}

      {!loading && data.length > 0 && (
        <SectionCard
          title={`${ticker} — ${chartTab === 'price' ? 'Price & Avg' : chartTab === 'delivery' ? 'Delivery %' : 'Volume'}`}
          subtitle={`${startDate} → ${endDate} · ${data.length} trading days`}
        >
          <TabBar tabs={chartTabs} activeTab={chartTab} onChange={setChartTab} />

          {/* Price */}
          {chartTab === 'price' && (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} domain={['auto', 'auto']}
                  tickFormatter={(v) => `₹${fmt(v, 0)}`} width={72} tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => formatCurrency(v, 2)} />} />
                <Line dataKey="close"     name="Close"   stroke={CHART_COLORS.accent} dot={false} strokeWidth={2} />
                <Line dataKey="avg_price" name="Avg"     stroke={CHART_COLORS.amber}  dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
              </LineChart>
            </ResponsiveContainer>
          )}

          {/* Delivery */}
          {chartTab === 'delivery' && (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                    tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                    tickFormatter={(v) => `${v}%`} width={44} tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v)}%`} />} />
                  <Bar dataKey="delivery_pct" name="Delivery %" radius={[2, 2, 0, 0]}>
                    {data.map((row, i) => (
                      <Cell key={i}
                        fill={row.delivery_pct > 60 ? CHART_COLORS.green : row.delivery_pct > 40 ? CHART_COLORS.amber : CHART_COLORS.muted}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                    tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} width={44} tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v)}%`} />} />
                  <Line dataKey="delivery_pct_ma5"  name="MA5"  stroke={CHART_COLORS.accent} dot={false} strokeWidth={1.5} />
                  <Line dataKey="delivery_pct_ma20" name="MA20" stroke={CHART_COLORS.amber}  dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Volume */}
          {chartTab === 'volume' && (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                    tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                    tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} width={52} tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v, 0)} />} />
                  <Bar dataKey="volume" name="Volume" radius={[2, 2, 0, 0]}>
                    {data.map((row, i) => (
                      <Cell key={i}
                        fill={row.rel_volume > 2 ? CHART_COLORS.amber : row.rel_volume > 1.5 ? CHART_COLORS.accent : CHART_COLORS.muted}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                    tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} width={44} tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <ReferenceLine y={1} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v)} />} />
                  <Line dataKey="rel_volume" name="Rel. Volume" stroke={CHART_COLORS.purple} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      )}

      {!loading && data.length === 0 && ticker && (
        <div className="card p-8">
          <p className="text-white/50 text-sm">No data available for the selected range.</p>
        </div>
      )}

      {!ticker && (
        <div className="card p-8">
          <p className="text-white/50 text-sm">Select a ticker above to load chart data.</p>
        </div>
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
      const d = await stocks.snapshot(tradeDate, 300);
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
    { key: 'ticker',      label: 'Ticker',        align: 'left',  render: (v) => <span className="font-semibold text-[#00B0F0]">{v}</span> },
    { key: 'close',       label: 'Close',          align: 'right', render: (v) => formatCurrency(v, 2) },
    { key: 'pct_change',  label: 'Chg %',          align: 'right', render: (v) => (
      <span style={{ color: pctColor(v) }}>{v > 0 ? '+' : ''}{fmt(v)}%</span>
    )},
    { key: 'volume',      label: 'Volume',         align: 'right', render: (v) => fmt(v, 0) },
    { key: 'turnover',    label: 'Turnover (Cr)',  align: 'right', render: (v) => fmt(v, 1) },
    { key: 'delivery_pct',label: 'Del %',          align: 'right', render: (v) => (
      v != null
        ? <span style={{ color: v > 60 ? CHART_COLORS.green : v > 40 ? CHART_COLORS.amber : 'rgba(255,255,255,0.7)' }}>{fmt(v)}%</span>
        : '—'
    )},
    { key: 'trade_count', label: 'Trades',         align: 'right', render: (v) => fmt(v, 0) },
  ];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
            <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
              {[...dates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Filter</label>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search ticker…"
            />
          </div>
          <span className="text-xs text-white/40 self-end pb-2">{displayed.length} rows</span>
        </div>
      </div>

      {loading ? (
        <div className="card min-h-[300px] flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  {cols.map(({ key, label, align }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="cursor-pointer select-none hover:text-white transition"
                      style={{ textAlign: align }}
                    >
                      {label}{sortKey === key ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((row, i) => (
                  <tr key={row.ticker + i}>
                    {cols.map(({ key, align }) => (
                      <td key={key} style={{ textAlign: align }}>
                        {cols.find((c) => c.key === key)?.render(row[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
            <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
              {[...dates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <p className="text-xs text-white/40 self-end pb-2">
            Top 50 by delivery % — high delivery signals institutional conviction
          </p>
        </div>
      </div>

      {loading ? (
        <div className="card min-h-[300px] flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-2">
          {data.map((row, i) => {
            const barPct = Math.max(row.delivery_pct ?? 0, 2);
            const barColor =
              row.delivery_pct > 70 ? CHART_COLORS.green
              : row.delivery_pct > 50 ? CHART_COLORS.amber
              : CHART_COLORS.accent;

            return (
              <div key={row.ticker} className="card relative overflow-hidden p-0">
                {/* background delivery bar */}
                <div
                  className="absolute inset-y-0 left-0 opacity-10 pointer-events-none"
                  style={{ width: `${Math.min(barPct, 100)}%`, backgroundColor: barColor }}
                />
                <div className="relative flex items-center gap-3 px-4 py-3">
                  <span className="w-7 text-xs text-white/30 tabular-nums text-center">{i + 1}</span>
                  <span className="w-28 font-semibold text-sm text-white shrink-0">{row.ticker}</span>
                  <span className="flex-1 text-xs text-white/40 truncate hidden md:block">{row.instrument_name}</span>
                  <span className="text-sm tabular-nums" style={{ color: pctColor(row.pct_change) }}>
                    {row.pct_change > 0 ? '+' : ''}{fmt(row.pct_change)}%
                  </span>
                  <span className="text-sm text-white tabular-nums w-24 text-right">{formatCurrency(row.close, 2)}</span>
                  <span
                    className="text-base font-bold tabular-nums w-16 text-right"
                    style={{ color: barColor }}
                  >
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
    <div className="h-[calc(100vh-64px)] flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );

  const views = [
    { key: 'ohlc',     label: 'OHLCV + Delivery' },
    { key: 'screener', label: 'Screener' },
    { key: 'delivery', label: 'Delivery Leaders' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">EQ Stocks</h1>
        <p className="mt-1 text-sm text-white/45">
          {tickers.length} active tickers · {dates.length} trading days
        </p>
      </div>

      <TabBar tabs={views} activeTab={view} onChange={setView} />

      {view === 'ohlc'     && <OHLCView     tickers={tickers} dates={dates} />}
      {view === 'screener' && <ScreenerView dates={dates} />}
      {view === 'delivery' && <DeliveryView dates={dates} />}
    </div>
  );
}
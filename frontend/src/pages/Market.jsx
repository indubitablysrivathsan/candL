// frontend/src/pages/Market.jsx

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts';

import MetricCard    from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { participant, fii, volatility, market, research, formatCurrency, formatNumber } from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */

const C = {
  accent:  '#00B0F0',
  green:   '#26a69a',
  red:     '#ef5350',
  amber:   '#FFA726',
  purple:  '#B39DDB',
  gold:    '#FFD700',
  pink:    '#FF69B4',
  muted:   'rgba(255,255,255,0.25)',
};

const PARTICIPANT_COLORS = {
  FII:    '#00B0F0',
  DII:    '#26a69a',
  Client: '#FFA726',
  Pro:    '#B39DDB',
};

/* ─────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────── */

const fmt = (n, dec = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec });

const pctColor = (v) => v > 0 ? C.green : v < 0 ? C.red : C.muted;

function defaultRange(allDates, months = 3) {
  if (!allDates.length) return { start: '', end: '' };
  const end   = allDates.at(-1);
  const start = allDates.at(-(months * 22)) ?? allDates[0];
  return { start, end };
}

/* ─────────────────────────────────────────────────────────────────
   SHARED UI PIECES
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
  const presets = [
    { label: '1M', months: 1 },
    { label: '3M', months: 3 },
    { label: '6M', months: 6 },
    { label: '1Y', months: 12 },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {presets.map(({ label, months }) => (
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

/* ─────────────────────────────────────────────────────────────────
   INDEX SNAPSHOT
───────────────────────────────────────────────────────────────── */

function IndexSnapshot({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(false);

  useEffect(() => {
    if (marketDates.length) setTradeDate(marketDates.at(-1));
  }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.indexSnapshot(tradeDate)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tradeDate]);

  return (
    <SectionCard
      title="Index Snapshot"
      subtitle="All NSE indices performance on a given date"
    >
      <div className="flex items-center gap-3 mb-5">
        <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
        <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
          {[...marketDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {data.filter((idx) => idx.close != null && idx.pct_change != null).map((idx) => (
            <MetricCard
              key={idx.index_name}
              title={idx.index_name}
              value={fmt(idx.close, 2)}
              subtitle={
                <span style={{ color: pctColor(idx.pct_change) }}>
                  {idx.pct_change > 0 ? '+' : ''}{fmt(idx.pct_change)}%
                  <span className="text-white/30 ml-1">({idx.gain_loss > 0 ? '+' : ''}{fmt(idx.gain_loss)})</span>
                </span>
              }
              accent={idx.pct_change > 0 ? C.green : idx.pct_change < 0 ? C.red : C.muted}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   INDEX HISTORY
───────────────────────────────────────────────────────────────── */

function IndexHistory({ marketDates }) {
  const [indexNames, setIndexNames] = useState([]);
  const [selected,   setSelected]   = useState('');
  const [startDate,  setStartDate]  = useState('');
  const [endDate,    setEndDate]    = useState('');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    market.indexNames()
      .then((names) => {
        setIndexNames(names);
        if (names.length) setSelected(names[0]);
      })
      .catch(console.error);
    const r = defaultRange(marketDates, 6);
    setStartDate(r.start); setEndDate(r.end);
  }, [marketDates]);

  const load = useCallback(async () => {
    if (!selected || !startDate || !endDate) return;
    setLoading(true);
    try {
      const d = await market.indexHistory(selected, startDate, endDate);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [selected, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  return (
    <SectionCard
      title="Index History"
      subtitle="Close price and daily % change over time"
    >
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-white/50 uppercase tracking-wider">Index</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {indexNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : data.length > 0 ? (
        <div className="space-y-4">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(v) => fmt(v, 0)} width={64} tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v, 2)} />} />
              <Line dataKey="close" name="Close" stroke={C.accent} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(v) => `${fmt(v, 1)}%`} width={52} tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => `${fmt(v, 2)}%`} />} />
              <Bar dataKey="pct_change" name="Change %" radius={[2, 2, 0, 0]}>
                {data.map((row, i) => (
                  <Cell key={i} fill={row.pct_change >= 0 ? C.green : C.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-white/40 text-sm py-8 text-center">No data for selected range.</p>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   FII DERIVATIVES STATS
───────────────────────────────────────────────────────────────── */

function FIIStats({ allDates }) {
  const [instFilter,  setInstFilter]  = useState('INDEX FUTURES');
  const [instruments, setInstruments] = useState([]);
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(false);

  useEffect(() => {
    fii.instruments().then(setInstruments).catch(console.error);
    const r = defaultRange(allDates, 3);
    setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate || !instFilter) return;
    setLoading(true);
    try {
      const d = await fii.stats(startDate, endDate, [instFilter]);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, instFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <SectionCard
      title="FII Derivatives Statistics"
      subtitle="Buy / Sell / Net contracts + OI from NSE FII stats file"
    >
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-white/50 uppercase tracking-wider">Instrument</label>
          <select value={instFilter} onChange={(e) => setInstFilter(e.target.value)}>
            {instruments.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Net Contracts (Buy − Sell)</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} width={52} tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v, 0)} />} />
                <Bar dataKey="net_contracts" name="Net Contracts" radius={[2, 2, 0, 0]}>
                  {data.map((row, i) => (
                    <Cell key={i} fill={row.net_contracts >= 0 ? C.green : C.red} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Open Interest (Contracts)</p>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={(v) => `${(v / 1e5).toFixed(1)}L`} width={52} tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => fmt(v, 0)} />} />
                <Line dataKey="oi_contracts" name="OI Contracts" stroke={C.accent} dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   FII VS NIFTY RESEARCH
───────────────────────────────────────────────────────────────── */

function FIIVsNifty({ allDates }) {
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [corr,      setCorr]      = useState(null);

  useEffect(() => {
    const r = defaultRange(allDates, 6);
    setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const computeCorr = (rows, xKey, yKey) => {
    const xs = rows.map((r) => r[xKey]).filter((v) => v != null);
    const ys = rows.map((r) => r[yKey]).filter((v) => v != null);
    const n  = Math.min(xs.length, ys.length);
    if (n < 5) return null;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx2 += (xs[i] - mx) ** 2;
      dy2 += (ys[i] - my) ** 2;
    }
    return num / Math.sqrt(dx2 * dy2);
  };

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await research.fiiVsNifty(startDate, endDate);
      setData(raw);
      setCorr(computeCorr(raw, 'fii_net_oi_lag1', 'nifty_return_next'));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const corrAccent =
    corr == null         ? C.muted
    : Math.abs(corr) > 0.3  ? C.green
    : Math.abs(corr) > 0.15 ? C.amber
    : C.red;

  const corrLabel =
    corr == null         ? ''
    : Math.abs(corr) > 0.3  ? 'strong'
    : Math.abs(corr) > 0.15 ? 'weak'
    : 'noise';

  return (
    <SectionCard
      title="Research: FII Index Futures OI vs Nifty Returns"
      subtitle="Lagged correlation — does FII net futures OI on day T predict Nifty return on day T+1?"
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
        {corr != null && (
          <MetricCard
            title="Lag-1 Correlation"
            value={corr.toFixed(3)}
            subtitle={corrLabel}
            accent={corrAccent}
          />
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <YAxis yAxisId="oi"  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} width={52} tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <YAxis yAxisId="ret" orientation="right" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(v) => `${v.toFixed(1)}%`} width={48} tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <ReferenceLine yAxisId="oi" y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTooltip valueFormatter={(v, name) =>
                name === 'FII Net OI' ? fmt(v, 0) : `${fmt(v, 2)}%`
              } />} />
              <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
              <Line yAxisId="oi"  dataKey="fii_net_oi"       name="FII Net OI"   stroke={C.accent} dot={false} strokeWidth={1.5} />
              <Line yAxisId="ret" dataKey="nifty_return_pct" name="Nifty Return%" stroke={C.amber}  dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-3 text-xs text-white/35">
            FII Net OI (blue, left axis) vs Nifty daily return % (amber dashed, right axis). Lag-1 correlation uses T-1 FII OI to predict T Nifty return.
          </p>
        </>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   VOLATILITY
───────────────────────────────────────────────────────────────── */

function VolatilitySection() {
  const [tickers,     setTickers]     = useState([]);
  const [volDates,    setVolDates]    = useState([]);
  const [tradeDate,   setTradeDate]   = useState('');
  const [ticker,      setTicker]      = useState('');
  const [snapData,    setSnapData]    = useState([]);
  const [seriesData,  setSeriesData]  = useState([]);
  const [innerTab,    setInnerTab]    = useState('snapshot');
  const [loading,     setLoading]     = useState(false);
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [t, d] = await Promise.all([volatility.tickers(), volatility.dates()]);
        setTickers(t);
        setVolDates(d);
        setTradeDate(d.at(-1) ?? '');
        const r = defaultRange(d, 6);
        setStartDate(r.start); setEndDate(r.end);
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
    try { setSeriesData(await volatility.series(ticker, startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [ticker, startDate, endDate]);

  useEffect(() => { if (innerTab === 'snapshot') loadSnap();  }, [innerTab, loadSnap]);
  useEffect(() => { if (innerTab === 'series')   loadSeries(); }, [innerTab, loadSeries]);

  const volTabs = [
    { key: 'snapshot', label: 'Cross-section' },
    { key: 'series',   label: 'Time Series'   },
  ];

  return (
    <SectionCard
      title="FO Volatility (EWMA)"
      subtitle="Underlying and futures EWMA daily + annualised volatility from NSE FOVOLT files"
    >
      <TabBar tabs={volTabs} activeTab={innerTab} onChange={setInnerTab} />

      {innerTab === 'snapshot' && (
        <>
          <div className="flex items-center gap-3 mb-5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
            <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
              {[...volDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Ticker</th>
                      <th>Applicable Ann.Vol</th>
                      <th>Underlying Ann.Vol</th>
                      <th>Futures Ann.Vol</th>
                      <th>Daily Vol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapData.map((row, i) => (
                      <tr key={row.ticker}>
                        <td className="text-white/30 text-xs">{i + 1}</td>
                        <td className="font-semibold text-white">{row.ticker}</td>
                        <td className="text-right" style={{
                          color: row.applicable_annual_vol > 0.6 ? C.red
                            : row.applicable_annual_vol > 0.35 ? C.amber
                            : C.green
                        }}>
                          {row.applicable_annual_vol != null ? `${(row.applicable_annual_vol * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="text-right text-white/70">
                          {row.underlying_annual_vol != null ? `${(row.underlying_annual_vol * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="text-right text-white/70">
                          {row.futures_annual_vol != null ? `${(row.futures_annual_vol * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="text-right text-white/40">
                          {row.applicable_daily_vol != null ? `${(row.applicable_daily_vol * 100).toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {innerTab === 'series' && (
        <>
          <div className="flex flex-wrap items-end gap-4 mb-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-white/50 uppercase tracking-wider">Ticker</label>
              <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
                <option value="">— Select —</option>
                {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <DateRangeRow allDates={volDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : seriesData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={seriesData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} width={48} tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
                <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
                <Line dataKey="applicable_annual_vol" name="Applicable" stroke={C.accent} dot={false} strokeWidth={2} />
                <Line dataKey="underlying_annual_vol" name="Underlying" stroke={C.green}  dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
                <Line dataKey="futures_annual_vol"    name="Futures"    stroke={C.amber}  dot={false} strokeWidth={1.2} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-white/40 text-sm py-8 text-center">Select a ticker and date range.</p>
          )}
        </>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

export default function Market() {
  const [allDates,     setAllDates]     = useState([]);
  const [marketDates,  setMarketDates]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeSection, setActiveSection] = useState('indices');

  useEffect(() => {
    (async () => {
      try {
        const [pd, md] = await Promise.all([participant.dates(), market.dates()]);
        setAllDates(pd);
        setMarketDates(md);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div className="h-[calc(100vh-64px)] flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );

  const sections = [
    { key: 'indices',    label: 'Indices' },
    { key: 'fii_stats',  label: 'FII Stats' },
    { key: 'research',   label: 'Research' },
    { key: 'volatility', label: 'Volatility' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Market & Institutional Flow</h1>
        <p className="mt-1 text-sm text-white/45">
          Indices · FII derivatives · Volatility · Research
        </p>
      </div>

      <TabBar tabs={sections} activeTab={activeSection} onChange={setActiveSection} />

      {activeSection === 'indices' && (
        <div className="space-y-5">
          <IndexSnapshot  marketDates={marketDates} />
          <IndexHistory   marketDates={marketDates} />
        </div>
      )}

      {activeSection === 'fii_stats' && (
        <FIIStats allDates={allDates} />
      )}

      {activeSection === 'research' && (
        <FIIVsNifty allDates={allDates} />
      )}

      {activeSection === 'volatility' && (
        <VolatilitySection />
      )}
    </div>
  );
}
// frontend/src/pages/Participant.jsx

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts';

import MetricCard     from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { participant, formatNumber } from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */

const PARTICIPANT_COLORS = {
  FII:    '#00B0F0',
  DII:    '#26a69a',
  Client: '#FFA726',
  Pro:    '#B39DDB',
};

const PARTICIPANTS = ['FII', 'DII', 'Client', 'Pro'];

const ASSET_CLASSES = ['INDEX', 'EQUITY'];

const C = {
  accent:  '#00B0F0',
  green:   '#26a69a',
  red:     '#ef5350',
  amber:   '#FFA726',
  purple:  '#B39DDB',
  muted:   'rgba(255,255,255,0.25)',
};

/* ─────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────── */

const fmt = (n, dec = 0) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec });

const fmtK = (v) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_00_000) return `${(v / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)    return `${(v / 1_000).toFixed(1)}K`;
  return fmt(v);
};

function defaultRange(allDates, months = 3) {
  if (!allDates.length) return { start: '', end: '' };
  return {
    start: allDates.at(-(months * 22)) ?? allDates[0],
    end:   allDates.at(-1),
  };
}

/* ─────────────────────────────────────────────────────────────────
   SHARED UI
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
  return (
    <div className="flex items-center gap-2">
      {[1, 3, 6, 12].map((m) => (
        <button
          key={m}
          onClick={() => { const r = defaultRange(allDates, m); onStart(r.start); onEnd(r.end); }}
          className="px-3 py-1.5 rounded-lg border border-white/10 bg-[#151922] text-white/55 text-xs transition hover:bg-white/5 hover:text-white"
        >
          {m < 12 ? `${m}M` : '1Y'}
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
        <span className="text-white/30 text-sm">→</span>
        <input type="date" value={endDate}   onChange={(e) => onEnd(e.target.value)} />
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#11151d] border border-white/10 rounded-xl px-4 py-3 shadow-2xl min-w-[200px]">
      <p className="text-xs text-white/50 mb-2">{label}</p>
      <div className="space-y-1.5">
        {payload.map((p, i) => p.value != null && (
          <div key={i} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span style={{ color: p.color }}>{p.name}</span>
            </div>
            <span className="text-white font-medium tabular-nums">
              {valueFormatter ? valueFormatter(p.value, p.name) : fmtK(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   LATEST SNAPSHOT  (summary cards)
───────────────────────────────────────────────────────────────── */

function LatestSnapshot({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await participant.latest(assetClass);
      setData(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [assetClass]);

  useEffect(() => { load(); }, [load]);

  // pivot rows into participant → { long, short, net }
  const byParticipant = useMemo(() => {
    const map = {};
    data.forEach((r) => {
      if (!map[r.participant_type]) map[r.participant_type] = {};
      if (r.option_side === 'NA') {
        // futures row
        map[r.participant_type].fut_net = r.net_contracts;
        map[r.participant_type].fut_long  = r.long_contracts;
        map[r.participant_type].fut_short = r.short_contracts;
      } else if (r.option_side === 'Call') {
        map[r.participant_type].ce_net = r.net_contracts;
      } else if (r.option_side === 'Put') {
        map[r.participant_type].pe_net = r.net_contracts;
      }
    });
    return map;
  }, [data]);

  return (
    <SectionCard
      title="Latest Participant Positioning"
      subtitle="Most recent day snapshot — net long/short across futures and options"
    >
      <div className="flex items-center gap-3 mb-5">
        {ASSET_CLASSES.map((ac) => (
          <button
            key={ac}
            onClick={() => setAssetClass(ac)}
            className={`px-4 py-2 rounded-xl border text-sm transition ${
              assetClass === ac
                ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
            }`}
          >
            {ac}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {PARTICIPANTS.map((p) => {
            const d = byParticipant[p];
            const futNet = d?.fut_net;
            return (
              <div key={p} className="card p-4 space-y-3">
                {/* header */}
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PARTICIPANT_COLORS[p] }} />
                  <span className="text-sm font-semibold" style={{ color: PARTICIPANT_COLORS[p] }}>{p}</span>
                </div>
                {/* rows */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/45">Fut Net</span>
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: futNet == null ? C.muted : futNet >= 0 ? C.green : C.red }}
                    >
                      {futNet != null ? (futNet >= 0 ? '+' : '') + fmtK(futNet) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">Fut Long</span>
                    <span className="text-white/70 tabular-nums">{fmtK(d?.fut_long)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">Fut Short</span>
                    <span className="text-white/70 tabular-nums">{fmtK(d?.fut_short)}</span>
                  </div>
                  <div className="h-px bg-white/8 my-1" />
                  <div className="flex justify-between">
                    <span className="text-white/45">CE Net</span>
                    <span className="text-white/70 tabular-nums">{d?.ce_net != null ? fmtK(d.ce_net) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">PE Net</span>
                    <span className="text-white/70 tabular-nums">{d?.pe_net != null ? fmtK(d.pe_net) : '—'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   NET OI TIME SERIES  (futures)
───────────────────────────────────────────────────────────────── */

function NetOIChart({ allDates }) {
  const [assetClass,  setAssetClass]  = useState('INDEX');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [activeLines, setActiveLines] = useState(new Set(PARTICIPANTS));

  useEffect(() => {
    const r = defaultRange(allDates, 6);
    setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await participant.netOI(startDate, endDate, assetClass);
      // pivot: group by trade_date, create columns per participant (futures = option_side NA)
      const byDate = {};
      for (const r of raw) {
        if (!byDate[r.trade_date]) byDate[r.trade_date] = { trade_date: r.trade_date };
        byDate[r.trade_date][`${r.participant_type}_${r.option_side}`] = r.net_contracts;
      }
      setData(Object.values(byDate).sort((a, b) => a.trade_date.localeCompare(b.trade_date)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, assetClass]);

  useEffect(() => { load(); }, [load]);

  const toggleLine = (p) => setActiveLines((prev) => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });

  return (
    <SectionCard
      title="Participant Net OI — Futures"
      subtitle="Long minus short contracts. Positive = net long. FII is the dominant signal."
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <div className="flex items-center gap-2">
          {ASSET_CLASSES.map((ac) => (
            <button
              key={ac}
              onClick={() => setAssetClass(ac)}
              className={`px-3 py-2 rounded-xl border text-xs transition ${
                assetClass === ac
                  ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
              }`}
            >
              {ac}
            </button>
          ))}
        </div>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      {/* Participant toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PARTICIPANTS.map((p) => {
          const active = activeLines.has(p);
          return (
            <button
              key={p}
              onClick={() => toggleLine(p)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition"
              style={{
                borderColor:     active ? `${PARTICIPANT_COLORS[p]}40` : 'rgba(255,255,255,0.08)',
                backgroundColor: active ? `${PARTICIPANT_COLORS[p]}12` : '#151922',
                color:           active ? PARTICIPANT_COLORS[p] : 'rgba(255,255,255,0.45)',
              }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? PARTICIPANT_COLORS[p] : 'rgba(255,255,255,0.2)' }} />
              {p}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickFormatter={fmtK} width={60} tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
            <Tooltip content={<ChartTooltip valueFormatter={fmtK} />} />
            <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
            {PARTICIPANTS.map((p) => activeLines.has(p) && (
              <Line
                key={p}
                dataKey={`${p}_NA`}
                name={p}
                stroke={PARTICIPANT_COLORS[p]}
                dot={false}
                strokeWidth={p === 'FII' ? 2.5 : 1.5}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   NET VOLUME TIME SERIES
───────────────────────────────────────────────────────────────── */

function NetVolChart({ allDates }) {
  const [assetClass,  setAssetClass]  = useState('INDEX');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [activeLines, setActiveLines] = useState(new Set(PARTICIPANTS));

  useEffect(() => {
    const r = defaultRange(allDates, 3);
    setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await participant.netVol(startDate, endDate, assetClass);
      const byDate = {};
      for (const r of raw) {
        if (!byDate[r.trade_date]) byDate[r.trade_date] = { trade_date: r.trade_date };
        byDate[r.trade_date][`${r.participant_type}_${r.option_side}`] = r.net_contracts;
      }
      setData(Object.values(byDate).sort((a, b) => a.trade_date.localeCompare(b.trade_date)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, assetClass]);

  useEffect(() => { load(); }, [load]);

  const toggleLine = (p) => setActiveLines((prev) => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });

  return (
    <SectionCard
      title="Participant Net Volume — Futures"
      subtitle="Buy minus sell volume. Positive = net buyer."
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <div className="flex items-center gap-2">
          {ASSET_CLASSES.map((ac) => (
            <button
              key={ac}
              onClick={() => setAssetClass(ac)}
              className={`px-3 py-2 rounded-xl border text-xs transition ${
                assetClass === ac
                  ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
              }`}
            >
              {ac}
            </button>
          ))}
        </div>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {PARTICIPANTS.map((p) => {
          const active = activeLines.has(p);
          return (
            <button
              key={p}
              onClick={() => toggleLine(p)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition"
              style={{
                borderColor:     active ? `${PARTICIPANT_COLORS[p]}40` : 'rgba(255,255,255,0.08)',
                backgroundColor: active ? `${PARTICIPANT_COLORS[p]}12` : '#151922',
                color:           active ? PARTICIPANT_COLORS[p] : 'rgba(255,255,255,0.45)',
              }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? PARTICIPANT_COLORS[p] : 'rgba(255,255,255,0.2)' }} />
              {p}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickFormatter={fmtK} width={60} tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
            <Tooltip content={<ChartTooltip valueFormatter={fmtK} />} />
            <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
            {PARTICIPANTS.map((p) => activeLines.has(p) && (
              <Bar
                key={p}
                dataKey={`${p}_NA`}
                name={p}
                fill={PARTICIPANT_COLORS[p]}
                opacity={0.85}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   OPTIONS POSITIONING (CE vs PE net)
───────────────────────────────────────────────────────────────── */

function OptionsPositioning({ allDates }) {
  const [assetClass,   setAssetClass]   = useState('INDEX');
  const [participant_, setParticipant_] = useState('FII');
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [data,         setData]         = useState([]);
  const [loading,      setLoading]      = useState(false);

  useEffect(() => {
    const r = defaultRange(allDates, 3);
    setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await participant.netOI(startDate, endDate, assetClass);
      // filter to selected participant, pivot Call/Put columns
      const byDate = {};
      for (const r of raw) {
        if (r.participant_type !== participant_) continue;
        if (!byDate[r.trade_date]) byDate[r.trade_date] = { trade_date: r.trade_date };
        if (r.option_side === 'Call') byDate[r.trade_date].ce = r.net_contracts;
        if (r.option_side === 'Put')  byDate[r.trade_date].pe = r.net_contracts;
      }
      setData(Object.values(byDate).sort((a, b) => a.trade_date.localeCompare(b.trade_date)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, assetClass, participant_]);

  useEffect(() => { load(); }, [load]);

  const color = PARTICIPANT_COLORS[participant_];

  return (
    <SectionCard
      title="Options Net OI by Participant"
      subtitle="Net Call and Put OI for a selected participant. CE net long = bullish directional; PE net long = hedging or bearish."
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <div className="flex items-center gap-2">
          {ASSET_CLASSES.map((ac) => (
            <button
              key={ac}
              onClick={() => setAssetClass(ac)}
              className={`px-3 py-2 rounded-xl border text-xs transition ${
                assetClass === ac
                  ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
              }`}
            >
              {ac}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {PARTICIPANTS.map((p) => {
            const c = PARTICIPANT_COLORS[p];
            const active = participant_ === p;
            return (
              <button
                key={p}
                onClick={() => setParticipant_(p)}
                className="px-3 py-2 rounded-xl border text-xs transition"
                style={{
                  borderColor:     active ? `${c}40` : 'rgba(255,255,255,0.08)',
                  backgroundColor: active ? `${c}12` : '#151922',
                  color:           active ? c : 'rgba(255,255,255,0.45)',
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-4">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                tickFormatter={fmtK} width={60} tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
              <Tooltip content={<ChartTooltip valueFormatter={fmtK} />} />
              <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
              <Line dataKey="ce" name={`${participant_} CE Net`} stroke={color}          dot={false} strokeWidth={2} />
              <Line dataKey="pe" name={`${participant_} PE Net`} stroke="#FF69B4"        dot={false} strokeWidth={2} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-white/35">
            CE net (solid) and PE net (dashed) for {participant_}. Both on the same axis for direct comparison.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DAILY POSITIONS TABLE
───────────────────────────────────────────────────────────────── */

function DailyTable({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [tradeDate,  setTradeDate]  = useState('');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    if (allDates.length) setTradeDate(allDates.at(-1));
  }, [allDates]);

  const load = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try {
      const raw = await participant.netOI(tradeDate, tradeDate, assetClass);
      setData(raw);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate, assetClass]);

  useEffect(() => { load(); }, [load]);

  // group by participant_type for display
  const grouped = useMemo(() => {
    const map = {};
    data.forEach((r) => {
      if (!map[r.participant_type]) map[r.participant_type] = {};
      map[r.participant_type][r.option_side] = r;
    });
    return map;
  }, [data]);

  const optionSides = ['NA', 'Call', 'Put'];
  const sideLabel   = { NA: 'Futures', Call: 'Call', Put: 'Put' };

  return (
    <SectionCard
      title="Single Day Positions Table"
      subtitle="Full breakdown of long / short / net by participant and instrument type"
    >
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div className="flex items-center gap-2">
          {ASSET_CLASSES.map((ac) => (
            <button
              key={ac}
              onClick={() => setAssetClass(ac)}
              className={`px-3 py-2 rounded-xl border text-xs transition ${
                assetClass === ac
                  ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
              }`}
            >
              {ac}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-white/50 uppercase tracking-wider">Date</label>
          <select value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}>
            {[...allDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Participant</th>
                  <th style={{ textAlign: 'left' }}>Type</th>
                  <th>Long</th>
                  <th>Short</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {PARTICIPANTS.flatMap((p) =>
                  optionSides.map((side, si) => {
                    const row = grouped[p]?.[side];
                    const net = row?.net_contracts;
                    return (
                      <tr key={`${p}-${side}`} className={si === 0 ? 'border-t border-white/10' : ''}>
                        {si === 0 ? (
                          <td className="font-semibold align-top" rowSpan={3} style={{ color: PARTICIPANT_COLORS[p] }}>
                            {p}
                          </td>
                        ) : null}
                        <td className="text-white/50">{sideLabel[side]}</td>
                        <td className="text-right text-white/70 tabular-nums">{row ? fmtK(row.long_contracts)  : '—'}</td>
                        <td className="text-right text-white/70 tabular-nums">{row ? fmtK(row.short_contracts) : '—'}</td>
                        <td
                          className="text-right font-semibold tabular-nums"
                          style={{ color: net == null ? C.muted : net >= 0 ? C.green : C.red }}
                        >
                          {net != null ? (net >= 0 ? '+' : '') + fmtK(net) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

export default function Participant() {
  const [allDates, setAllDates] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [section,  setSection]  = useState('overview');

  useEffect(() => {
    participant.dates()
      .then(setAllDates)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="h-[calc(100vh-64px)] flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );

  const sections = [
    { key: 'overview',  label: 'Overview' },
    { key: 'net_oi',    label: 'Net OI' },
    { key: 'net_vol',   label: 'Net Volume' },
    { key: 'options',   label: 'Options' },
    { key: 'table',     label: 'Daily Table' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Participant Activity</h1>
        <p className="mt-1 text-sm text-white/45">
          FII · DII · Client · Pro — net positioning across futures and options
        </p>
      </div>

      <TabBar tabs={sections} activeTab={section} onChange={setSection} />

      {section === 'overview' && <LatestSnapshot allDates={allDates} />}
      {section === 'net_oi'   && <NetOIChart     allDates={allDates} />}
      {section === 'net_vol'  && <NetVolChart    allDates={allDates} />}
      {section === 'options'  && <OptionsPositioning allDates={allDates} />}
      {section === 'table'    && <DailyTable     allDates={allDates} />}
    </div>
  );
}
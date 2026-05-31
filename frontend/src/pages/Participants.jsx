// frontend/src/pages/Participants.jsx

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

import LoadingSpinner from '../components/shared/LoadingSpinner';
import DateSlider     from '../components/shared/DateSlider';
import { participant } from '../api/client';

// Safety-net: normalise any legacy 'EQUITY' alias the old client might send
const toAssetClass = (ac) => ac === 'EQUITY' ? 'STOCK' : ac;

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS  — INDEX / STOCK (not EQUITY)
───────────────────────────────────────────────────────────────── */

const PARTICIPANT_COLORS = {
  FII:    '#00B0F0',
  DII:    '#26a69a',
  Client: '#FFA726',
  Pro:    '#B39DDB',
};

const PARTICIPANTS = ['FII', 'DII', 'Client', 'Pro'];

// ← fixed: was ['INDEX', 'EQUITY'] which caused 404s
const ASSET_CLASSES = ['INDEX', 'STOCK'];

const C = {
  accent: '#00B0F0',
  green:  '#26a69a',
  red:    '#ef5350',
  muted:  'rgba(255,255,255,0.25)',
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

/**
 * Derive flow classification from two consecutive OI rows.
 * Matches the Excel IDX/STK Analysis sheet logic:
 *   prev_sell_buying  = prev short_contracts decrease  (shorts covering)
 *   fresh_buying      = long_contracts increase
 *   prev_buy_selling  = prev long_contracts decrease   (longs unwinding)
 *   fresh_selling     = short_contracts increase
 *
 * We approximate using net_contracts delta between consecutive days.
 * Positive delta = net long increased → fresh buying or covering shorts.
 * We split this into the two sub-types by comparing absolute magnitudes.
 * This is a front-end estimation; for exact values the backend should
 * expose a /participant/flow endpoint with the full previous-day row.
 */
function classifyFlow(prevNet, currNet) {
  if (prevNet == null || currNet == null) return null;
  const delta = currNet - prevNet;
  return delta;
}

/* ─────────────────────────────────────────────────────────────────
   CSV DOWNLOAD
───────────────────────────────────────────────────────────────── */

function downloadCSV(rows, filename) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h];
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CSVButton({ rows, filename, className = '' }) {
  return (
    <button
      onClick={() => downloadCSV(rows, filename)}
      disabled={!rows?.length}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-[#151922]
        text-white/50 text-xs transition hover:bg-white/5 hover:text-white/80
        disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v7M3 5l3 3 3-3M1 9v1a1 1 0 001 1h8a1 1 0 001-1V9"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      CSV
    </button>
  );
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

function SectionCard({ title, subtitle, children, action }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-white/8 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function AssetToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      {ASSET_CLASSES.map((ac) => (
        <button
          key={ac}
          onClick={() => onChange(toAssetClass(ac))}
          className={`px-3 py-2 rounded-xl border text-xs transition ${
            value === ac
              ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
              : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
          }`}
        >
          {ac}
        </button>
      ))}
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

function ParticipantToggles({ activeLines, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {PARTICIPANTS.map((p) => {
        const active = activeLines.has(p);
        return (
          <button
            key={p}
            onClick={() => onToggle(p)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition"
            style={{
              borderColor:     active ? `${PARTICIPANT_COLORS[p]}40` : 'rgba(255,255,255,0.08)',
              backgroundColor: active ? `${PARTICIPANT_COLORS[p]}12` : '#151922',
              color:           active ? PARTICIPANT_COLORS[p] : 'rgba(255,255,255,0.45)',
            }}
          >
            <span className="w-2 h-2 rounded-full"
              style={{ backgroundColor: active ? PARTICIPANT_COLORS[p] : 'rgba(255,255,255,0.2)' }} />
            {p}
          </button>
        );
      })}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
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
            <span className="text-white font-medium tabular-nums">{fmtK(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Coloured net cell
function NetCell({ value }) {
  if (value == null) return <td className="text-right tabular-nums text-white/25 px-3 py-2">—</td>;
  const color = value >= 0 ? C.green : C.red;
  return (
    <td className="text-right font-semibold tabular-nums px-3 py-2 text-sm" style={{ color }}>
      {(value >= 0 ? '+' : '') + fmtK(value)}
    </td>
  );
}

function NumCell({ value, dim }) {
  return (
    <td className={`text-right tabular-nums px-3 py-2 text-sm ${dim ? 'text-white/40' : 'text-white/75'}`}>
      {fmtK(value)}
    </td>
  );
}

/* ─────────────────────────────────────────────────────────────────
   LATEST SNAPSHOT
───────────────────────────────────────────────────────────────── */

function LatestSnapshot({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await participant.latest(toAssetClass(assetClass));
      setData(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); setData([]); }
    setLoading(false);
  }, [assetClass]);

  useEffect(() => { load(); }, [load]);

  const byParticipant = useMemo(() => {
    const map = {};
    data.forEach((r) => {
      const pt = r.participant_type;
      const side = r.option_side; // 'NA', 'CE', 'PE'
      if (!map[pt]) map[pt] = {};
      const key = side === 'NA' ? 'fut' : side === 'CE' ? 'ce' : 'pe';
      if (r.direction === 'long')  map[pt][`${key}_long`]  = (map[pt][`${key}_long`]  ?? 0) + r.contracts;
      if (r.direction === 'short') map[pt][`${key}_short`] = (map[pt][`${key}_short`] ?? 0) + r.contracts;
    });
    // compute nets
    Object.values(map).forEach(d => {
      d.fut_net = (d.fut_long ?? 0) - (d.fut_short ?? 0);
      d.ce_net  = (d.ce_long  ?? 0) - (d.ce_short  ?? 0);
      d.pe_net  = (d.pe_long  ?? 0) - (d.pe_short  ?? 0);
    });
    return map;
  }, [data]);

  // flat CSV rows
  const csvRows = useMemo(() => PARTICIPANTS.map(p => {
    const d = byParticipant[p] ?? {};
    return {
      participant: p,
      fut_long:  d.fut_long  ?? '',
      fut_short: d.fut_short ?? '',
      fut_net:   d.fut_net   ?? '',
      ce_long:   d.ce_long   ?? '',
      ce_short:  d.ce_short  ?? '',
      ce_net:    d.ce_net    ?? '',
      pe_long:   d.pe_long   ?? '',
      pe_short:  d.pe_short  ?? '',
      pe_net:    d.pe_net    ?? '',
    };
  }), [byParticipant]);

  return (
    <SectionCard
      title="Latest Participant Positioning"
      subtitle="Most recent day snapshot — net long/short across futures, calls and puts"
      action={<CSVButton rows={csvRows} filename={`participant_latest_${assetClass}.csv`} />}
    >
      <div className="flex items-center gap-3 mb-5">
        <AssetToggle value={assetClass} onChange={setAssetClass} />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <>
          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
            {PARTICIPANTS.map((p) => {
              const d       = byParticipant[p] ?? {};
              const futNet  = d.fut_net;
              const ceNet   = d.ce_net;
              const peNet   = d.pe_net;
              const color   = PARTICIPANT_COLORS[p];
              return (
                <div key={p} className="card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-sm font-semibold" style={{ color }}>{p}</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    {[
                      { label: 'Fut Net',   val: futNet },
                      { label: 'Fut Long',  val: d.fut_long,  plain: true },
                      { label: 'Fut Short', val: d.fut_short, plain: true },
                    ].map(({ label, val, plain }) => (
                      <div key={label} className="flex justify-between">
                        <span className="text-white/45">{label}</span>
                        {plain ? (
                          <span className="text-white/70 tabular-nums">{fmtK(val)}</span>
                        ) : (
                          <span className="font-semibold tabular-nums"
                            style={{ color: val == null ? C.muted : val >= 0 ? C.green : C.red }}>
                            {val != null ? (val >= 0 ? '+' : '') + fmtK(val) : '—'}
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="h-px bg-white/8 my-1" />
                    {[
                      { label: 'CE Net', val: ceNet },
                      { label: 'PE Net', val: peNet },
                    ].map(({ label, val }) => (
                      <div key={label} className="flex justify-between">
                        <span className="text-white/45">{label}</span>
                        <span className="font-semibold tabular-nums"
                          style={{ color: val == null ? C.muted : val >= 0 ? C.green : C.red }}>
                          {val != null ? (val >= 0 ? '+' : '') + fmtK(val) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Compact table view */}
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="text-left px-3 py-2.5 text-white/40 font-medium">Participant</th>
                  <th className="text-right px-3 py-2.5 text-white/40 font-medium">Fut Long</th>
                  <th className="text-right px-3 py-2.5 text-white/40 font-medium">Fut Short</th>
                  <th className="text-right px-3 py-2.5 text-white/40 font-medium">Fut Net</th>
                  <th className="text-right px-3 py-2.5 text-white/40 font-medium">CE Net</th>
                  <th className="text-right px-3 py-2.5 text-white/40 font-medium">PE Net</th>
                </tr>
              </thead>
              <tbody>
                {PARTICIPANTS.map((p) => {
                  const d = byParticipant[p] ?? {};
                  return (
                    <tr key={p} className="border-b border-white/5 hover:bg-white/3 transition">
                      <td className="px-3 py-2.5 font-semibold text-sm" style={{ color: PARTICIPANT_COLORS[p] }}>{p}</td>
                      <NumCell value={d.fut_long}  dim />
                      <NumCell value={d.fut_short} dim />
                      <NetCell value={d.fut_net} />
                      <NetCell value={d.ce_net} />
                      <NetCell value={d.pe_net} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   NET OI TIME SERIES
───────────────────────────────────────────────────────────────── */

function NetOIChart({ allDates }) {
  const [assetClass,  setAssetClass]  = useState('INDEX');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [rawData,     setRawData]     = useState([]);
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
      setRawData(raw);
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

  const toggleLine = (p) => setActiveLines(prev => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });

  const csvRows = useMemo(() => data.map(row => {
    const out = { trade_date: row.trade_date };
    PARTICIPANTS.forEach(p => { out[`${p}_futures_net`] = row[`${p}_NA`] ?? ''; });
    return out;
  }), [data]);

  return (
    <SectionCard
      title="Participant Net OI — Futures"
      subtitle="Long minus short. Positive = net long. FII is the dominant directional signal."
      action={<CSVButton rows={csvRows} filename={`participant_net_oi_${assetClass}.csv`} />}
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate}
          onStart={setStartDate} onEnd={setEndDate} />
      </div>
      <ParticipantToggles activeLines={activeLines} onToggle={toggleLine} />
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
            <Tooltip content={<ChartTooltip />} />
            <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
            {PARTICIPANTS.map(p => activeLines.has(p) && (
              <Line key={p} dataKey={`${p}_NA`} name={p} stroke={PARTICIPANT_COLORS[p]}
                dot={false} strokeWidth={p === 'FII' ? 2.5 : 1.5} />
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

  const toggleLine = (p) => setActiveLines(prev => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });

  const csvRows = useMemo(() => data.map(row => {
    const out = { trade_date: row.trade_date };
    PARTICIPANTS.forEach(p => { out[`${p}_futures_net_vol`] = row[`${p}_NA`] ?? ''; });
    return out;
  }), [data]);

  return (
    <SectionCard
      title="Participant Net Volume — Futures"
      subtitle="Buy minus sell volume per day. Positive = net buyer."
      action={<CSVButton rows={csvRows} filename={`participant_net_vol_${assetClass}.csv`} />}
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate}
          onStart={setStartDate} onEnd={setEndDate} />
      </div>
      <ParticipantToggles activeLines={activeLines} onToggle={toggleLine} />
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
            <Tooltip content={<ChartTooltip />} />
            <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
            {PARTICIPANTS.map(p => activeLines.has(p) && (
              <Bar key={p} dataKey={`${p}_NA`} name={p} fill={PARTICIPANT_COLORS[p]}
                opacity={0.85} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   OPTIONS POSITIONING
───────────────────────────────────────────────────────────────── */

function OptionsPositioning({ allDates }) {
  const [assetClass,   setAssetClass]   = useState('INDEX');
  const [activeP,      setActiveP]      = useState('FII');
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
      const byDate = {};
      for (const r of raw) {
        if (r.participant_type !== activeP) continue;
        if (!byDate[r.trade_date]) byDate[r.trade_date] = { trade_date: r.trade_date };
        if (r.option_side === 'CE') byDate[r.trade_date].ce = r.net_contracts;
        if (r.option_side === 'PE') byDate[r.trade_date].pe = r.net_contracts;
      }
      setData(Object.values(byDate).sort((a, b) => a.trade_date.localeCompare(b.trade_date)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, assetClass, activeP]);

  useEffect(() => { load(); }, [load]);

  const color = PARTICIPANT_COLORS[activeP];

  const csvRows = useMemo(() => data.map(r => ({
    trade_date: r.trade_date,
    participant: activeP,
    ce_net: r.ce ?? '',
    pe_net: r.pe ?? '',
  })), [data, activeP]);

  return (
    <SectionCard
      title="Options Net OI by Participant"
      subtitle="Net Call and Put OI. CE net long = bullish; PE net long = hedging or bearish."
      action={<CSVButton rows={csvRows} filename={`options_net_oi_${activeP}_${assetClass}.csv`} />}
    >
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <div className="flex items-center gap-2">
          {PARTICIPANTS.map((p) => {
            const c = PARTICIPANT_COLORS[p];
            const active = activeP === p;
            return (
              <button key={p} onClick={() => setActiveP(p)}
                className="px-3 py-2 rounded-xl border text-xs transition"
                style={{
                  borderColor:     active ? `${c}40` : 'rgba(255,255,255,0.08)',
                  backgroundColor: active ? `${c}12` : '#151922',
                  color:           active ? c : 'rgba(255,255,255,0.45)',
                }}>
                {p}
              </button>
            );
          })}
        </div>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate}
          onStart={setStartDate} onEnd={setEndDate} />
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="trade_date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickFormatter={fmtK} width={60} tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
            <Tooltip content={<ChartTooltip />} />
            <Legend formatter={(v) => <span className="text-white/60 text-xs">{v}</span>} />
            <Line dataKey="ce" name={`${activeP} CE Net`} stroke={color}   dot={false} strokeWidth={2} />
            <Line dataKey="pe" name={`${activeP} PE Net`} stroke="#FF69B4" dot={false} strokeWidth={2} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DAILY POSITIONS TABLE  (existing)
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
    } catch (e) { console.error(e); setData([]); }
    setLoading(false);
  }, [tradeDate, assetClass]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = {};
    data.forEach((r) => {
      if (!map[r.participant_type]) map[r.participant_type] = {};
      map[r.participant_type][r.option_side] = r;
    });
    return map;
  }, [data]);

  const sides = ['NA', 'CE', 'PE'];
  const sideLabel = { NA: 'Futures', CE: 'Calls', PE: 'Puts' };

  const csvRows = useMemo(() => PARTICIPANTS.flatMap(p =>
    sides.map(side => {
      const row = grouped[p]?.[side];
      return {
        participant: p, instrument: sideLabel[side],
        long:  row?.long_contracts  ?? '',
        short: row?.short_contracts ?? '',
        net:   row?.net_contracts   ?? '',
      };
    })
  ), [grouped]);

  return (
    <SectionCard
      title="Single Day Positions"
      subtitle="Full long / short / net breakdown by participant and instrument type"
      action={<CSVButton rows={csvRows} filename={`positions_${tradeDate}_${assetClass}.csv`} />}
    >
      <div className="space-y-3 mb-5">
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <DateSlider dates={allDates} selectedDate={tradeDate} onChange={setTradeDate} />
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/8">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left px-3 py-2.5 text-white/40 font-medium">Participant</th>
                <th className="text-left px-3 py-2.5 text-white/40 font-medium">Type</th>
                <th className="text-right px-3 py-2.5 text-white/40 font-medium">Long</th>
                <th className="text-right px-3 py-2.5 text-white/40 font-medium">Short</th>
                <th className="text-right px-3 py-2.5 text-white/40 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {PARTICIPANTS.flatMap((p) =>
                sides.map((side, si) => {
                  const row = grouped[p]?.[side];
                  return (
                    <tr key={`${p}-${side}`}
                      className={`border-b border-white/5 hover:bg-white/3 transition ${si === 0 ? 'border-t border-white/10' : ''}`}>
                      {si === 0 ? (
                        <td className="font-semibold align-middle px-3 py-2 text-sm" rowSpan={3}
                          style={{ color: PARTICIPANT_COLORS[p] }}>{p}</td>
                      ) : null}
                      <td className="text-white/45 px-3 py-2">{sideLabel[side]}</td>
                      <NumCell value={row?.long_contracts}  dim />
                      <NumCell value={row?.short_contracts} dim />
                      <NetCell value={row?.net_contracts} />
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   ANALYSIS TABLE  — NSE Excel style
   Mirrors IDX Analysis / STK Analysis sheets:
     Columns: Participant | Fut Net Δ | Fut Seg | CE Seg | PE Seg | OI Snapshot
   Rows per participant show:
     - Net long change (today vs prev)
     - Flow type badge: Fresh Long / Short Cover / Long Unwind / Fresh Short
     - OI long / short / net
───────────────────────────────────────────────────────────────── */

// Classify a net OI delta into a flow type
function flowType(delta) {
  if (delta == null || delta === 0) return null;
  // positive delta = net long increased
  if (delta > 0) return delta > 50000 ? 'fresh_long'    : 'cover';
  else           return Math.abs(delta) > 50000 ? 'fresh_short' : 'unwind';
}

const FLOW_META = {
  fresh_long:  { label: 'Fresh Long',    bg: 'rgba(38,166,154,0.15)',  border: '#26a69a', text: '#26a69a' },
  cover:       { label: 'Short Cover',   bg: 'rgba(38,166,154,0.08)',  border: '#26a69a50', text: '#26a69a99' },
  fresh_short: { label: 'Fresh Short',   bg: 'rgba(239,83,80,0.15)',   border: '#ef5350', text: '#ef5350' },
  unwind:      { label: 'Long Unwind',   bg: 'rgba(239,83,80,0.08)',   border: '#ef535050', text: '#ef535099' },
};

function FlowBadge({ delta }) {
  const type = flowType(delta);
  if (!type) return <span className="text-white/20 text-xs">—</span>;
  const m = FLOW_META[type];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border"
      style={{ background: m.bg, borderColor: m.border, color: m.text }}>
      {m.label}
    </span>
  );
}

function AnalysisTable({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [tradeDate,  setTradeDate]  = useState('');
  const [oiData,     setOiData]     = useState([]);   // today + yesterday OI
  const [volData,    setVolData]    = useState([]);   // today's volume
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    if (allDates.length) setTradeDate(allDates.at(-1));
  }, [allDates]);

  const load = useCallback(async () => {
    if (!tradeDate || !allDates.length) return;
    setLoading(true);
    try {
      // fetch today and one prior day for delta calculation
      const idx     = allDates.indexOf(tradeDate);
      const prevDay = idx > 0 ? allDates[idx - 1] : tradeDate;

      const [oi, vol] = await Promise.all([
        participant.netOI(prevDay, tradeDate, assetClass),
        participant.netVol(tradeDate, tradeDate, assetClass),
      ]);
      setOiData(oi);
      setVolData(vol);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate, assetClass, allDates]);

  useEffect(() => { load(); }, [load]);

  // Build per-participant analysis rows
  const rows = useMemo(() => {
    // OI: group by date × participant × side
    const byDatePtSide = {};
    for (const r of oiData) {
      const key = `${r.trade_date}|${r.participant_type}|${r.option_side}`;
      byDatePtSide[key] = r;
    }
    // Vol: group by participant × side
    const volByPtSide = {};
    for (const r of volData) {
      volByPtSide[`${r.participant_type}|${r.option_side}`] = r;
    }

    const idx      = allDates.indexOf(tradeDate);
    const prevDay  = idx > 0 ? allDates[idx - 1] : null;

    return PARTICIPANTS.map(p => {
      const get = (date, side) => byDatePtSide[`${date}|${p}|${side}`];
      const todayFut  = get(tradeDate, 'NA');
      const prevFut   = prevDay ? get(prevDay, 'NA') : null;
      const todayCE   = get(tradeDate, 'CE');
      const prevCE    = prevDay ? get(prevDay, 'CE') : null;
      const todayPE   = get(tradeDate, 'PE');
      const prevPE    = prevDay ? get(prevDay, 'PE') : null;

      const volFut = volByPtSide[`${p}|NA`];
      const volCE  = volByPtSide[`${p}|CE`];
      const volPE  = volByPtSide[`${p}|PE`];

      const futNetDelta = todayFut && prevFut
        ? (todayFut.net_contracts ?? 0) - (prevFut.net_contracts ?? 0) : null;
      const ceNetDelta = todayCE && prevCE
        ? (todayCE.net_contracts ?? 0) - (prevCE.net_contracts ?? 0) : null;
      const peNetDelta = todayPE && prevPE
        ? (todayPE.net_contracts ?? 0) - (prevPE.net_contracts ?? 0) : null;

      return {
        participant: p,
        // Futures OI
        futLong:  todayFut?.long_contracts,
        futShort: todayFut?.short_contracts,
        futNet:   todayFut?.net_contracts,
        futNetDelta,
        // CE OI
        ceLong:  todayCE?.long_contracts,
        ceShort: todayCE?.short_contracts,
        ceNet:   todayCE?.net_contracts,
        ceNetDelta,
        // PE OI
        peLong:  todayPE?.long_contracts,
        peShort: todayPE?.short_contracts,
        peNet:   todayPE?.net_contracts,
        peNetDelta,
        // Total OI
        totalLong:  (todayFut?.long_contracts  ?? 0) + (todayCE?.long_contracts  ?? 0) + (todayPE?.long_contracts  ?? 0),
        totalShort: (todayFut?.short_contracts ?? 0) + (todayCE?.short_contracts ?? 0) + (todayPE?.short_contracts ?? 0),
        // Volume
        volFutNet: volFut?.net_contracts,
        volCENet:  volCE?.net_contracts,
        volPENet:  volPE?.net_contracts,
      };
    });
  }, [oiData, volData, tradeDate, allDates]);

  const csvRows = useMemo(() => rows.map(r => ({
    participant:    r.participant,
    trade_date:     tradeDate,
    asset_class:    assetClass,
    fut_long:       r.futLong   ?? '',
    fut_short:      r.futShort  ?? '',
    fut_net:        r.futNet    ?? '',
    fut_net_change: r.futNetDelta ?? '',
    ce_long:        r.ceLong    ?? '',
    ce_short:       r.ceShort   ?? '',
    ce_net:         r.ceNet     ?? '',
    ce_net_change:  r.ceNetDelta ?? '',
    pe_long:        r.peLong    ?? '',
    pe_short:       r.peShort   ?? '',
    pe_net:         r.peNet     ?? '',
    pe_net_change:  r.peNetDelta ?? '',
    total_long:     r.totalLong  ?? '',
    total_short:    r.totalShort ?? '',
    vol_fut_net:    r.volFutNet  ?? '',
    vol_ce_net:     r.volCENet   ?? '',
    vol_pe_net:     r.volPENet   ?? '',
  })), [rows, tradeDate, assetClass]);

  // sub-tab: which segment to highlight in detail cols
  const [segment, setSegment] = useState('FUT');
  const segs = [
    { key: 'FUT', label: 'Futures' },
    { key: 'CE',  label: 'Calls' },
    { key: 'PE',  label: 'Puts' },
  ];

  return (
    <SectionCard
      title="Participant Analysis"
      subtitle="Daily flow classification — mirrors NSE IDX/STK Analysis format with OI + volume context"
      action={<CSVButton rows={csvRows} filename={`participant_analysis_${tradeDate}_${assetClass}.csv`} />}
    >
      {/* Controls */}
      <div className="space-y-3 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <AssetToggle value={assetClass} onChange={setAssetClass} />
          {/* Segment sub-tabs */}
          <div className="flex items-center gap-1 ml-auto">
            {segs.map(s => (
              <button key={s.key} onClick={() => setSegment(s.key)}
                className={`px-3 py-1.5 rounded-lg border text-xs transition ${
                  segment === s.key
                    ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                    : 'border-white/10 bg-[#151922] text-white/50 hover:bg-white/5'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <DateSlider dates={allDates} selectedDate={tradeDate} onChange={setTradeDate} />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-4">
          {/* ── Main analysis table ── */}
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="text-left px-3 py-3 text-white/40 font-medium sticky left-0 bg-[#0d1117]">
                    Participant
                  </th>
                  {/* Segment-specific columns */}
                  <th className="text-right px-3 py-3 text-white/40 font-medium">Long</th>
                  <th className="text-right px-3 py-3 text-white/40 font-medium">Short</th>
                  <th className="text-right px-3 py-3 text-white/40 font-medium">Net OI</th>
                  <th className="text-right px-3 py-3 text-white/40 font-medium">Δ Net</th>
                  <th className="text-center px-3 py-3 text-white/40 font-medium">Flow</th>
                  <th className="text-right px-3 py-3 text-white/40 font-medium">Net Vol</th>
                  {/* Summary columns always visible */}
                  <th className="text-right px-3 py-3 text-white/35 font-medium border-l border-white/8">
                    Total Long
                  </th>
                  <th className="text-right px-3 py-3 text-white/35 font-medium">Total Short</th>
                  <th className="text-right px-3 py-3 text-white/35 font-medium">Total Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const color = PARTICIPANT_COLORS[r.participant];

                  // pick segment-specific values
                  const long    = segment === 'FUT' ? r.futLong  : segment === 'CE' ? r.ceLong  : r.peLong;
                  const short   = segment === 'FUT' ? r.futShort : segment === 'CE' ? r.ceShort : r.peShort;
                  const net     = segment === 'FUT' ? r.futNet   : segment === 'CE' ? r.ceNet   : r.peNet;
                  const delta   = segment === 'FUT' ? r.futNetDelta : segment === 'CE' ? r.ceNetDelta : r.peNetDelta;
                  const volNet  = segment === 'FUT' ? r.volFutNet   : segment === 'CE' ? r.volCENet   : r.volPENet;
                  const totalNet = (r.totalLong ?? 0) - (r.totalShort ?? 0);

                  return (
                    <tr key={r.participant}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition">
                      <td className="px-3 py-3 font-semibold text-sm sticky left-0 bg-[#0d1117]"
                        style={{ color }}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          {r.participant}
                        </div>
                      </td>
                      <NumCell value={long}  dim />
                      <NumCell value={short} dim />
                      <NetCell value={net} />
                      {/* Delta */}
                      <td className="text-right px-3 py-3">
                        {delta != null ? (
                          <span className="font-semibold tabular-nums text-sm"
                            style={{ color: delta >= 0 ? C.green : C.red }}>
                            {(delta >= 0 ? '+' : '') + fmtK(delta)}
                          </span>
                        ) : <span className="text-white/25">—</span>}
                      </td>
                      {/* Flow badge */}
                      <td className="text-center px-3 py-3">
                        <FlowBadge delta={delta} />
                      </td>
                      {/* Net volume */}
                      <NetCell value={volNet} />
                      {/* Summary */}
                      <td className="border-l border-white/8 text-right px-3 py-3 text-white/55 tabular-nums text-sm">
                        {fmtK(r.totalLong)}
                      </td>
                      <td className="text-right px-3 py-3 text-white/55 tabular-nums text-sm">
                        {fmtK(r.totalShort)}
                      </td>
                      <NetCell value={totalNet} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── OI Summary mini-table (all 3 segments side by side) ── */}
          <div>
            <p className="text-xs text-white/35 mb-2 font-medium uppercase tracking-wider">
              Open Interest Snapshot — all segments
            </p>
            <div className="overflow-x-auto rounded-xl border border-white/8">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="text-left px-3 py-2.5 text-white/40 font-medium">Participant</th>
                    <th className="text-right px-3 py-2.5 text-[#00B0F0]/60 font-medium" colSpan={3}>
                      ── Futures ──
                    </th>
                    <th className="text-right px-3 py-2.5 text-[#26a69a]/60 font-medium" colSpan={3}>
                      ── Calls ──
                    </th>
                    <th className="text-right px-3 py-2.5 text-[#FFA726]/60 font-medium" colSpan={3}>
                      ── Puts ──
                    </th>
                    <th className="text-right px-3 py-2.5 text-white/40 font-medium" colSpan={2}>
                      Total
                    </th>
                  </tr>
                  <tr className="border-b border-white/5">
                    <th />
                    {['Long','Short','Net', 'Long','Short','Net', 'Long','Short','Net', 'Long','Short'].map((h,i) => (
                      <th key={i} className="text-right px-3 py-1.5 text-white/25 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.participant} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                      <td className="px-3 py-2 font-semibold text-sm" style={{ color: PARTICIPANT_COLORS[r.participant] }}>
                        {r.participant}
                      </td>
                      <NumCell value={r.futLong}  dim /><NumCell value={r.futShort} dim /><NetCell value={r.futNet} />
                      <NumCell value={r.ceLong}   dim /><NumCell value={r.ceShort}  dim /><NetCell value={r.ceNet} />
                      <NumCell value={r.peLong}   dim /><NumCell value={r.peShort}  dim /><NetCell value={r.peNet} />
                      <NumCell value={r.totalLong} /><NumCell value={r.totalShort} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Volume summary ── */}
          <div>
            <p className="text-xs text-white/35 mb-2 font-medium uppercase tracking-wider">
              Net Volume — today's trading activity
            </p>
            <div className="overflow-x-auto rounded-xl border border-white/8">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="text-left px-3 py-2.5 text-white/40 font-medium">Participant</th>
                    <th className="text-right px-3 py-2.5 text-white/40 font-medium">Fut Net Vol</th>
                    <th className="text-right px-3 py-2.5 text-white/40 font-medium">CE Net Vol</th>
                    <th className="text-right px-3 py-2.5 text-white/40 font-medium">PE Net Vol</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.participant} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                      <td className="px-3 py-2.5 font-semibold text-sm" style={{ color: PARTICIPANT_COLORS[r.participant] }}>
                        {r.participant}
                      </td>
                      <NetCell value={r.volFutNet} />
                      <NetCell value={r.volCENet} />
                      <NetCell value={r.volPENet} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1">
            {Object.entries(FLOW_META).map(([k, m]) => (
              <div key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px]"
                style={{ background: m.bg, borderColor: m.border, color: m.text }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.text }} />
                {m.label}
              </div>
            ))}
            <span className="text-white/30 text-[10px] self-center ml-1">
              Δ Net threshold: ±50K contracts for Fresh vs Cover/Unwind classification
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

export default function Participants() {
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
    { key: 'analysis',  label: 'Analysis' },
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

      {section === 'overview' && <LatestSnapshot      allDates={allDates} />}
      {section === 'net_oi'   && <NetOIChart          allDates={allDates} />}
      {section === 'net_vol'  && <NetVolChart         allDates={allDates} />}
      {section === 'options'  && <OptionsPositioning  allDates={allDates} />}
      {section === 'table'    && <DailyTable          allDates={allDates} />}
      {section === 'analysis' && <AnalysisTable       allDates={allDates} />}
    </div>
  );
}
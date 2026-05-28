// frontend/src/components/charts/OIChart.jsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

import { getFuturesCycleHistory, getFuturesCombinedHistory, getOptionsCycleHistory, getOptionsMarketHistory, getFuturesRollup, formatNumber, FUTURES_COMBINED_TICKER, OPTIONS_COMBINED_TICKER } from '../../api/client';
import LoadingSpinner from '../shared/LoadingSpinner';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */

const PALETTE = [
  '#00B0F0', // cyan
  '#92D050', // green
  '#FFA726', // orange
  '#FF6B9D', // pink
  '#B39DDB', // lavender
  '#26a69a', // teal
  '#ef5350', // red
  '#FFD700', // gold
];

const formatOI = (v) => {
  if (v == null || Number.isNaN(v)) return '--';
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000)    return `${(v / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)       return `${(v / 1_000).toFixed(1)}K`;
  return formatNumber(v);
};

/* ─────────────────────────────────────────────────────────────────
   TOOLTIP  (ticker mode)
───────────────────────────────────────────────────────────────── */

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-[#11151d] border border-white/10 rounded-xl px-4 py-3 shadow-2xl min-w-[180px]">
      <p className="text-xs font-semibold text-white/60 mb-2">{label === 0 ? 'Expiry' : `${label}d`}</p>
      <div className="space-y-1.5">
        {payload.map((p, i) =>
          p.value != null && (
            <div key={i} className="flex items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span style={{ color: p.color }}>{p.name}</span>
              </div>
              <span className="text-white font-medium tabular-nums">{formatOI(p.value)}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   COLOR SELECTOR ROW  (screener chart — selection owned by sidebar)
───────────────────────────────────────────────────────────────── */

function ColorSelectorRow({ expiry, color, onColorChange }) {
  return (
    <div className="flex items-center gap-3">
      {/* Cycle label */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs"
        style={{
          borderColor: `${color}40`,
          backgroundColor: `${color}12`,
          color,
        }}
      >
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        {expiry}
      </div>

      {/* Color swatches */}
      <div className="flex gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            title={c}
            className="w-4 h-4 rounded-full transition hover:scale-110"
            style={{
              backgroundColor: c,
              outline: c === color ? '2px solid white' : '1px solid transparent',
              outlineOffset: '1px',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN CHART COMPONENT  (ticker analytics mode)
───────────────────────────────────────────────────────────────── */

export default function OIChart({
  assetType,
  ticker,
  expiries = [],
  mode = 'ticker',
}) {
  const [seriesData, setSeriesData] = useState({});
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [activeExpiries, setActiveExpiries] = useState([]);
  const [colorMap, setColorMap]             = useState({});
  const [chartMetric, setChartMetric]       = useState('oi');

  /* ── Init active expiries + colors ── */
  useEffect(() => {
    if (!expiries.length) return;
    setActiveExpiries(expiries.slice(0, 3));
    const map = {};
    expiries.forEach((exp, i) => { map[exp] = PALETTE[i % PALETTE.length]; });
    setColorMap(map);
  }, [expiries]);

  /* ── Fetch per-expiry analytics (ticker mode) ── */
  useEffect(() => {
    if (!ticker || !expiries.length) return;
    let mounted = true;
    setLoading(true);
    setError('');

    Promise.all(
      expiries.map((exp) =>
        getFuturesAnalytics(assetType, ticker, exp)
          .then((res) => ({ exp, rows: res?.rows || [] }))
          .catch(() => ({ exp, rows: [] }))
      )
    ).then((results) => {
      if (!mounted) return;
      const map = {};
      results.forEach(({ exp, rows }) => { map[exp] = rows; });
      setSeriesData(map);
      setLoading(false);
    });

    return () => { mounted = false; };
  }, [assetType, ticker, expiries]);

  /* ── Build end-aligned chart data ── */
  const chartData = useMemo(() => {
    const activeKeys = activeExpiries.filter((e) => seriesData[e]?.length);
    if (!activeKeys.length) return [];

    const seriesByOffset = activeKeys.map((exp) => {
      const rows = seriesData[exp] || [];
      return rows.map((row, i) => ({
        offset:     i - (rows.length - 1),
        trade_date: row.trade_date,
        oi:         row.open_int,
        chng_oi:    row.chng_in_oi,
      }));
    });

    const allOffsets = [
      ...new Set(seriesByOffset.flatMap((s) => s.map((r) => r.offset))),
    ].sort((a, b) => a - b);

    return allOffsets.map((offset) => {
      const point = { offset };

      activeKeys.forEach((exp, i) => {
        const row = seriesByOffset[i].find((r) => r.offset === offset);

        if (row) {
          point[`${exp}_oi`]      = row.oi;
          point[`${exp}_chng_oi`] = row.chng_oi;
          point[`${exp}_date`]    = row.trade_date;
        }
      });

      return point;
    });
  }, [activeExpiries, seriesData]);

  if (loading) return (
    <div className="card flex items-center justify-center py-16"><LoadingSpinner /></div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/45 font-medium uppercase tracking-wider">Metric</span>
            {[
              { key: 'oi',      label: 'Open Interest' },
              { key: 'chng_oi', label: 'OI Change'     },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setChartMetric(key)}
                className="px-3 py-1.5 rounded-lg border text-xs transition"
                style={{
                  borderColor:     chartMetric === key ? '#00B0F040' : 'rgba(255,255,255,0.08)',
                  backgroundColor: chartMetric === key ? '#00B0F012' : '#151922',
                  color:           chartMetric === key ? '#00B0F0'   : 'rgba(255,255,255,0.55)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/30">X-axis aligned to expiry end (0 = last day)</p>
        </div>

        {/* Expiry toggles */}
        <div className="flex flex-wrap gap-2">
          {expiries.map((exp, i) => {
            const active = activeExpiries.includes(exp);
            const color  = colorMap[exp] ?? PALETTE[i % PALETTE.length];
            return (
              <button
                key={exp}
                onClick={() =>
                  setActiveExpiries((prev) =>
                    prev.includes(exp) ? prev.filter((e) => e !== exp) : [...prev, exp]
                  )
                }
                className="px-3 py-2 rounded-xl border text-xs transition"
                style={{
                  borderColor:     active ? `${color}40` : 'rgba(255,255,255,0.08)',
                  backgroundColor: active ? `${color}12` : '#151922',
                  color:           active ? color         : 'rgba(255,255,255,0.45)',
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: active ? color : 'rgba(255,255,255,0.2)' }}
                  />
                  {exp}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="card p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-white">OI Cycle Comparison — {ticker}</h3>
          <p className="text-xs text-white/40 mt-0.5">Expiry series aligned by Days To Expiry end.</p>
        </div>

        {chartData.length === 0 ? (
          <p className="text-white/40 text-sm py-8 text-center">No data — toggle at least one expiry above.</p>
        ) : (
          <div style={{ height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="offset"
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickFormatter={(v) => v === 0 ? 'Exp' : `${v}d`}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={formatOI}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  width={65}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend formatter={(value) => (
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>{value}</span>
                )} />
                {activeExpiries.map((exp) => (
                  <Line
                    key={exp}
                    type="linear"
                    dataKey={`${exp}_${chartMetric}`}
                    name={exp}
                    stroke={colorMap[exp] ?? '#00B0F0'}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   SCREENER OI CHART
   Plots one line per selected cycle expiry.
   Each line = combined OI of (cycleExpiry + next1 + next2)
   for the selected ticker, aligned by DTE.

   Props:
     assetType       – 'stock_futures' | 'index_futures'
     ticker          – selected ticker (e.g. 'RELIANCE')
     allExpiries     – full master expiry chain from API (used for
                       cycle boundaries + next2 constituent lookup)
     selectedCycles  – subset chosen in sidebar (max 5); each entry
                       is one line on the chart
───────────────────────────────────────────────────────────────── */

export function ScreenerOIChart({ assetType, ticker, allExpiries = [], selectedCycles = [], allDates = [], metricToggle = false, fetchHistory = null, metricKeys = null,}) {
  const [historyRows, setHistoryRows] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [colorMap, setColorMap]       = useState({});
  // drag offset for in-progress cycle (in trading-day units, 0 = right-anchored)
  const [dragOffset, setDragOffset]   = useState(0);

  const [activeMetric, setActiveMetric] = useState(
    metricKeys?.default ?? 'open_int'
  );

  // derive the actual field(s) to sum per row:
  const resolvedMetricKey = activeMetric === 'combined'
    ? null   // special case handled below
    : activeMetric;

  const isDragging                    = useRef(false);
  const dragStartX                    = useRef(0);
  const dragStartOffset               = useRef(0);

  const isCombined = ticker === FUTURES_COMBINED_TICKER;

  const orderedExpiries = useMemo(() =>
    [...allExpiries].sort((a, b) => new Date(a) - new Date(b)),
  [allExpiries]);

  // The in-progress cycle is the latest expiry in the selected set
  const inProgressCycle = useMemo(() => {
    if (!selectedCycles.length || !orderedExpiries.length) return null;
    const today = new Date();
    // first expiry in ordered list that hasn't fully expired yet
    return orderedExpiries.find((e) => new Date(e) >= today) ?? null;
  }, [orderedExpiries, selectedCycles]);

  /* ── Init colors ── */
  useEffect(() => {
    const map = {};
    allExpiries.forEach((exp, i) => { map[exp] = PALETTE[i % PALETTE.length]; });
    setColorMap(map);
  }, [allExpiries]);

  /* ── Reset drag when cycle changes ── */
  useEffect(() => { setDragOffset(0); }, [inProgressCycle]);

  /* ── Fetch history ── */
  useEffect(() => {
    if (!ticker) return;
    let mounted = true;
    setLoading(true);

    const fetcher = fetchHistory
      ? fetchHistory(assetType, ticker)
      : isCombined
        ? getFuturesCombinedHistory(assetType, allDates)
        : getFuturesCycleHistory(assetType, ticker);

    fetcher
      .then((res) => { if (mounted) { setHistoryRows(res?.rows || []); setLoading(false); } })
      .catch(() => { if (mounted) { setHistoryRows([]); setLoading(false); } });

    return () => { mounted = false; };
  // allDates deliberately excluded for options path — only re-fetch when ticker/assetType change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetType, ticker, fetchHistory, isCombined]);

  /* ── Build chart data — fixed 25-day x-axis (-24 to 0) ── */
  const chartData = useMemo(() => {
    // fixed frame: offsets -24 … 0
    const FRAME = Array.from({ length: 25 }, (_, i) => i - 24); // [-24, -23, … 0]

    const offsetMap = {};
    FRAME.forEach((o) => { offsetMap[o] = { offset: o }; });

    selectedCycles.forEach((cycleExp) => {
      const isInProgress = cycleExp === inProgressCycle;
      const idx          = orderedExpiries.indexOf(cycleExp);
      const prevExpiry   = idx > 0 ? orderedExpiries[idx - 1] : null;
      const constituents = isCombined
        ? null
        : fetchHistory
          ? orderedExpiries.filter((e) => (!prevExpiry || e > prevExpiry) && e <= cycleExp)
          : orderedExpiries.slice(idx, idx + 3);

      let cycleRows;
      if (isCombined) {
        // for combined, historyRows has no expiry column — just filter by date window
        cycleRows = historyRows.filter((r) => {
          const td = r.trade_date?.split?.('T')[0] ?? String(r.trade_date).slice(0, 10);
          return (!prevExpiry || td > prevExpiry) && td <= cycleExp;
        });
      } else {
        cycleRows = historyRows.filter((r) => {
          const td         = r.trade_date?.split?.('T')[0] ?? String(r.trade_date).slice(0, 10);
          const rowExpiry  = r.expiry?.split?.('T')[0]     ?? String(r.expiry).slice(0, 10);
          const inWindow   = (!prevExpiry || td > prevExpiry) && td <= cycleExp;
          return inWindow && constituents.includes(rowExpiry);
        });
      }

      // sum OI per date
      const groupedByDate = {};
      cycleRows.forEach((r) => {
        const td = r.trade_date?.split?.('T')[0] ?? String(r.trade_date).slice(0, 10);
        if (resolvedMetricKey) {
          groupedByDate[td] = (groupedByDate[td] ?? 0) + (Number(r[resolvedMetricKey]) || 0);
        } else {
          // combined = ce_oi + pe_oi
          groupedByDate[td] = (groupedByDate[td] ?? 0) + (Number(r.ce_oi) || 0) + (Number(r.pe_oi) || 0);
        }
      });

      const tradingDates = Object.keys(groupedByDate).sort((a, b) => new Date(a) - new Date(b));
      const lastIdx      = tradingDates.length - 1;

      tradingDates.forEach((date, i) => {
        // natural offset relative to last trading day
        let offset = i - lastIdx; // 0 = last day, -1 = day before, etc.

        // apply drag shift for in-progress cycle
        if (isInProgress) {
          offset = offset + dragOffset;
        }

        // only plot within our fixed frame
        if (offset < -24 || offset > 0) return;

        if (!offsetMap[offset]) offsetMap[offset] = { offset };
        offsetMap[offset][cycleExp]              = groupedByDate[date];
        offsetMap[offset][`${cycleExp}_date`]    = date;
      });
    });

    return FRAME.map((o) => offsetMap[o] ?? { offset: o });
  }, [historyRows, selectedCycles, orderedExpiries, inProgressCycle, dragOffset, isCombined]);

  /* ── Drag handlers ── */
  const handleMouseDown = (e) => {
    isDragging.current    = true;
    dragStartX.current    = e.clientX;
    dragStartOffset.current = dragOffset;
    e.preventDefault();
  };

  useEffect(() => {
    const PIXELS_PER_DAY = 18; // approximate; feels natural

    const onMove = (e) => {
      if (!isDragging.current) return;
      const deltaX   = e.clientX - dragStartX.current;
      const deltaDays = Math.round(deltaX / PIXELS_PER_DAY);
      const newOffset = Math.max(-24, Math.min(0, dragStartOffset.current + deltaDays));
      setDragOffset(newOffset);
    };

    const onUp = () => { isDragging.current = false; };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [dragOffset]);

  /* ── Tooltip ── */
  const TooltipContent = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#11151d] border border-white/10 rounded-xl px-4 py-3 shadow-2xl min-w-[220px]">
        <p className="text-xs font-semibold text-white/60 mb-3">
          {label === 0 ? 'Expiry Day' : `${Math.abs(label)}d to expiry`}
        </p>
        <div className="space-y-2">
          {payload.map((p) => {
            if (p.value == null) return null;
            const tradeDate = p.payload[`${p.dataKey}_date`];
            return (
              <div key={p.dataKey} className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: p.color }}>
                    {p.dataKey} cycle
                  </span>
                  {p.dataKey === inProgressCycle && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 text-white/50">live</span>
                  )}
                </div>
                {tradeDate && <div className="text-[11px] text-white/45">{tradeDate}</div>}
                <div className="text-sm text-white">{formatOI(p.value)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ── Empty states ── */
  if (!ticker) return (
    <div className="card p-8 text-center">
      <p className="text-white/40 text-sm">Select a ticker in the sidebar to view the OI chart.</p>
    </div>
  );
  if (!selectedCycles.length) return (
    <div className="card p-8 text-center">
      <p className="text-white/40 text-sm">Select up to 5 expiry cycles in the sidebar to compare.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Color selector panel */}
      <div className="card p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Combined OI Cycle Comparison — {isCombined ? 'All Tickers' : ticker}
          </h3>
          <p className="text-xs text-white/40 mt-1">
            {isCombined
              ? 'Sum of all tickers OI aligned by Days To Expiry. '
              : metricToggle
                ? 'Sum of all constituent expiries within cycle window. '
                : 'Sum of current + next + far month OI aligned by Days To Expiry. '}
            Fixed 25-day window. Cycles selected in sidebar (max 5).
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {metricToggle && (
            <div className="flex items-center gap-2 pb-1">
              {[
                { key: 'ce_oi',    label: 'CE OI',   color: '#00B0F0' },
                { key: 'pe_oi',    label: 'PE OI',   color: '#FF00FF' },
                { key: 'combined', label: 'CE + PE', color: '#92D050' },
              ].map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => setActiveMetric(key)}
                  className="px-3 py-1.5 rounded-lg border text-xs transition"
                  style={{
                    borderColor:     activeMetric === key ? `${color}40` : 'rgba(255,255,255,0.08)',
                    backgroundColor: activeMetric === key ? `${color}12` : '#151922',
                    color:           activeMetric === key ? color        : 'rgba(255,255,255,0.55)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {selectedCycles.map((exp) => {
            const isInProgress = exp === inProgressCycle;
            return (
              <div key={exp} className="flex items-center gap-3">
                <ColorSelectorRow
                  expiry={exp}
                  color={colorMap[exp] ?? '#00B0F0'}
                  onColorChange={(c) => setColorMap((prev) => ({ ...prev, [exp]: c }))}
                />
                {isInProgress && (
                  <div
                    onMouseDown={handleMouseDown}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-white/50 text-xs cursor-ew-resize select-none hover:bg-white/10 transition"
                    title="Drag to shift in-progress cycle"
                  >
                    ⟷ drag {dragOffset === 0 ? '(anchored)' : `${dragOffset > 0 ? '+' : ''}${dragOffset}d`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="card p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
        ) : (
          <div style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="offset"
                  type="number"
                  domain={[-24, 0]}
                  ticks={[-24, -20, -15, -10, -5, 0]}
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickFormatter={(v) => v === 0 ? 'Exp' : `${v}d`}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                  tickFormatter={formatOI}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  width={70}
                />
                <Tooltip content={<TooltipContent />} />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
                      {value} cycle{value === inProgressCycle ? ' 🔴' : ''}
                    </span>
                  )}
                />
                {selectedCycles.map((exp) => (
                  <Line
                    key={exp}
                    type="monotone"
                    dataKey={exp}
                    name={exp}
                    stroke={colorMap[exp] ?? '#00B0F0'}
                    strokeWidth={exp === inProgressCycle ? 2.8 : 2.2}
                    strokeDasharray={exp === inProgressCycle ? '6 3' : undefined}
                    dot={false}
                    connectNulls
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   OPTIONS OI CHART
   Three views: CE / PE / CE+PE
   One line per selected cycle. Each cycle sums all constituent
   expiries active within (prevExpiry, cycleExp] window.
   Fixed 25-day x-axis. In-progress cycle is draggable.
───────────────────────────────────────────────────────────────── */

export function OptionsOIChart({ assetType, ticker, allExpiries, selectedCycles }) {
  return (
    <ScreenerOIChart
      assetType={assetType}
      ticker={ticker}
      allExpiries={allExpiries}
      selectedCycles={selectedCycles}
      metricToggle
      fetchHistory={(at, t) =>
        t === OPTIONS_COMBINED_TICKER
          ? getOptionsMarketHistory(at)
          : getOptionsCycleHistory(at, t)
      }
      metricKeys={{ default: 'ce_oi', options: ['ce_oi', 'pe_oi', 'combined'] }}
    />
  );
}
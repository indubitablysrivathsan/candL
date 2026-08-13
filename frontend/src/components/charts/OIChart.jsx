// frontend/src/components/charts/OIChart.jsx
// Bloomberg/Reuters terminal aesthetic — matches TimeSeriesChart design language

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

import {
  getFuturesAnalytics,
  getFuturesCycleHistory,
  getFuturesMarketHistory,
  getOptionsCycleHistory,
  getOptionsMarketHistory,
  formatNumber,
  FUTURES_COMBINED_TICKER,
  OPTIONS_COMBINED_TICKER,
} from '../../api/client';
import LoadingSpinner from '../shared/LoadingSpinner';

/* ─────────────────────────────────────────────────────────────────
   DESIGN TOKENS  (mirrors TimeSeriesChart)
───────────────────────────────────────────────────────────────── */
const T = {
  bg:        '#06080C',
  surface:   '#0B0F16',
  elevated:  '#111720',
  border:    'rgba(255,255,255,0.07)',
  borderHi:  'rgba(255,255,255,0.14)',
  amber:     '#F0A500',
  green:     '#00C896',
  red:       '#E05252',
  pink:      '#D66E9A',
  blue:      '#4A9EFF',
  textHi:    'rgba(255,255,255,0.90)',
  textMid:   'rgba(255,255,255,0.50)',
  textLo:    'rgba(255,255,255,0.25)',
  grid:      'rgba(255,255,255,0.05)',
  axis:      'rgba(255,255,255,0.10)',
};

const mono = "'IBM Plex Mono','Fira Code','Consolas',monospace";

const PALETTE = [
  '#4A9EFF', // blue
  '#00C896', // green
  '#F0A500', // amber
  '#D66E9A', // pink
  '#B39DDB', // lavender
  '#26C6DA', // cyan
  '#E05252', // red
  '#FFD54F', // yellow
];

/* ─────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────── */
const formatOI = (v) => {
  if (v == null || Number.isNaN(v)) return '--';
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000)    return `${(v / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)       return `${(v / 1_000).toFixed(1)}K`;
  return formatNumber(v);
};

const tickStyle = {
  fill: T.textMid,
  fontSize: 10,
  fontFamily: mono,
  letterSpacing: '0.03em',
};

/* ─────────────────────────────────────────────────────────────────
   SHARED TOOLTIP
───────────────────────────────────────────────────────────────── */
function TerminalTooltip({ active, payload, label, isPcr = false }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.borderHi}`,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      minWidth: 200,
      fontFamily: mono,
    }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: T.textLo,
        marginBottom: 8,
      }}>
        {label === 0 ? 'EXPIRY DAY' : `${Math.abs(label)}D TO EXPIRY`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {payload.map((p) => {
          if (p.value == null) return null;
          const tradeDate = p.payload?.[`${p.dataKey}_date`];
          return (
            <div key={p.dataKey}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    background: p.color,
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', color: p.color, textTransform: 'uppercase' }}>
                    {p.name}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: T.textHi, fontVariantNumeric: 'tabular-nums' }}>
                  {isPcr ? (p.value != null ? p.value.toFixed(3) : '--') : formatOI(p.value)}
                </span>
              </div>
              {tradeDate && (
                <div style={{ fontSize: 9, color: T.textLo, paddingLeft: 12, marginTop: 2, letterSpacing: '0.06em' }}>
                  {tradeDate}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   COLOR SWATCH ROW
───────────────────────────────────────────────────────────────── */
function ColorSelectorRow({ expiry, color, onColorChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        border: `1px solid ${color}50`,
        background: `${color}0F`,
        fontFamily: mono,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.10em',
        color,
        textTransform: 'uppercase',
        minWidth: 110,
      }}>
        <span style={{ display: 'inline-block', width: 6, height: 6, background: color, flexShrink: 0 }} />
        {expiry}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            title={c}
            style={{
              width: 12,
              height: 12,
              background: c,
              border: c === color ? `1px solid ${T.textHi}` : '1px solid transparent',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              transition: 'transform 100ms',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   SECTION HEADER  (matches TimeSeriesChart header strip)
───────────────────────────────────────────────────────────────── */
function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 14px',
      borderBottom: `1px solid ${T.border}`,
      background: T.surface,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: T.textHi,
          fontFamily: mono,
        }}>
          {title}
        </span>
        {subtitle && (
          <span style={{
            fontSize: 9,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: T.textLo,
            fontFamily: mono,
          }}>
            {subtitle}
          </span>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PILL TOGGLE BUTTON
───────────────────────────────────────────────────────────────── */
function ToggleBtn({ active, onClick, children, color = T.amber }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px',
        border: `1px solid ${active ? `${color}60` : T.border}`,
        background: active ? `${color}14` : 'transparent',
        color: active ? color : T.textMid,
        fontFamily: mono,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 120ms',
      }}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN OI CHART  (ticker analytics mode)
───────────────────────────────────────────────────────────────── */
export default function OIChart({ assetType, ticker, expiries = [], mode = 'ticker' }) {
  const [seriesData, setSeriesData]         = useState({});
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const [activeExpiries, setActiveExpiries] = useState([]);
  const [colorMap, setColorMap]             = useState({});
  const [chartMetric, setChartMetric]       = useState('oi');

  useEffect(() => {
    if (!expiries.length) return;
    setActiveExpiries(expiries.slice(0, 3));
    const map = {};
    expiries.forEach((exp, i) => { map[exp] = PALETTE[i % PALETTE.length]; });
    setColorMap(map);
  }, [expiries]);

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
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: 40, display: 'flex', justifyContent: 'center' }}>
      <LoadingSpinner />
    </div>
  );
  if (error) return (
    <div style={{ border: `1px solid ${T.red}30`, background: `${T.red}0F`, padding: '10px 14px', color: T.red, fontFamily: mono, fontSize: 11 }}>
      {error}
    </div>
  );

  const metrics = [
    { key: 'oi',      label: 'Open Interest' },
    { key: 'chng_oi', label: 'OI Change'     },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Control strip */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <SectionHeader
          title={`OI Cycle — ${ticker}`}
          subtitle="Expiry series aligned by DTE"
          right={
            <div style={{ display: 'flex', gap: 2 }}>
              {metrics.map(({ key, label }) => (
                <ToggleBtn key={key} active={chartMetric === key} onClick={() => setChartMetric(key)}>
                  {label}
                </ToggleBtn>
              ))}
            </div>
          }
        />

        {/* Expiry toggles */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 14px' }}>
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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  border: `1px solid ${active ? `${color}50` : T.border}`,
                  background: active ? `${color}0F` : 'transparent',
                  color: active ? color : T.textLo,
                  fontFamily: mono,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'all 120ms',
                }}
              >
                <span style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  background: active ? color : T.textLo,
                  flexShrink: 0,
                }} />
                {exp}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart panel */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        {chartData.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: mono, fontSize: 11, color: T.textLo, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
            No data — toggle at least one expiry above
          </div>
        ) : (
          <div style={{ width: '100%', height: 380, padding: '8px 0 0' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 16, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="2 4" stroke={T.grid} vertical={false} />
                <XAxis
                  dataKey="offset"
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={{ stroke: T.axis }}
                  tickFormatter={(v) => v === 0 ? 'EXP' : `${v}D`}
                />
                <YAxis
                  tick={tickStyle}
                  tickFormatter={formatOI}
                  tickLine={false}
                  axisLine={false}
                  width={65}
                />
                <Tooltip
                  content={<TerminalTooltip />}
                  cursor={{ stroke: T.borderHi, strokeWidth: 1, strokeDasharray: '3 3' }}
                />
                <Legend
                  formatter={(value) => (
                    <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: T.textMid }}>
                      {value}
                    </span>
                  )}
                />
                {activeExpiries.map((exp) => (
                  <Line
                    key={exp}
                    type="linear"
                    dataKey={`${exp}_${chartMetric}`}
                    name={exp}
                    stroke={colorMap[exp] ?? T.blue}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
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
───────────────────────────────────────────────────────────────── */
export function ScreenerOIChart({
  assetType,
  ticker,
  allExpiries = [],
  selectedCycles = [],
  allDates = [],
  metricToggle = false,
  fetchHistory = null,
  metricKeys = null,
}) {
  const [historyRows, setHistoryRows] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [colorMap, setColorMap]       = useState({});
  const [dragOffset, setDragOffset]   = useState(0);
  const [activeMetric, setActiveMetric] = useState(metricKeys?.default ?? 'open_int');

  const resolvedMetricKey = activeMetric === 'combined' ? null : activeMetric;

  const isDragging     = useRef(false);
  const dragStartX     = useRef(0);
  const dragStartOffset = useRef(0);

  const isCombined = ticker === FUTURES_COMBINED_TICKER;

  const orderedExpiries = useMemo(() =>
    [...allExpiries].sort((a, b) => new Date(a) - new Date(b)),
  [allExpiries]);

  const inProgressCycle = useMemo(() => {
    if (!selectedCycles.length || !orderedExpiries.length) return null;
    const today = new Date();
    return orderedExpiries.find((e) => new Date(e) >= today) ?? null;
  }, [orderedExpiries, selectedCycles]);

  useEffect(() => {
    setColorMap((prev) => {
      const map = { ...prev };
      allExpiries.forEach((exp, i) => {
        if (!map[exp]) map[exp] = PALETTE[i % PALETTE.length];
      });
      return map;
    });
  }, [allExpiries]);

  useEffect(() => { setDragOffset(0); }, [inProgressCycle]);

  useEffect(() => {
    if (!ticker) return;
    let mounted = true;
    setLoading(true);

    const fetcher = fetchHistory
      ? fetchHistory(assetType, ticker)
      : isCombined
        ? getFuturesMarketHistory(assetType)
        : getFuturesCycleHistory(assetType, ticker);

    fetcher
      .then((res) => { if (mounted) { setHistoryRows(res?.rows || []); setLoading(false); } })
      .catch(() => { if (mounted) { setHistoryRows([]); setLoading(false); } });

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetType, ticker, fetchHistory, isCombined]);

  const chartData = useMemo(() => {
    const FRAME = Array.from({ length: 25 }, (_, i) => i - 24);
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
        cycleRows = historyRows.filter((r) => {
          const td = r.trade_date?.split?.('T')[0] ?? String(r.trade_date).slice(0, 10);
          return (!prevExpiry || td > prevExpiry) && td <= cycleExp;
        });
      } else {
        const allCycleRows = historyRows.filter((r) => {
          const rowExpiry =
            r.expiry?.split?.('T')[0] ??
            String(r.expiry).slice(0, 10);

          return constituents.includes(rowExpiry);
        });

        cycleRows = allCycleRows;
      }

      const groupedByDate = {};
      cycleRows.forEach((r) => {
        const td = r.trade_date?.split?.('T')[0] ?? String(r.trade_date).slice(0, 10);
        if (!groupedByDate[td]) groupedByDate[td] = {};

        if (metricToggle) {
          groupedByDate[td].ce = (groupedByDate[td].ce || 0) + (Number(r.ce_oi) || 0);
          groupedByDate[td].pe = (groupedByDate[td].pe || 0) + (Number(r.pe_oi) || 0);
        } else {
          groupedByDate[td].open_int    = (groupedByDate[td].open_int    || 0) + (Number(r.open_int)    || 0);
          groupedByDate[td].chng_in_oi = (groupedByDate[td].chng_in_oi || 0) + (Number(r.chng_in_oi) || 0);
        }
      });

      const plotByDate = {};
      Object.entries(groupedByDate).forEach(([td, values]) => {
        if (metricToggle) {
          const ce = values.ce || 0;
          const pe = values.pe || 0;
          if (activeMetric === 'ce_oi')     plotByDate[td] = ce;
          else if (activeMetric === 'pe_oi')     plotByDate[td] = pe;
          else if (activeMetric === 'combined')  plotByDate[td] = ce + pe;
          else if (activeMetric === 'pcr')       plotByDate[td] = ce > 0 ? pe / ce : null;
        } else {
          plotByDate[td] = values[resolvedMetricKey] ?? null;
        }
      });

      let tradingDates = Object.keys(groupedByDate).sort((a, b) => new Date(a) - new Date(b));
      if (metricToggle) tradingDates = tradingDates.slice(-25);
      const lastIdx = tradingDates.length - 1;

      tradingDates.forEach((date, i) => {
        let offset = i - lastIdx;
        if (isInProgress) offset = offset + dragOffset;
        if (offset < -24 || offset > 0) return;
        if (!offsetMap[offset]) offsetMap[offset] = { offset };
        offsetMap[offset][cycleExp]           = plotByDate[date] ?? null;
        offsetMap[offset][`${cycleExp}_date`] = date;
      });
    });

    return FRAME.map((o) => offsetMap[o] ?? { offset: o });
  }, [historyRows, selectedCycles, orderedExpiries, inProgressCycle, dragOffset, isCombined, activeMetric]);

  /* ── Drag handlers ── */
  const handleMouseDown = (e) => {
    isDragging.current      = true;
    dragStartX.current      = e.clientX;
    dragStartOffset.current = dragOffset;
    e.preventDefault();
  };

  useEffect(() => {
    const PIXELS_PER_DAY = 18;
    const onMove = (e) => {
      if (!isDragging.current) return;
      const deltaX    = e.clientX - dragStartX.current;
      const deltaDays = Math.round(deltaX / PIXELS_PER_DAY);
      const newOffset = Math.max(-24, Math.min(0, dragStartOffset.current + deltaDays));
      setDragOffset(newOffset);
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragOffset]);

  /* ── Empty states ── */
  if (!ticker) return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: '40px 20px', textAlign: 'center', fontFamily: mono, fontSize: 11, color: T.textLo, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
      Select a ticker to view OI chart
    </div>
  );
  if (!selectedCycles.length) return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: '40px 20px', textAlign: 'center', fontFamily: mono, fontSize: 11, color: T.textLo, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
      Select up to 5 expiry cycles to compare
    </div>
  );

  const isPcr = activeMetric === 'pcr';

  /* ── Options metric buttons ── */
  const optionMetrics = [
    { key: 'ce_oi',    label: 'CE OI',   color: T.blue  },
    { key: 'pe_oi',    label: 'PE OI',   color: T.pink  },
    { key: 'combined', label: 'CE+PE',   color: T.green },
    { key: 'pcr',      label: 'PCR',     color: T.amber },
  ];

  const futuresMetrics = [
    { key: 'open_int',    label: 'Open Interest' },
    { key: 'chng_in_oi',  label: 'OI Change'     },
  ];

  const metricButtons = metricToggle ? optionMetrics : futuresMetrics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Control / color panel */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <SectionHeader
          title={isCombined ? 'OI CYCLE — ALL TICKERS' : `OI CYCLE — ${ticker}`}
          subtitle={
            isCombined
              ? 'Sum of all tickers · Fixed 25D window'
              : metricToggle
                ? 'Constituent expiries within cycle window · 25D'
                : 'Current + next + far month · 25D window'
          }
          right={
            <div style={{ display: 'flex', gap: 2 }}>
              {metricButtons.map(({ key, label, color }) => (
                <ToggleBtn
                  key={key}
                  active={activeMetric === key}
                  onClick={() => setActiveMetric(key)}
                  color={color ?? T.amber}
                >
                  {label}
                </ToggleBtn>
              ))}
            </div>
          }
        />

        {/* Cycle rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 14px' }}>
          {selectedCycles.map((exp) => {
            const isInProgress = exp === inProgressCycle;
            return (
              <div key={exp} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ColorSelectorRow
                  expiry={exp}
                  color={colorMap[exp] ?? T.blue}
                  onColorChange={(c) => setColorMap((prev) => ({ ...prev, [exp]: c }))}
                />
                {isInProgress && (
                  <>
                    <span style={{
                      fontFamily: mono,
                      fontSize: 9,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: T.amber,
                      padding: '2px 6px',
                      border: `1px solid ${T.amber}40`,
                      background: `${T.amber}0F`,
                    }}>
                      LIVE
                    </span>
                    <div
                      onMouseDown={handleMouseDown}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 10px',
                        border: `1px solid ${T.border}`,
                        background: 'transparent',
                        fontFamily: mono,
                        fontSize: 10,
                        color: T.textMid,
                        letterSpacing: '0.08em',
                        cursor: 'ew-resize',
                        userSelect: 'none',
                        transition: 'background 120ms',
                      }}
                      title="Drag to shift in-progress cycle"
                    >
                      ⟷ {dragOffset === 0 ? 'ANCHORED' : `${dragOffset > 0 ? '+' : ''}${dragOffset}D`}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <LoadingSpinner />
          </div>
        ) : (
          <div style={{ width: '100%', height: 420, padding: '8px 0 0' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 16, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="2 4" stroke={T.grid} vertical={false} />
                <XAxis
                  dataKey="offset"
                  type="number"
                  domain={[-24, 0]}
                  ticks={[-24, -20, -15, -10, -5, 0]}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={{ stroke: T.axis }}
                  tickFormatter={(v) => v === 0 ? 'EXP' : `${v}D`}
                />
                <YAxis
                  tick={tickStyle}
                  tickFormatter={isPcr ? (v) => v != null ? v.toFixed(2) : '' : formatOI}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <Tooltip
                  content={<TerminalTooltip isPcr={isPcr} />}
                  cursor={{ stroke: T.borderHi, strokeWidth: 1, strokeDasharray: '3 3' }}
                />
                <Legend
                  formatter={(value) => (
                    <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: T.textMid }}>
                      {value}{value === inProgressCycle ? ' ●' : ''}
                    </span>
                  )}
                />
                {selectedCycles.map((exp) => (
                  <Line
                    key={exp}
                    type="monotone"
                    dataKey={exp}
                    name={exp}
                    stroke={colorMap[exp] ?? T.blue}
                    strokeWidth={exp === inProgressCycle ? 2.5 : 1.8}
                    strokeDasharray={exp === inProgressCycle ? '6 3' : undefined}
                    dot={false}
                    connectNulls
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
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
───────────────────────────────────────────────────────────────── */
export function OptionsOIChart({ assetType, ticker, allExpiries, selectedCycles }) {
  const fetchHistory = useCallback((at, t) =>
    t === OPTIONS_COMBINED_TICKER
      ? getOptionsMarketHistory(at)
      : getOptionsCycleHistory(at, t),
  []);

  return (
    <ScreenerOIChart
      assetType={assetType}
      ticker={ticker}
      allExpiries={allExpiries}
      selectedCycles={selectedCycles}
      metricToggle
      fetchHistory={fetchHistory}
      metricKeys={{ default: 'ce_oi', options: ['ce_oi', 'pe_oi', 'combined'] }}
    />
  );
}
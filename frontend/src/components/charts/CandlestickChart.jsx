// frontend/src/components/charts/CandlestickChart.jsx
//
// Requires: npm install lightweight-charts
//
// Props:
//   data            – array of { trade_date: 'YYYY-MM-DD', open, high, low, close, avg_price?, prev_close? }
//   formatCurrency  – (value, decimals) => string
//
// This component now owns its own toolbar (OHLC / Avg Price toggles +
// indicator chips + "+" add-indicator menu). Stocks.jsx no longer needs to
// pass showCandles/showAvg — they're internal state here.

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart, CrosshairMode, LineStyle, CandlestickSeries, LineSeries } from 'lightweight-charts';
import {
  computeIndicatorLines,
  describeIndicator,
  nextColor,
  validateFormula,
  FormulaError,
} from './indicators';

/* ─── Design tokens ────────────────────────────────────────────── */
const T = {
  bg:       '#06080C',
  surface:  '#0B0F16',
  elevated: '#111720',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.14)',
  amber:    '#F0A500',
  amberDim: 'rgba(240,165,0,0.12)',
  green:    '#00C896',
  red:      '#E05252',
  textHi:   'rgba(255,255,255,0.90)',
  textMid:  'rgba(255,255,255,0.50)',
  textLo:   'rgba(255,255,255,0.25)',
  grid:     'rgba(255,255,255,0.06)',
  axis:     'rgba(255,255,255,0.12)',
};

const monoFont = "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace";

/* ─── Tooltip DOM helper ───────────────────────────────────────── */
function buildTooltipEl() {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position:    'absolute',
    top:         '0',
    left:        '0',
    display:     'none',
    zIndex:      '10',
    pointerEvents: 'none',
    background:  T.elevated,
    border:      `1px solid ${T.borderHi}`,
    padding:     '10px 14px',
    boxShadow:   '0 8px 32px rgba(0,0,0,0.8)',
    minWidth:    '180px',
    fontFamily:  monoFont,
  });
  return el;
}

function renderTooltip(el, bar, showCandles, showAvg, formatCurrency, indicatorVals) {
  if (!bar) { el.style.display = 'none'; return; }

  const { time, open, high, low, close, avg_price, prev_close } = bar;

  const change = prev_close != null && close != null
    ? ((close - prev_close) / prev_close * 100).toFixed(2)
    : null;

  const fields = [
    showCandles && open  != null && { label: 'OPEN',  value: formatCurrency(open,  2), color: T.textMid },
    showCandles && high  != null && { label: 'HIGH',  value: formatCurrency(high,  2), color: T.green   },
    showCandles && low   != null && { label: 'LOW',   value: formatCurrency(low,   2), color: T.red     },
    showCandles && close != null && { label: 'CLOSE', value: formatCurrency(close, 2), color: T.textHi  },
    showAvg    && avg_price != null && { label: 'AVG', value: formatCurrency(avg_price, 2), color: T.amber },
  ].filter(Boolean);

  // Format date label: time is 'YYYY-MM-DD'
  const dateLabel = typeof time === 'string' ? time.slice(5) : String(time);

  const indicatorRows = (indicatorVals || []).map(({ label, value, color }) => `
    <div style="
      display:flex; justify-content:space-between; align-items:center;
      gap:20px; font-size:11px; letter-spacing:0.05em; margin-bottom:4px;
    ">
      <span style="color:${color}; font-size:9px; font-weight:700; letter-spacing:0.10em;">${label}</span>
      <span style="color:${T.textHi}; font-variant-numeric:tabular-nums; font-weight:600;">${formatCurrency(value, 2)}</span>
    </div>
  `).join('');

  el.innerHTML = `
    <div style="
      font-size:9px; font-weight:700; letter-spacing:0.14em;
      text-transform:uppercase; color:${T.textLo};
      margin-bottom:8px; border-bottom:1px solid ${T.border}; padding-bottom:6px;
    ">${dateLabel}</div>
    ${fields.map(({ label, value, color }) => `
      <div style="
        display:flex; justify-content:space-between; align-items:center;
        gap:20px; font-size:11px; letter-spacing:0.05em; margin-bottom:4px;
      ">
        <span style="color:${T.textMid}; font-size:9px; font-weight:700; letter-spacing:0.12em;">${label}</span>
        <span style="color:${color}; font-variant-numeric:tabular-nums; font-weight:600;">${value}</span>
      </div>
    `).join('')}
    ${indicatorRows}
    ${change != null ? `
      <div style="
        margin-top:6px; padding-top:6px; border-top:1px solid ${T.border};
        display:flex; justify-content:space-between;
        font-size:9px; letter-spacing:0.10em;
      ">
        <span style="color:${T.textLo}; font-weight:700;">CHG</span>
        <span style="color:${parseFloat(change) >= 0 ? T.green : T.red}; font-weight:700;">
          ${parseFloat(change) >= 0 ? '+' : ''}${change}%
        </span>
      </div>
    ` : ''}
  `;
  el.style.display = 'block';
}

/* ─── Toolbar sub-styles ───────────────────────────────────────── */
const toolbarBtn = (active) => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  fontSize: 10,
  fontFamily: monoFont,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  border: `1px solid ${active ? T.amber : T.border}`,
  background: active ? T.amberDim : 'transparent',
  color: active ? T.amber : T.textMid,
  cursor: 'pointer',
  transition: 'all 120ms',
  borderRadius: 0,
});

const chipStyle = (color) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  fontSize: 10,
  fontFamily: monoFont,
  letterSpacing: '0.06em',
  border: `1px solid ${color}55`,
  background: `${color}1A`,
  color,
  cursor: 'default',
});

const chipCloseBtn = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
  lineHeight: 1,
  padding: 0,
  opacity: 0.7,
};

const plusBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  fontSize: 14,
  fontWeight: 600,
  border: `1px solid ${T.borderHi}`,
  background: 'transparent',
  color: T.textMid,
  cursor: 'pointer',
  borderRadius: 0,
};

/* ─── Add Indicator popup ──────────────────────────────────────── */

const INDICATOR_TYPES = [
  { key: 'ma',        label: 'Moving Average' },
  { key: 'bollinger', label: 'Bollinger Bands' },
  { key: 'custom',    label: 'Custom Formula' },
];

const popupInputStyle = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.textHi,
  fontSize: 11,
  fontFamily: monoFont,
  padding: '5px 8px',
  outline: 'none',
  borderRadius: 0,
  width: '100%',
  boxSizing: 'border-box',
};

const popupLabel = {
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.textMid,
  marginBottom: 4,
  display: 'block',
};

function AddIndicatorPopup({ onAdd, onClose }) {
  const [type, setType] = useState('ma');
  const [method, setMethod] = useState('sma');
  const [period, setPeriod] = useState(20);
  const [stdDev, setStdDev] = useState(2);
  const [source, setSource] = useState('close');
  const [formula, setFormula] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);

  const popupRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleSubmit = () => {
    setError(null);

    if (type === 'ma') {
      if (!period || period < 1) { setError('Period must be a positive number'); return; }
      onAdd({ type: 'ma', params: { method, period: Math.round(period), source } });
      return;
    }

    if (type === 'bollinger') {
      if (!period || period < 1) { setError('Period must be a positive number'); return; }
      if (!stdDev || stdDev <= 0) { setError('Std dev must be a positive number'); return; }
      onAdd({ type: 'bollinger', params: { period: Math.round(period), stdDev: Number(stdDev), source } });
      return;
    }

    if (type === 'custom') {
      if (!formula.trim()) { setError('Enter a formula'); return; }
      try {
        validateFormula(formula);
      } catch (e) {
        setError(e instanceof FormulaError ? e.message : 'Invalid formula');
        return;
      }
      onAdd({ type: 'custom', params: { formula: formula.trim(), label: label.trim() || formula.trim() } });
      return;
    }
  };

  return (
    <div
      ref={popupRef}
      style={{
        position: 'absolute',
        top: 36,
        right: 0,
        zIndex: 20,
        width: 280,
        background: T.elevated,
        border: `1px solid ${T.borderHi}`,
        boxShadow: '0 12px 36px rgba(0,0,0,0.85)',
        padding: 14,
        fontFamily: monoFont,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textHi, marginBottom: 12 }}>
        Add Indicator
      </div>

      {/* Type selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {INDICATOR_TYPES.map(({ key, label: l }) => (
          <button
            key={key}
            onClick={() => { setType(key); setError(null); }}
            style={{ ...toolbarBtn(type === key), flex: 1, justifyContent: 'center', fontSize: 9 }}
          >
            {l}
          </button>
        ))}
      </div>

      {type === 'ma' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={popupLabel}>Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...popupInputStyle, cursor: 'pointer' }}>
                <option value="sma">SMA</option>
                <option value="ema">EMA</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <span style={popupLabel}>Period (days)</span>
              <input type="number" min="1" value={period} onChange={(e) => setPeriod(e.target.value)} style={popupInputStyle} />
            </div>
          </div>
          <div>
            <span style={popupLabel}>Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} style={{ ...popupInputStyle, cursor: 'pointer' }}>
              <option value="close">Close</option>
              <option value="open">Open</option>
              <option value="high">High</option>
              <option value="low">Low</option>
              <option value="avg_price">Avg Price</option>
            </select>
          </div>
        </div>
      )}

      {type === 'bollinger' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={popupLabel}>Period (days)</span>
              <input type="number" min="1" value={period} onChange={(e) => setPeriod(e.target.value)} style={popupInputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={popupLabel}>Std Dev</span>
              <input type="number" min="0.1" step="0.1" value={stdDev} onChange={(e) => setStdDev(e.target.value)} style={popupInputStyle} />
            </div>
          </div>
          <div>
            <span style={popupLabel}>Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} style={{ ...popupInputStyle, cursor: 'pointer' }}>
              <option value="close">Close</option>
              <option value="open">Open</option>
              <option value="high">High</option>
              <option value="low">Low</option>
              <option value="avg_price">Avg Price</option>
            </select>
          </div>
        </div>
      )}

      {type === 'custom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={popupLabel}>Formula</span>
            <input
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="sma(close,20) + 2*stdev(close,20)"
              style={popupInputStyle}
            />
            <div style={{ fontSize: 9, color: T.textLo, marginTop: 4, lineHeight: 1.5 }}>
              Series: open, high, low, close, avg_price<br />
              Functions: sma(series,n) · ema(series,n) · stdev(series,n)
            </div>
          </div>
          <div>
            <span style={popupLabel}>Label (optional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. My Formula" style={popupInputStyle} />
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 10, fontSize: 10, color: T.red, letterSpacing: '0.03em' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={onClose}
          style={{ ...toolbarBtn(false), flex: 1, justifyContent: 'center' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          style={{
            flex: 1,
            justifyContent: 'center',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '5px 10px',
            fontSize: 10,
            fontFamily: monoFont,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            border: `1px solid ${T.amber}`,
            background: T.amberDim,
            color: T.amber,
            cursor: 'pointer',
            borderRadius: 0,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ─── Chart component ──────────────────────────────────────────── */
// Props (updated):
//   data              – bar array
//   formatCurrency    – formatter
//   indicators        – controlled: [{id, type, params, color}]
//   onIndicatorsChange – (newArray) => void
//   showCandles       – controlled boolean
//   onShowCandlesChange – (bool) => void
//   showAvg           – controlled boolean
//   onShowAvgChange   – (bool) => void
export default function CandlestickChart({
  data,
  formatCurrency,
  indicators,
  onIndicatorsChange,
  showCandles,
  onShowCandlesChange,
  showAvg,
  onShowAvgChange,
}) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);
  const avgRef       = useRef(null);
  const tooltipRef   = useRef(null);
  // Keep a fast lookup from time string → full data row for tooltip enrichment
  const dataMapRef   = useRef({});
  // indicator line series refs, keyed by series key (e.g. "ind123-line")
  const indicatorSeriesRef = useRef({});
  // indicator points lookup for tooltip enrichment: { [seriesKey]: { [time]: value } }
  const indicatorPointsRef = useRef({});

  const [popupOpen, setPopupOpen] = useState(false);

  // stable refs so the crosshair handler doesn't go stale
  const showCandlesRef = useRef(showCandles);
  const showAvgRef     = useRef(showAvg);
  const indicatorsRef  = useRef(indicators);
  showCandlesRef.current = showCandles;
  showAvgRef.current     = showAvg;
  indicatorsRef.current  = indicators;

  const handleAddIndicator = useCallback((partial) => {
    const color = nextColor(indicators.map((p) => p.color));
    const id = `ind-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    onIndicatorsChange([...indicators, { id, color, ...partial }]);
    setPopupOpen(false);
  }, [indicators, onIndicatorsChange]);

  const handleRemoveIndicator = useCallback((id) => {
    onIndicatorsChange(indicators.filter((i) => i.id !== id));
  }, [indicators, onIndicatorsChange]);

  /* ── Build/destroy chart on mount ─────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 560,
      layout: {
        background:   { color: T.surface },
        textColor:    T.textMid,
        fontFamily:   monoFont,
        fontSize:     10,
      },
      grid: {
        vertLines:   { color: T.grid,   style: LineStyle.Dotted },
        horzLines:   { color: T.grid,   style: LineStyle.Dotted },
      },
      crosshair: {
        mode:          CrosshairMode.Normal,
        vertLine: {
          color:        T.borderHi,
          width:        1,
          style:        LineStyle.Dashed,
          labelVisible: true,
          labelBackgroundColor: T.elevated,
        },
        horzLine: {
          color:        T.borderHi,
          width:        1,
          style:        LineStyle.Dashed,
          labelVisible: true,
          labelBackgroundColor: T.elevated,
        },
      },
      rightPriceScale: {
        borderColor:        T.axis,
        scaleMargins:       { top: 0.08, bottom: 0.08 },
        minimumWidth:       72,
        ticksVisible:       true,
        borderVisible:      true,
        entireTextOnly:     false,
      },
      timeScale: {
        borderColor:              T.axis,
        borderVisible:            true,
        visible:                  true,
        ticksVisible:             true,
        timeVisible:              false,
        secondsVisible:           false,
        fixLeftEdge:              true,
        fixRightEdge:             true,
        tickMarkMaxCharacterLength: 6,
      },
      handleScroll: true,
      handleScale:  true,
    });

    chartRef.current = chart;

    // ── Tooltip overlay ───────────────────────────────────────────
    const tooltipEl = buildTooltipEl();
    containerRef.current.appendChild(tooltipEl);
    tooltipRef.current = tooltipEl;

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time) {
        tooltipEl.style.display = 'none';
        return;
      }

      const timeKey = typeof param.time === 'object'
        ? `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`
        : String(param.time);

      const row = dataMapRef.current[timeKey];
      if (!row) { tooltipEl.style.display = 'none'; return; }

      // Merge series data into row for tooltip
      const candleSeries = candleRef.current;
      const seriesData   = candleSeries ? param.seriesData?.get(candleSeries) : null;
      const merged = {
        ...row,
        ...(seriesData || {}),
        time: timeKey,
      };

      // Gather indicator values at this time for tooltip (uses precomputed
      // points map from the indicator-sync effect — covers multi-line
      // indicators like Bollinger Bands automatically since each line has
      // its own key prefixed with the indicator id).
      const indicatorVals = [];
      for (const ind of indicatorsRef.current) {
        for (const key of Object.keys(indicatorPointsRef.current)) {
          if (!key.startsWith(ind.id)) continue;
          const val = indicatorPointsRef.current[key][timeKey];
          if (val == null) continue;
          const meta = indicatorSeriesRef.current[key];
          indicatorVals.push({ label: meta?.label || key, value: val, color: meta?.color || T.textHi });
        }
      }

      renderTooltip(tooltipEl, merged, showCandlesRef.current, showAvgRef.current, formatCurrency, indicatorVals);

      // Position tooltip: keep within container bounds
      const { width: cw } = containerRef.current.getBoundingClientRect();
      const tw = tooltipEl.offsetWidth || 180;
      const left = param.point.x + 16 + tw > cw
        ? param.point.x - tw - 8
        : param.point.x + 16;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top  = `${Math.max(0, param.point.y - 60)}px`;
    });

    // ── Resize observer ───────────────────────────────────────────
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      tooltipEl.remove();
      chart.remove();
      chartRef.current  = null;
      candleRef.current = null;
      avgRef.current    = null;
      tooltipRef.current = null;
      indicatorSeriesRef.current = {};
      indicatorPointsRef.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sync candle/avg data whenever it changes ─────────────────── */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data?.length) return;

    // Build lookup map for tooltip enrichment
    const map = {};
    data.forEach((row) => { map[row.trade_date] = row; });
    dataMapRef.current = map;

    // lightweight-charts supports per-bar color/borderColor/wickColor.
    // Color  = close vs prev_close: green if up, red if down
    // Fill   = close vs open:       hollow (transparent) if close>=open, filled if close<open
    // This gives all 4 combinations: hollow-green, filled-green, hollow-red, filled-red
    const ohlc = data
      .filter((r) => r.open != null && r.high != null && r.low != null && r.close != null)
      .map((r) => {
        const sentiment  = r.prev_close != null ? r.close > r.prev_close : r.close >= r.open;
        const accentColor = sentiment ? T.green : T.red;
        const isHollow    = r.close >= r.open;
        return {
          time:        r.trade_date,
          open:        r.open,
          high:        r.high,
          low:         r.low,
          close:       r.close,
          color:       isHollow ? 'transparent' : accentColor,
          borderColor: accentColor,
          wickColor:   accentColor,
        };
      })
      .sort((a, b) => (a.time < b.time ? -1 : 1));

    const lineData = data
      .filter((r) => r.avg_price != null)
      .map((r) => ({ time: r.trade_date, value: r.avg_price }))
      .sort((a, b) => (a.time < b.time ? -1 : 1));

    // ── Candle series ─────────────────────────────────────────────
    if (candleRef.current) {
      chart.removeSeries(candleRef.current);
      candleRef.current = null;
    }

    if (showCandles && ohlc.length) {
      const series = chart.addSeries(CandlestickSeries, {
        // Per-bar color/borderColor/wickColor is set on each data point above.
        // These defaults are fallbacks only (should never show).
        upColor:          'transparent',
        downColor:        T.red,
        borderUpColor:    T.green,
        borderDownColor:  T.red,
        wickUpColor:      T.green,
        wickDownColor:    T.red,
        priceFormat: {
          type:      'price',
          precision: 2,
          minMove:   0.01,
        },
      });
      series.setData(ohlc);
      candleRef.current = series;
    }

    // ── Avg price line ────────────────────────────────────────────
    if (avgRef.current) {
      chart.removeSeries(avgRef.current);
      avgRef.current = null;
    }

    if (showAvg && lineData.length) {
      const series = chart.addSeries(LineSeries, {
        color:           T.amber,
        lineWidth:       1,
        lineStyle:       LineStyle.Dashed,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius:  3,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      series.setData(lineData);
      avgRef.current = series;
    }

    chart.timeScale().fitContent();
  }, [data, showCandles, showAvg]);

  /* ── Sync indicator overlays whenever data or indicator list changes ── */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove all existing indicator series first (simplest correct approach;
    // indicator count is small so this is cheap)
    for (const key of Object.keys(indicatorSeriesRef.current)) {
      const entry = indicatorSeriesRef.current[key];
      if (entry?.series) {
        try { chart.removeSeries(entry.series); } catch { /* already gone */ }
      }
    }
    indicatorSeriesRef.current = {};
    indicatorPointsRef.current = {};

    if (!data?.length) return;

    for (const ind of indicators) {
      let lines;
      try {
        lines = computeIndicatorLines(ind, data);
      } catch (e) {
        // Skip a broken indicator rather than crashing the whole chart
        console.error('Indicator computation failed:', ind, e);
        continue;
      }

      for (const line of lines) {
        const series = chart.addSeries(LineSeries, {
          color: line.color,
          lineWidth: 1,
          lineStyle: line.lineStyle ?? 0,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(line.points);

        const pointsByTime = {};
        for (const p of line.points) pointsByTime[p.time] = p.value;

        indicatorSeriesRef.current[line.key] = { series, color: line.color, label: line.label };
        indicatorPointsRef.current[line.key] = pointsByTime;
      }
    }
  }, [data, indicators]);

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, fontFamily: monoFont }}>

      {/* Header strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: `1px solid ${T.border}`,
      }}>
        <div>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: T.textHi,
          }}>
            Price Action
          </span>
          <span style={{
            fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase',
            color: T.textLo, marginLeft: 12,
          }}>
            OHLC + Avg + Indicators
          </span>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {showCandles && [['BULL', T.green], ['BEAR', T.red]].map(([name, color]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 12, background: color }} />
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: T.textMid,
              }}>
                {name}
              </span>
            </div>
          ))}
          {showAvg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <svg width="20" height="10">
                <line x1="0" y1="5" x2="20" y2="5" stroke={T.amber} strokeWidth="1.5" strokeDasharray="4 3" />
              </svg>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: T.textMid,
              }}>
                AVG
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Indicator / overlay toolbar */}
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        padding: '8px 16px', borderBottom: `1px solid ${T.border}`,
        background: T.elevated,
      }}>
        <button style={toolbarBtn(showCandles)} onClick={() => onShowCandlesChange(!showCandles)}>
          OHLC
        </button>
        <button style={toolbarBtn(showAvg)} onClick={() => onShowAvgChange(!showAvg)}>
          Avg Price
        </button>

        <div style={{ width: 1, alignSelf: 'stretch', background: T.border, margin: '0 4px' }} />

        {indicators.map((ind) => (
          <div key={ind.id} style={chipStyle(ind.color)}>
            <span>{describeIndicator(ind)}</span>
            <button style={chipCloseBtn} onClick={() => handleRemoveIndicator(ind.id)} title="Remove indicator">
              ×
            </button>
          </div>
        ))}

        <div style={{ position: 'relative', marginLeft: 'auto'}}>
          <button style={plusBtn} onClick={() => setPopupOpen((v) => !v)} title="Add indicator">
            +
          </button>
          {popupOpen && (
            <AddIndicatorPopup
              onAdd={handleAddIndicator}
              onClose={() => setPopupOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Chart mount point — lightweight-charts injects its own canvas here */}
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: 560 }}
      />
    </div>
  );
}
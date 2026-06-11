// frontend/src/components/charts/CandlestickChart.jsx
//
// Requires: npm install lightweight-charts
//
// Props:
//   data            – array of { trade_date: 'YYYY-MM-DD', open, high, low, close, avg_price?, prev_close? }
//   showCandles     – boolean
//   showAvg         – boolean
//   formatCurrency  – (value, decimals) => string

import { useEffect, useRef, useCallback } from 'react';
import { createChart, CrosshairMode, LineStyle, CandlestickSeries, LineSeries } from 'lightweight-charts';

/* ─── Design tokens ────────────────────────────────────────────── */
const T = {
  bg:       '#06080C',
  surface:  '#0B0F16',
  elevated: '#111720',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.14)',
  amber:    '#F0A500',
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

function renderTooltip(el, bar, showCandles, showAvg, formatCurrency) {
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

/* ─── Chart component ──────────────────────────────────────────── */
export default function CandlestickChart({ data, showCandles, showAvg, formatCurrency }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);
  const avgRef       = useRef(null);
  const tooltipRef   = useRef(null);
  // Keep a fast lookup from time string → full data row for tooltip enrichment
  const dataMapRef   = useRef({});

  // stable ref so the crosshair handler doesn't go stale
  const showCandlesRef = useRef(showCandles);
  const showAvgRef     = useRef(showAvg);
  showCandlesRef.current = showCandles;
  showAvgRef.current     = showAvg;

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

      renderTooltip(tooltipEl, merged, showCandlesRef.current, showAvgRef.current, formatCurrency);

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
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sync data whenever it changes ──────────────────────────────── */
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
            OHLC + Avg
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

      {/* Chart mount point — lightweight-charts injects its own canvas here */}
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: 560 }}
      />
    </div>
  );
}
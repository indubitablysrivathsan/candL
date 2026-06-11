// frontend/src/components/charts/TimeSeriesChart.jsx
//
// Requires: npm install lightweight-charts  (same dep as CandlestickChart/PCRChart)
//
// Props:
//   analyticsData – array of { trade_date: 'YYYY-MM-DD', underlying: number, max_pain: number }

import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode, LineStyle, AreaSeries, LineSeries } from 'lightweight-charts';
import { formatCurrency } from '../../api/client';

/* ─── Design tokens ─────────────────────────────────────────────── */
const T = {
  surface:  '#0B0F16',
  elevated: '#111720',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.14)',
  green:    '#26a69a',
  pink:     '#D66E9A',
  textHi:   'rgba(255,255,255,0.90)',
  textMid:  'rgba(255,255,255,0.50)',
  textLo:   'rgba(255,255,255,0.25)',
  grid:     'rgba(255,255,255,0.06)',
  axis:     'rgba(255,255,255,0.12)',
};

const monoFont = "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace";

/* ─── Tooltip DOM helper ────────────────────────────────────────── */
function buildTooltipEl() {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position:      'absolute',
    top:           '0',
    left:          '0',
    display:       'none',
    zIndex:        '10',
    pointerEvents: 'none',
    background:    T.elevated,
    border:        `1px solid ${T.borderHi}`,
    padding:       '10px 14px',
    boxShadow:     '0 8px 32px rgba(0,0,0,0.8)',
    minWidth:      '180px',
    fontFamily:    monoFont,
  });
  return el;
}

function renderTooltip(el, timeKey, underlying, maxPain) {
  if (underlying == null && maxPain == null) { el.style.display = 'none'; return; }

  const rows = [
    { label: 'UNDERLYING', value: underlying, color: T.green },
    { label: 'MAX PAIN',   value: maxPain,    color: T.pink  },
  ].filter((r) => r.value != null);

  el.innerHTML = `
    <div style="
      font-size:9px; font-weight:700; letter-spacing:0.14em;
      text-transform:uppercase; color:${T.textLo};
      margin-bottom:8px; border-bottom:1px solid ${T.border}; padding-bottom:6px;
    ">${timeKey}</div>
    ${rows.map(({ label, value, color }) => `
      <div style="
        display:flex; justify-content:space-between; align-items:center;
        gap:20px; font-size:11px; letter-spacing:0.05em; margin-bottom:4px;
      ">
        <span style="color:${color}; font-size:9px; font-weight:700; letter-spacing:0.12em;">${label}</span>
        <span style="color:${T.textHi}; font-variant-numeric:tabular-nums; font-weight:600;">
          ${formatCurrency(value, 2)}
        </span>
      </div>
    `).join('')}
  `;
  el.style.display = 'block';
}

/* ─── Component ─────────────────────────────────────────────────── */
export default function TimeSeriesChart({ analyticsData = [] }) {
  const containerRef    = useRef(null);
  const chartRef        = useRef(null);
  const underlyingRef   = useRef(null);
  const maxPainRef      = useRef(null);
  const tooltipRef      = useRef(null);
  const dataMapRef      = useRef({});

  /* ── Mount ───────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 320,
      layout: {
        background: { color: T.surface },
        textColor:  T.textMid,
        fontFamily: monoFont,
        fontSize:   10,
      },
      grid: {
        vertLines: { color: T.grid, style: LineStyle.Dotted },
        horzLines: { color: T.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color:               T.borderHi,
          width:               1,
          style:               LineStyle.Dashed,
          labelVisible:        true,
          labelBackgroundColor: T.elevated,
        },
        horzLine: {
          color:               T.borderHi,
          width:               1,
          style:               LineStyle.Dashed,
          labelVisible:        true,
          labelBackgroundColor: T.elevated,
        },
      },
      rightPriceScale: {
        borderColor:   T.axis,
        borderVisible: true,
        scaleMargins:  { top: 0.10, bottom: 0.10 },
        minimumWidth:  72,
      },
      timeScale: {
        borderColor:                T.axis,
        borderVisible:              true,
        visible:                    true,
        ticksVisible:               true,
        timeVisible:                false,
        secondsVisible:             false,
        fixLeftEdge:                true,
        fixRightEdge:               true,
        tickMarkMaxCharacterLength: 6,
      },
      handleScroll: true,
      handleScale:  true,
    });

    chartRef.current = chart;

    // Tooltip overlay
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

      const row        = dataMapRef.current[timeKey];
      const underlying = underlyingRef.current ? param.seriesData?.get(underlyingRef.current)?.value : null;
      const maxPain    = maxPainRef.current    ? param.seriesData?.get(maxPainRef.current)?.value    : null;

      renderTooltip(
        tooltipEl,
        timeKey,
        underlying ?? row?.underlying,
        maxPain    ?? row?.max_pain,
      );

      const { width: cw } = containerRef.current.getBoundingClientRect();
      const tw   = tooltipEl.offsetWidth || 180;
      const left = param.point.x + 16 + tw > cw
        ? param.point.x - tw - 8
        : param.point.x + 16;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top  = `${Math.max(0, param.point.y - 50)}px`;
    });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      tooltipEl.remove();
      chart.remove();
      chartRef.current      = null;
      underlyingRef.current = null;
      maxPainRef.current    = null;
      tooltipRef.current    = null;
    };
  }, []);

  /* ── Data sync ───────────────────────────────────────────────────── */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !analyticsData?.length) return;

    const map = {};
    analyticsData.forEach((r) => { map[r.trade_date] = r; });
    dataMapRef.current = map;

    const sorted = [...analyticsData].sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));

    // Remove old series
    if (underlyingRef.current) { chart.removeSeries(underlyingRef.current); underlyingRef.current = null; }
    if (maxPainRef.current)    { chart.removeSeries(maxPainRef.current);    maxPainRef.current    = null; }

    // Underlying — AreaSeries for the soft fill beneath the line
    const underlyingSeries = chart.addSeries(AreaSeries, {
      lineColor:        T.green,
      lineWidth:        2,
      topColor:         `${T.green}18`,   // ~10% opacity fill
      bottomColor:      `${T.green}00`,
      crosshairMarkerVisible:         true,
      crosshairMarkerRadius:          3,
      crosshairMarkerBorderColor:     T.surface,
      crosshairMarkerBackgroundColor: T.green,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    underlyingSeries.setData(
      sorted
        .filter((r) => r.underlying != null)
        .map((r) => ({ time: r.trade_date, value: r.underlying }))
    );
    underlyingRef.current = underlyingSeries;

    // Max Pain — dashed line, no fill
    const maxPainSeries = chart.addSeries(LineSeries, {
      color:            T.pink,
      lineWidth:        2,
      crosshairMarkerVisible:         true,
      crosshairMarkerRadius:          3,
      crosshairMarkerBorderColor:     T.surface,
      crosshairMarkerBackgroundColor: T.pink,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    maxPainSeries.setData(
      sorted
        .filter((r) => r.max_pain != null)
        .map((r) => ({ time: r.trade_date, value: r.max_pain }))
    );
    maxPainRef.current = maxPainSeries;

    chart.timeScale().fitContent();
  }, [analyticsData]);

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, fontFamily: monoFont }}>

      {/* Header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '10px 16px',
        borderBottom:   `1px solid ${T.border}`,
      }}>
        <div>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: T.textHi,
          }}>
            Underlying vs Max Pain
          </span>
          <span style={{
            fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase',
            color: T.textLo, marginLeft: 12,
          }}>
            Price across expiry lifecycle
          </span>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {[
            ['Underlying', T.green, false],
            ['Max Pain',   T.pink,  true ],
          ].map(([name, color, dashed]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <svg width="20" height="10">
                <line
                  x1="0" y1="5" x2="20" y2="5"
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray={dashed ? '4 3' : 'none'}
                />
              </svg>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: T.textMid,
              }}>
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart mount point */}
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: 320 }} />
    </div>
  );
}
// frontend/src/components/charts/DailyChangeChart.jsx
//
// Requires: npm install lightweight-charts
//
// A reusable daily percentage-change bar chart built with lightweight-charts.
// Computes pct_change on-the-fly from { trade_date, close, prev_close } if
// a `pct_change` field is not already present in each row.
//
// Props:
//   data      – array of { trade_date: 'YYYY-MM-DD', close, prev_close, pct_change? }
//   height    – number (px), default 160
//   title     – string shown in the header strip, default 'Daily Change %'

import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode, LineStyle, HistogramSeries } from 'lightweight-charts';

/* ─── Design tokens (match terminal aesthetic) ──────────────────── */
const T = {
  bg:       '#06080C',
  surface:  '#0B0F16',
  elevated: '#111720',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.14)',
  amber:    '#F0A500',
  green:    '#00C896',
  greenDim: 'rgba(0,200,150,0.75)',
  red:      '#E05252',
  redDim:   'rgba(224,82,82,0.75)',
  textHi:   'rgba(255,255,255,0.90)',
  textMid:  'rgba(255,255,255,0.50)',
  textLo:   'rgba(255,255,255,0.25)',
  grid:     'rgba(255,255,255,0.06)',
  axis:     'rgba(255,255,255,0.12)',
};

const monoFont = "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace";

/* ─── Tooltip ───────────────────────────────────────────────────── */
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
    padding:       '8px 12px',
    minWidth:      '140px',
    fontFamily:    monoFont,
  });
  return el;
}

function renderTooltip(el, bar) {
  if (!bar) { el.style.display = 'none'; return; }

  const { time, value } = bar;
  if (value == null) { el.style.display = 'none'; return; }

  const pct   = Number(value);
  const color = pct >= 0 ? T.green : T.red;
  const sign  = pct >= 0 ? '+' : '';
  const dateLabel = typeof time === 'string' ? time.slice(5) : String(time);

  el.innerHTML = `
    <div style="
      font-size:9px; font-weight:700; letter-spacing:0.14em;
      text-transform:uppercase; color:${T.textLo};
      margin-bottom:6px; border-bottom:1px solid ${T.border}; padding-bottom:5px;
    ">${dateLabel}</div>
    <div style="
      display:flex; justify-content:space-between; align-items:center;
      gap:20px; font-size:11px; letter-spacing:0.05em;
    ">
      <span style="color:${T.textMid}; font-size:9px; font-weight:700; letter-spacing:0.12em;">CHG %</span>
      <span style="color:${color}; font-variant-numeric:tabular-nums; font-weight:700;">
        ${sign}${pct.toFixed(2)}%
      </span>
    </div>
  `;
  el.style.display = 'block';
}

/* ─── Component ─────────────────────────────────────────────────── */
export default function DailyChangeChart({ data, height = 160, title = 'Daily Change %' }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);
  const tooltipRef   = useRef(null);

  /* ── Mount chart once ─────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height,
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
          color:                T.borderHi,
          width:                1,
          style:                LineStyle.Dashed,
          labelVisible:         true,
          labelBackgroundColor: T.elevated,
        },
        horzLine: {
          color:                T.borderHi,
          width:                1,
          style:                LineStyle.Dashed,
          labelVisible:         true,
          labelBackgroundColor: T.elevated,
        },
      },
      rightPriceScale: {
        borderColor:  T.axis,
        borderVisible: true,
        scaleMargins: { top: 0.15, bottom: 0.15 },
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

    // ── Tooltip ──────────────────────────────────────────────────
    const tooltipEl = buildTooltipEl();
    containerRef.current.appendChild(tooltipEl);
    tooltipRef.current = tooltipEl;

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !seriesRef.current) {
        tooltipEl.style.display = 'none';
        return;
      }
      const barData = param.seriesData?.get(seriesRef.current);
      if (!barData) { tooltipEl.style.display = 'none'; return; }

      const timeKey = typeof param.time === 'object'
        ? `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}`
        : String(param.time);

      renderTooltip(tooltipEl, { time: timeKey, value: barData.value });

      const { width: cw } = containerRef.current.getBoundingClientRect();
      const tw   = tooltipEl.offsetWidth || 140;
      const left = param.point.x + 16 + tw > cw
        ? param.point.x - tw - 8
        : param.point.x + 16;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top  = `${Math.max(0, param.point.y - 50)}px`;
    });

    // ── Resize observer ──────────────────────────────────────────
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) chart.applyOptions({ width: e.contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      tooltipEl.remove();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
      tooltipRef.current = null;
    };
  }, [height]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sync data ─────────────────────────────────────────────────── */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data?.length) return;

    // Remove old series
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    // Build histogram data — compute pct_change if not provided
    const histData = data
      .map((r) => {
        let pct = r.pct_change;
        if (pct == null && r.prev_close != null && r.prev_close !== 0) {
          pct = ((r.close - r.prev_close) / r.prev_close) * 100;
        }
        if (pct == null) return null;
        return {
          time:  r.trade_date,
          value: pct,
          color: pct >= 0 ? T.greenDim : T.redDim,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.time < b.time ? -1 : 1));

    if (!histData.length) return;

    const series = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type:      'percent',
        precision: 2,
        minMove:   0.01,
      },
      base: 0,
    });

    series.setData(histData);
    seriesRef.current = series;
    chart.timeScale().fitContent();
  }, [data]);

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, fontFamily: monoFont }}>
      {/* Header strip */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '8px 16px',
        borderBottom:   `1px solid ${T.border}`,
      }}>
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color:         T.textLo,
        }}>
          {title}
        </span>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {[['▲ Positive', T.green], ['▼ Negative', T.red]].map(([label, color]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, background: color, opacity: 0.75 }} />
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
                textTransform: 'uppercase', color: T.textMid,
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart mount point */}
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height }} />
    </div>
  );
}
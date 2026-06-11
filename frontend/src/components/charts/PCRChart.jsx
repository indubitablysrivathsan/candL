// frontend/src/components/charts/PCRChart.jsx
//
// Requires: npm install lightweight-charts  (same dep as CandlestickChart)
//
// Props:
//   analyticsData – array of { trade_date: 'YYYY-MM-DD', pcr: number }

import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode, LineStyle, AreaSeries } from 'lightweight-charts';

/* ─── Design tokens ─────────────────────────────────────────────── */
const T = {
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
    minWidth:      '160px',
    fontFamily:    monoFont,
  });
  return el;
}

function renderTooltip(el, timeKey, pcr) {
  if (pcr == null) { el.style.display = 'none'; return; }

  const color = pcr > 1.2 ? T.green : pcr < 0.8 ? T.red : T.amber;
  const sentiment = pcr > 1.2 ? 'BULLISH' : pcr < 0.8 ? 'BEARISH' : 'NEUTRAL';

  el.innerHTML = `
    <div style="
      font-size:9px; font-weight:700; letter-spacing:0.14em;
      text-transform:uppercase; color:${T.textLo};
      margin-bottom:8px; border-bottom:1px solid ${T.border}; padding-bottom:6px;
    ">${timeKey}</div>
    <div style="
      display:flex; justify-content:space-between; align-items:center;
      gap:20px; font-size:11px; letter-spacing:0.05em; margin-bottom:4px;
    ">
      <span style="color:${T.textMid}; font-size:9px; font-weight:700; letter-spacing:0.12em;">PCR</span>
      <span style="color:${T.textHi}; font-variant-numeric:tabular-nums; font-weight:600;">
        ${pcr.toFixed(3)}
      </span>
    </div>
    <div style="
      margin-top:6px; padding-top:6px; border-top:1px solid ${T.border};
      font-size:9px; font-weight:700; letter-spacing:0.12em;
      text-align:right; color:${color};
    ">${sentiment}</div>
  `;
  el.style.display = 'block';
}

/* ─── Component ─────────────────────────────────────────────────── */
export default function PCRChart({ analyticsData = [] }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);
  const tooltipRef   = useRef(null);
  const dataMapRef   = useRef({});

  /* ── Mount: create chart once ───────────────────────────────────── */
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
        scaleMargins:  { top: 0.12, bottom: 0.12 },
        minimumWidth:  52,
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

    // PCR = 1.0 reference line
    chart.addSeries(AreaSeries, {
      // invisible placeholder just to host the price line
      lineColor:   'transparent',
      topColor:    'transparent',
      bottomColor: 'transparent',
    });

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

      const row = dataMapRef.current[timeKey];
      if (!row) { tooltipEl.style.display = 'none'; return; }

      const pcrVal = seriesRef.current
        ? param.seriesData?.get(seriesRef.current)?.value
        : null;

      renderTooltip(tooltipEl, timeKey, pcrVal ?? row.pcr);

      const { width: cw } = containerRef.current.getBoundingClientRect();
      const tw   = tooltipEl.offsetWidth || 160;
      const left = param.point.x + 16 + tw > cw
        ? param.point.x - tw - 8
        : param.point.x + 16;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top  = `${Math.max(0, param.point.y - 50)}px`;
    });

    // Resize observer
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
      seriesRef.current = null;
      tooltipRef.current = null;
    };
  }, []);

  /* ── Data sync ───────────────────────────────────────────────────── */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !analyticsData?.length) return;

    // Build lookup map
    const map = {};
    analyticsData.forEach((r) => { map[r.trade_date] = r; });
    dataMapRef.current = map;

    const seriesData = analyticsData
      .filter((r) => r.pcr != null)
      .map((r) => ({ time: r.trade_date, value: r.pcr }))
      .sort((a, b) => (a.time < b.time ? -1 : 1));

    // Remove old series
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (!seriesData.length) return;

    const series = chart.addSeries(AreaSeries, {
      lineColor:        T.amber,
      lineWidth:        2,
      topColor:         `${T.amber}4D`,   // 30% opacity
      bottomColor:      `${T.amber}03`,   // ~1% opacity
      crosshairMarkerVisible: true,
      crosshairMarkerRadius:  3,
      crosshairMarkerBorderColor: T.surface,
      crosshairMarkerBackgroundColor: T.amber,
      priceFormat: {
        type:      'price',
        precision: 3,
        minMove:   0.001,
      },
    });

    series.setData(seriesData);

    // PCR = 1.0 reference line
    series.createPriceLine({
      price:              1.0,
      color:              'rgba(255,255,255,0.20)',
      lineWidth:          1,
      lineStyle:          LineStyle.Dashed,
      axisLabelVisible:   true,
      title:              'PCR 1.0',
    });

    // PCR = 1.2 (bullish threshold)
    series.createPriceLine({
      price:              1.2,
      color:              `${T.green}40`,
      lineWidth:          1,
      lineStyle:          LineStyle.Dotted,
      axisLabelVisible:   false,
      title:              '',
    });

    // PCR = 0.8 (bearish threshold)
    series.createPriceLine({
      price:              0.8,
      color:              `${T.red}40`,
      lineWidth:          1,
      lineStyle:          LineStyle.Dotted,
      axisLabelVisible:   false,
      title:              '',
    });

    seriesRef.current = series;
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
            Put-Call Ratio
          </span>
          <span style={{
            fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase',
            color: T.textLo, marginLeft: 12,
          }}>
            PCR trend across expiry lifecycle
          </span>
        </div>

        {/* Zone legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {[
            ['>1.2',    T.green, 'Bullish'],
            ['0.8–1.2', T.amber, 'Neutral'],
            ['<0.8',    T.red,   'Bearish'],
          ].map(([range, color]) => (
            <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, background: color, flexShrink: 0 }} />
              <span style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '0.10em',
                textTransform: 'uppercase', color: T.textMid,
              }}>
                {range}
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
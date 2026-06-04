// frontend/src/components/charts/StrikeBarChart.jsx

import { useMemo } from 'react';

import {
  ResponsiveContainer,
  BarChart,
  Customized,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  Rectangle,
  ReferenceLine,
} from 'recharts';

import {
  getMetricFields,
  getMetricColors,
  getMetricLabel,
  formatNumber,
} from '../../api/client';

/* ─── Tooltip ─────────────────────────────────────────────────── */

function CustomTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-card border border-white/10 rounded-xl px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white mb-2">
        Strike: {formatNumber(label)}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="text-white">{formatNumber(entry.value)}</span>
        </div>
      ))}
      <p className="mt-3 text-[11px] text-white/45">{getMetricLabel(metric)}</p>
    </div>
  );
}

/* ─── Animated bar shape ──────────────────────────────────────────
   Recharts calls this with the SVG coordinate system where y=0 is
   the TOP of the chart area.  A bar starting at the baseline has:
     y      = baseline_px - height_px   (top-left corner in SVG space)
     height = pixel height of the bar

   We CSS-transition `height` and `y` together so the bar foot stays
   anchored at the baseline and the bar only moves vertically.
   SVG attribute transitions work in all modern browsers.
────────────────────────────────────────────────────────────────── */

function AnimatedBar(props) {
  let { x, y, width, height, fill } = props;

  if (!width || !height || isNaN(y) || isNaN(height)) {
    return null;
  }

  const isNegative = height < 0;

  if (isNegative) {
    y += height;
    height = Math.abs(height);
  }

  return (
    <Rectangle
      {...props}
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      radius={
        isNegative
          ? [0, 0, 4, 4] // round bottom
          : [4, 4, 0, 0] // round top
      }
    />
  );
}

/* ─── Horizontal Candle ───────────────────────────────────────────
   Rendered as a custom SVG overlay inside the chart's top margin.
   The chart has margin.top = 20, so we draw inside that 20px band.
   x/width come from the XAxis scale, so it's perfectly aligned.
────────────────────────────────────────────────────────────────── */

function HorizontalCandle({ ohlcData, xScale, chartWidth, chartLeft }) {
  if (!ohlcData || !xScale) return null;

  const { open, high, low, close, prevClose } = ohlcData;
  if ([open, high, low, close].some((v) => v == null || isNaN(v))) return null;

  const { x_min, x_max, strike_gap } = xScale;
  const domainMin = x_min - strike_gap;
  const domainMax = x_max + strike_gap;
  const domainRange = domainMax - domainMin;

  // Map a price value → pixel x inside the chart plot area
  const toX = (val) => chartLeft + ((val - domainMin) / domainRange) * chartWidth;

  const xOpen  = toX(open);
  const xClose = toX(close);
  const xHigh  = toX(high);
  const xLow   = toX(low);

  const isBullish =
    ohlcData.prevClose != null
      ? close > ohlcData.prevClose
      : close >= open; // fallback
  const bodyLeft   = Math.min(xOpen, xClose);
  const bodyWidth  = Math.max(Math.abs(xClose - xOpen), 2);
  const isHollow = close >= open;

  // Candle sits in the top margin band (0–20px). Centre it at y=10.
  const cy        = 10;
  const bodyH     = 16;
  const bodyTop   = cy - bodyH / 2;
  const wickColor = isBullish ? '#26a69a' : '#ef5350';

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Wick: low → high */}
      <line
        x1={xLow}  y1={cy}
        x2={xHigh} y2={cy}
        stroke={wickColor}
        strokeWidth={1.5}
      />
      {/* Body */}
      <rect
        x={bodyLeft}
        y={bodyTop}
        width={bodyWidth}
        height={bodyH}
        fill={isHollow ? 'none' : wickColor}
        stroke={wickColor}
        strokeWidth={1.5}
        rx={1}
      />
    </g>
  );
}

/* ─── Main chart ──────────────────────────────────────────────── */

export default function StrikeBarChart({
  snapshotData,
  metric  = 'oi',
  yDomain = null,
  xScale  = null,  // { x_min, x_max, strike_gap }
  ohlcData = null,
}) {
  const fields = getMetricFields(metric);
  const colors = getMetricColors(metric);

  /* ── Full stable tick array (only depends on xScale) ──────────
     Build every possible strike slot across the whole expiry range
     so this array NEVER changes when you slide between dates.
  ────────────────────────────────────────────────────────────── */
  const stableTicks = useMemo(() => {
    if (!xScale) return [];
    const { x_min, x_max, strike_gap } = xScale;
    const ticks = [];
    for (let s = x_min; s <= x_max + 0.001; s += strike_gap) {
      ticks.push(Math.round(s));
    }
    return ticks;
    // chartData intentionally excluded — only the scale window matters
  }, [xScale]);

  /* ── Padded chart data ─────────────────────────────────────────
     The core fix for bar shifting:

     Recharts `BarChart` with type="number" XAxis positions each bar
     at its `strike` value on the linear scale.  When a snapshot is
     missing some strikes (common on early/late dates), Recharts sees
     fewer data points and recalculates bar widths, which shifts every
     bar slightly.

     Solution: always emit a row for EVERY slot in stableTicks, using
     0 for strikes absent in the snapshot.  Bar count and positions
     are then identical across all dates → zero horizontal movement.
  ────────────────────────────────────────────────────────────── */
  const chartData = useMemo(() => {
    const snapshotMap = new Map(
      (snapshotData?.strikes || []).map((row) => [
        Math.round(Number(row.strike)),
        row,
      ])
    );

    const slots = stableTicks.length
      ? stableTicks
      : [...snapshotMap.keys()].sort((a, b) => a - b);

    return slots.map((strike) => {
      const row = snapshotMap.get(strike);
      return {
        strike,
        ce: row ? Number(row[fields.ce] || 0) : 0,
        pe: row ? Number(row[fields.pe] || 0) : 0,
      };
    });
  }, [snapshotData, stableTicks, fields]);

  const visibleTickInterval = Math.max(1, Math.ceil(stableTicks.length / 15));

  const xDomain = xScale
    ? [xScale.x_min - xScale.strike_gap, xScale.x_max + xScale.strike_gap]
    : ['dataMin', 'dataMax'];

  /* ── Reference lines ────────────────────────────────────────── */
  const u = snapshotData?.underlying != null ? Number(snapshotData.underlying) : null;
  const m = snapshotData?.max_pain    != null ? Number(snapshotData.max_pain)   : null;

  const uPos = (u != null && m != null) ? (u <= m ? 'insideTopRight' : 'insideTopLeft') : 'insideTopLeft';
  const mPos = (u != null && m != null) ? (m <= u ? 'insideTopRight' : 'insideTopLeft') : 'insideTopLeft';

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Strike Distribution</h3>
          <p className="text-sm text-white/45">CE vs PE {getMetricLabel(metric)}</p>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: colors.pe }} />
            <span className="text-white/70">PE</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: colors.ce }} />
            <span className="text-white/70">CE</span>
          </div>
        </div>
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 20, left: 0, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />

            <XAxis
              dataKey="strike"
              type="number"
              scale="linear"
              domain={xDomain}
              ticks={stableTicks}
              tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              interval={visibleTickInterval - 1}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            />

            <YAxis
              allowDecimals={false}
              domain={yDomain ?? ['auto', 'auto']}
              tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              tickFormatter={(value) => formatNumber(value)}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            />

            <Tooltip content={<CustomTooltip metric={metric} />} />

            {u != null && (
              <ReferenceLine
                x={u}
                stroke="#FFD700"
                strokeWidth={2}
                strokeDasharray="6 6"
                label={{ value: `Underlying ${u.toFixed(2)}`, fill: '#FFD700', fontSize: 11, position: uPos }}
              />
            )}
            {m != null && (
              <ReferenceLine
                x={m}
                stroke="#FF69B4"
                strokeWidth={2}
                strokeDasharray="2 6"
                label={{ value: `Max Pain ${m.toFixed(2)}`, fill: '#FF69B4', fontSize: 11, position: mPos }}
              />
            )}

            <Bar
              dataKey="pe"
              name="PE"
              fill={colors.pe}
              shape={<AnimatedBar radius={[4, 4, 0, 0]} fill={colors.pe} />}
              isAnimationActive={false}
            />
            <Bar
              dataKey="ce"
              name="CE"
              fill={colors.ce}
              shape={<AnimatedBar radius={[4, 4, 0, 0]} fill={colors.ce} />}
              isAnimationActive={false}
            />
            <Customized
              component={({ xAxisMap, offset }) => {
                const axis = xAxisMap?.[0];
                if (!axis) return null;
                return (
                  <HorizontalCandle
                    ohlcData={ohlcData}
                    xScale={xScale}
                    chartWidth={offset?.width ?? 0}
                    chartLeft={offset?.left ?? 0}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
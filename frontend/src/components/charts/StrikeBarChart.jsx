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

/* ─── design tokens (mirror Options.jsx) ─────────────────────── */
const T = {
  bg:       '#06080c',
  surface:  '#0b0f16',
  border:   'rgba(255,255,255,0.07)',
  amber:    '#F0A500',
  pink:     '#D66E9A',
  textHi:   'rgba(255,255,255,0.90)',
  textMid:  'rgba(255,255,255,0.50)',
  textLo:   'rgba(255,255,255,0.25)',
  grid:     'rgba(255,255,255,0.05)',
  axis:     'rgba(255,255,255,0.10)',
};

/* ─── Tooltip ─────────────────────────────────────────────────── */
function CustomTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: '#0b0f16',
      border: `1px solid rgba(255,255,255,0.14)`,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      minWidth: 160,
    }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: T.textLo,
        marginBottom: 8,
      }}>
        Strike {formatNumber(label)}
      </div>
      {payload.map((entry) => (
        <div
          key={entry.name}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 20,
            fontSize: 11,
            letterSpacing: '0.05em',
            marginBottom: 4,
          }}
        >
          <span style={{ color: entry.color, fontWeight: 600, textTransform: 'uppercase' }}>
            {entry.name}
          </span>
          <span style={{ color: T.textHi, fontVariantNumeric: 'tabular-nums' }}>
            {formatNumber(entry.value)}
          </span>
        </div>
      ))}
      <div style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: `1px solid ${T.border}`,
        fontSize: 9,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        color: T.textLo,
      }}>
        {getMetricLabel(metric)}
      </div>
    </div>
  );
}

/* ─── Animated bar shape ─────────────────────────────────────── */
function AnimatedBar(props) {
  let { x, y, width, height, fill } = props;

  if (!width || !height || isNaN(y) || isNaN(height)) return null;

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
      radius={isNegative ? [0, 0, 2, 2] : [2, 2, 0, 0]}
    />
  );
}

/* ─── Horizontal Candle ──────────────────────────────────────── */
function HorizontalCandle({ ohlcData, xScale, chartWidth, chartLeft }) {
  if (!ohlcData || !xScale) return null;

  const { open, high, low, close, prevClose } = ohlcData;
  if ([open, high, low, close].some((v) => v == null || isNaN(v))) return null;

  const { x_min, x_max, strike_gap } = xScale;
  const domainMin   = x_min - strike_gap;
  const domainMax   = x_max + strike_gap;
  const domainRange = domainMax - domainMin;

  const toX = (val) => chartLeft + ((val - domainMin) / domainRange) * chartWidth;

  const xOpen  = toX(open);
  const xClose = toX(close);
  const xHigh  = toX(high);
  const xLow   = toX(low);

  const isBullish   = prevClose != null ? close > prevClose : close >= open;
  const bodyLeft    = Math.min(xOpen, xClose);
  const bodyWidth   = Math.max(Math.abs(xClose - xOpen), 2);
  const isHollow    = close >= open;
  const cy          = 10;
  const bodyH       = 14;
  const bodyTop     = cy - bodyH / 2;
  const wickColor   = isBullish ? '#26a69a' : '#ef5350';

  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={xLow} y1={cy} x2={xHigh} y2={cy} stroke={wickColor} strokeWidth={1.5} />
      <rect
        x={bodyLeft}
        y={bodyTop}
        width={bodyWidth}
        height={bodyH}
        fill={isHollow ? 'none' : wickColor}
        stroke={wickColor}
        strokeWidth={1.5}
      />
    </g>
  );
}

/* ─── Main chart ─────────────────────────────────────────────── */
export default function StrikeBarChart({
  snapshotData,
  metric   = 'oi',
  yDomain  = null,
  xScale   = null,
  ohlcData = null,
}) {
  const fields = getMetricFields(metric);
  const colors = getMetricColors(metric);

  const stableTicks = useMemo(() => {
    if (!xScale) return [];
    const { x_min, x_max, strike_gap } = xScale;
    const ticks = [];
    for (let s = x_min; s <= x_max + 0.001; s += strike_gap) {
      ticks.push(Math.round(s));
    }
    return ticks;
  }, [xScale]);

  const chartData = useMemo(() => {
    const snapshotMap = new Map(
      (snapshotData?.strikes || []).map((row) => [Math.round(Number(row.strike)), row])
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

  // oi and vol are always non-negative — anchor the baseline at 0.
  // oi_chng can go negative so we leave it to auto / the passed domain.
  const allowNegative = metric === 'oi_chng';
  const effectiveYDomain = yDomain
    ? (allowNegative ? yDomain : [0, yDomain[1]])
    : (allowNegative ? ['auto', 'auto'] : [0, 'auto']);

  const xDomain = xScale
    ? [xScale.x_min - xScale.strike_gap, xScale.x_max + xScale.strike_gap]
    : ['dataMin', 'dataMax'];

  const u = snapshotData?.underlying != null ? Number(snapshotData.underlying) : null;
  const m = snapshotData?.max_pain    != null ? Number(snapshotData.max_pain)   : null;

  const uPos = (u != null && m != null)
    ? (u <= m ? 'insideTopRight' : 'insideTopLeft')
    : 'insideTopLeft';
  const mPos = (u != null && m != null)
    ? (m <= u ? 'insideTopRight' : 'insideTopLeft')
    : 'insideTopLeft';

  const tickStyle = {
    fill: T.textMid,
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace",
    letterSpacing: '0.03em',
  };

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      padding: '0',
    }}>
      {/* header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: T.textHi,
          }}>
            Strike Distribution
          </span>
          <span style={{
            fontSize: 9,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: T.textLo,
            marginLeft: 12,
          }}>
            CE vs PE · {getMetricLabel(metric)}
          </span>
        </div>

        {/* legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {[['PE', colors.pe], ['CE', colors.ce]].map(([name, color]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 10,
                height: 10,
                background: color,
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: T.textMid,
              }}>
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* chart */}
      <div style={{ width: '100%', height: 360, padding: '8px 0 0' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 20, left: 0, bottom: 20 }}
          >
            <CartesianGrid
              strokeDasharray="2 4"
              stroke={T.grid}
              vertical={false}
            />

            <XAxis
              dataKey="strike"
              type="number"
              scale="linear"
              domain={xDomain}
              ticks={stableTicks}
              tick={tickStyle}
              interval={visibleTickInterval - 1}
              tickLine={false}
              axisLine={{ stroke: T.axis }}
            />

            <YAxis
              allowDecimals={false}
              domain={effectiveYDomain}
              tick={tickStyle}
              tickFormatter={(v) => formatNumber(v)}
              tickLine={false}
              axisLine={false}
              width={72}
            />

            <Tooltip
              content={<CustomTooltip metric={metric} />}
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            />

            {u != null && (
              <ReferenceLine
                x={u}
                stroke={T.amber}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                label={{
                  value: `↑ ${u.toFixed(2)}`,
                  fill: T.amber,
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                  letterSpacing: '0.04em',
                  position: uPos,
                }}
              />
            )}
            {m != null && (
              <ReferenceLine
                x={m}
                stroke={T.pink}
                strokeWidth={1.5}
                strokeDasharray="2 5"
                label={{
                  value: `⊕ ${m.toFixed(2)}`,
                  fill: T.pink,
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                  letterSpacing: '0.04em',
                  position: mPos,
                }}
              />
            )}

            <Bar
              dataKey="pe"
              name="PE"
              fill={colors.pe}
              shape={<AnimatedBar fill={colors.pe} />}
              isAnimationActive={false}
            />
            <Bar
              dataKey="ce"
              name="CE"
              fill={colors.ce}
              shape={<AnimatedBar fill={colors.ce} />}
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
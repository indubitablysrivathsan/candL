// frontend/src/components/charts/CandlestickChart.jsx

import { useRef } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Line,
  Bar,
} from 'recharts';

/* ─── design tokens ───────────────────────────────────────────── */
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
  grid:     'rgba(255,255,255,0.08)',
  axis:     'rgba(255,255,255,0.12)',
};

const monoFont = "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace";

const tickStyle = {
  fill: T.textMid,
  fontSize: 10,
  fontFamily: monoFont,
  letterSpacing: '0.03em',
};

const fmt = (n, dec = 2) =>
  n == null
    ? '—'
    : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec });

/* ─── Tooltip ─────────────────────────────────────────────────── */
function PriceTooltip({ active, payload, label, showCandles, showAvg, formatCurrency }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const fields = [
    showCandles && row.open  != null && { label: 'OPEN',  value: formatCurrency(row.open,  2), color: T.textMid },
    showCandles && row.high  != null && { label: 'HIGH',  value: formatCurrency(row.high,  2), color: T.green   },
    showCandles && row.low   != null && { label: 'LOW',   value: formatCurrency(row.low,   2), color: T.red     },
    showCandles && row.close != null && { label: 'CLOSE', value: formatCurrency(row.close, 2), color: T.textHi  },
    showAvg && row.avg_price != null && { label: 'AVG',   value: formatCurrency(row.avg_price, 2), color: T.amber },
  ].filter(Boolean);

  const change = row.prev_close != null && row.close != null
    ? ((row.close - row.prev_close) / row.prev_close * 100).toFixed(2)
    : null;

  return (
    <div style={{
      background: T.elevated,
      border: `1px solid ${T.borderHi}`,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
      minWidth: 180,
      fontFamily: monoFont,
    }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: T.textLo,
        marginBottom: 8,
        borderBottom: `1px solid ${T.border}`,
        paddingBottom: 6,
      }}>
        {label}
      </div>

      {fields.map(({ label: name, value, color }) => (
        <div key={name} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          fontSize: 11,
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}>
          <span style={{ color: T.textMid, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em' }}>
            {name}
          </span>
          <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {value}
          </span>
        </div>
      ))}

      {change != null && (
        <div style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${T.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 9,
          letterSpacing: '0.10em',
        }}>
          <span style={{ color: T.textLo, fontWeight: 700 }}>CHG</span>
          <span style={{ color: parseFloat(change) >= 0 ? T.green : T.red, fontWeight: 700 }}>
            {parseFloat(change) >= 0 ? '+' : ''}{change}%
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Chart ───────────────────────────────────────────────────── */
export default function CandlestickChart({ data, showCandles, showAvg, formatCurrency }) {
  // useRef so the map survives React StrictMode's double-invocation of render
  // without being reset between CloseShape and LowShape calls
  const pixelMapRef = useRef({});
  const pixelMap = pixelMapRef.current;

  const CloseShape = (props) => {
    const { x, y, index, payload } = props;

    if (x == null || isNaN(x) || y == null || isNaN(y)) return null;

    if (!pixelMap[index]) pixelMap[index] = {};
    pixelMap[index].closeY   = y;
    pixelMap[index].closeVal = payload?.close;
    pixelMap[index].x        = x;

    // Store prev index's x so we can compute slot width from the gap
    if (index > 0 && pixelMap[index - 1]?.x != null) {
      const slotWidth = x - pixelMap[index - 1].x;
      pixelMap[index].slotWidth     = slotWidth;
      pixelMap[index - 1].slotWidth = slotWidth; // back-fill prev
    }

    return null;
  };

  const LowShape = (props) => {
    if (!showCandles) return null;
    const { x, y, index, payload } = props;

    if (x == null || isNaN(x) || y == null || isNaN(y)) return null;

    if (!pixelMap[index]) pixelMap[index] = {};
    pixelMap[index].lowY  = y;
    pixelMap[index].lowVal = payload?.low;

    const pm = pixelMap[index];

    if (
      pm.closeY    == null || isNaN(pm.closeY) ||
      pm.lowY      == null || isNaN(pm.lowY)   ||
      pm.closeVal  == null ||
      pm.lowVal    == null ||
      pm.x         == null ||
      pm.slotWidth == null
    ) return null;

    const { open, high, low, close, prev_close } = payload;
    if ([open, high, low, close].some((v) => v == null || isNaN(v))) return null;

    const priceDelta = low - close;
    if (priceDelta === 0) return null;
    const pxPerUnit = (pm.lowY - pm.closeY) / priceDelta;
    const scaleY    = (val) => pm.closeY + (val - close) * pxPerUnit;

    const isBullish = prev_close != null ? close > prev_close : close >= open;
    const isHollow  = close >= open;
    const color     = isBullish ? T.green : T.red;

    // x is the left edge of the barSize=8 bar.
    // The slot is slotWidth wide and the bar is centred in it by Recharts,
    // so the true slot left edge = x - (slotWidth - 8) / 2
    // and the tick centre = slot left + slotWidth / 2 = x + 4 - (slotWidth/2 - 4) ... simplifies to:
    const BAR_SIZE = 8;
    const cx = pm.x + BAR_SIZE / 2 + (pm.slotWidth - BAR_SIZE) / 2;

    const yOpen  = scaleY(open);
    const yClose = scaleY(close);
    const yHigh  = scaleY(high);
    const yLow   = scaleY(low);

    // Sanity-check all derived pixels
    if ([yOpen, yClose, yHigh, yLow, cx].some(isNaN)) return null;

    const bodyTop    = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1);
    const bodyWidth  = Math.max(pm.slotWidth * 0.5, 4);
    const bodyX      = cx - bodyWidth / 2;

    return (
      <g>
        {/* Upper wick */}
        <line x1={cx} y1={yHigh} x2={cx} y2={bodyTop} stroke={color} strokeWidth={1.5} />
        {/* Lower wick */}
        <line x1={cx} y1={bodyTop + bodyHeight} x2={cx} y2={yLow} stroke={color} strokeWidth={1.5} />
        {/* Body */}
        <rect
          x={bodyX}
          y={bodyTop}
          width={bodyWidth}
          height={bodyHeight}
          fill={isHollow ? 'transparent' : color}
          stroke={color}
          strokeWidth={1.5}
        />
      </g>
    );
  };

  const TooltipContent = (props) => (
    <PriceTooltip
      {...props}
      showCandles={showCandles}
      showAvg={showAvg}
      formatCurrency={formatCurrency}
    />
  );

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      fontFamily: monoFont,
    }}>
      {/* ── Header strip ─────────────────────────────────────────── */}
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
            Price Action
          </span>
          <span style={{
            fontSize: 9,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: T.textLo,
            marginLeft: 12,
          }}>
            OHLC Candlestick
          </span>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {showCandles && [['BULL', T.green], ['BEAR', T.red]].map(([name, color]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 12, background: color }} />
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
          {showAvg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <svg width="20" height="10">
                <line x1="0" y1="5" x2="20" y2="5" stroke={T.amber} strokeWidth="1.5" strokeDasharray="4 3" />
              </svg>
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: T.textMid,
              }}>
                AVG
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Chart area ───────────────────────────────────────────── */}
      <div style={{ width: '100%', height: 600, padding: '8px 0 0' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 16, right: 20, bottom: 20, left: 0 }}
            barGap={0}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.12)"
            />

            <XAxis
              dataKey="trade_date"
              tick={tickStyle}
              tickFormatter={(d) => d.slice(5)}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={{ stroke: T.axis }}
            />

            <YAxis
              domain={['auto', 'auto']}
              tick={tickStyle}
              tickFormatter={(v) => `₹${fmt(v, 0)}`}
              width={76}
              tickLine={false}
              axisLine={false}
            />

            <Tooltip
              content={<TooltipContent />}
              cursor={{ stroke: T.borderHi, strokeWidth: 1, strokeDasharray: '3 3' }}
            />

            {showAvg && (
              <Line
                dataKey="avg_price"
                name="Avg"
                stroke={T.amber}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                isAnimationActive={false}
              />
            )}

            {/*
              Two bars with identical barSize force Recharts to give them the
              same x/width slot. barGap=0 removes the inter-bar gap so they
              perfectly overlap → cx = x + width/2 is exact tick centre.
            */}
            <Bar
              dataKey="close"
              barSize={8}
              shape={<CloseShape />}
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
            />

            <Bar
              dataKey="low"
              barSize={8}
              shape={<LowShape />}
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
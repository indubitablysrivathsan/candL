// frontend/src/components/charts/PCRChart.jsx

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';

/* ─── design tokens ──────────────────────────────────────────── */
const T = {
  surface:  '#0b0f16',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.14)',
  amber:    '#F0A500',
  green:    '#00C896',
  red:      '#E05252',
  textHi:   'rgba(255,255,255,0.90)',
  textMid:  'rgba(255,255,255,0.50)',
  textLo:   'rgba(255,255,255,0.25)',
  grid:     'rgba(255,255,255,0.05)',
  axis:     'rgba(255,255,255,0.10)',
};

const monoFont = "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace";
const tickStyle = {
  fill: T.textMid,
  fontSize: 10,
  fontFamily: monoFont,
  letterSpacing: '0.03em',
};

/* ─── Tooltip ─────────────────────────────────────────────────── */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  const pcr   = Number(value || 0);
  const color = pcr > 1.2 ? T.green : pcr < 0.8 ? T.red : T.amber;

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.borderHi}`,
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
        {label}
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 20,
        fontSize: 11,
        letterSpacing: '0.05em',
      }}>
        <span style={{ color, fontWeight: 600, textTransform: 'uppercase' }}>PCR</span>
        <span style={{ color: T.textHi, fontVariantNumeric: 'tabular-nums' }}>
          {pcr.toFixed(3)}
        </span>
      </div>
    </div>
  );
}

/* ─── Main chart ─────────────────────────────────────────────── */
export default function PCRChart({ analyticsData = [] }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}` }}>

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
            Put-Call Ratio
          </span>
          <span style={{
            fontSize: 9,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: T.textLo,
            marginLeft: 12,
          }}>
            PCR trend across expiry lifecycle
          </span>
        </div>

        {/* PCR zone legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {[
            ['>1.2', T.green,  'Bullish'],
            ['0.8–1.2', T.amber, 'Neutral'],
            ['<0.8', T.red,   'Bearish'],
          ].map(([range, color, label]) => (
            <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, background: color, flexShrink: 0 }} />
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: T.textMid,
              }}>
                {range}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* chart */}
      <div style={{ width: '100%', height: 360, padding: '8px 0 0' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={analyticsData}
            margin={{ top: 16, right: 20, left: 0, bottom: 20 }}
          >
            <defs>
              <linearGradient id="pcrGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={T.amber} stopOpacity={0.30} />
                <stop offset="100%" stopColor={T.amber} stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="2 4"
              stroke={T.grid}
              vertical={false}
            />

            <XAxis
              dataKey="trade_date"
              tick={tickStyle}
              tickLine={false}
              axisLine={{ stroke: T.axis }}
            />

            <YAxis
              tick={tickStyle}
              tickFormatter={(v) => Number(v).toFixed(2)}
              tickLine={false}
              axisLine={false}
              width={48}
            />

            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: T.borderHi, strokeWidth: 1, strokeDasharray: '3 3' }}
            />

            {/* PCR = 1 baseline */}
            <ReferenceLine
              y={1.0}
              stroke="rgba(255,255,255,0.20)"
              strokeDasharray="4 4"
              label={{
                value: 'PCR 1.0',
                fill: T.textLo,
                fontSize: 9,
                fontFamily: monoFont,
                letterSpacing: '0.08em',
                position: 'insideBottomRight',
              }}
            />

            <Area
              type="monotone"
              dataKey="pcr"
              stroke={T.amber}
              strokeWidth={2}
              fill="url(#pcrGradient)"
              dot={false}
              activeDot={{ r: 3, fill: T.amber, stroke: T.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
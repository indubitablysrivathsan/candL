// frontend/src/components/charts/TimeSeriesChart.jsx

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Area,
} from 'recharts';

import { formatCurrency } from '../../api/client';

/* ─── design tokens ──────────────────────────────────────────── */
const T = {
  surface:  '#0b0f16',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.14)',
  green:    '#26a69a',
  pink:     '#D66E9A',
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

  const underlying = payload.find((p) => p.dataKey === 'underlying');
  const maxPain    = payload.find((p) => p.dataKey === 'max_pain');

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.borderHi}`,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      minWidth: 180,
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
      {[
        { label: 'Underlying', value: underlying?.value, color: T.green },
        { label: 'Max Pain',   value: maxPain?.value,    color: T.pink  },
      ].map(({ label: name, value, color }) => (
        <div key={name} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          fontSize: 11,
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}>
          <span style={{ color, fontWeight: 600, textTransform: 'uppercase' }}>{name}</span>
          <span style={{ color: T.textHi, fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(value, 2)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Main chart ─────────────────────────────────────────────── */
export default function TimeSeriesChart({ analyticsData = [] }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
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
            Underlying vs Max Pain
          </span>
          <span style={{
            fontSize: 9,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: T.textLo,
            marginLeft: 12,
          }}>
            Price across expiry lifecycle
          </span>
        </div>

        {/* legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {[['Underlying', T.green, false], ['Max Pain', T.pink, true]].map(([name, color, dashed]) => (
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
          <LineChart
            data={analyticsData}
            margin={{ top: 16, right: 20, left: 0, bottom: 20 }}
          >
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
              tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`}
              tickLine={false}
              axisLine={false}
              width={80}
            />

            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: T.borderHi, strokeWidth: 1, strokeDasharray: '3 3' }}
            />

            {/* soft fill under underlying line */}
            <Area
              type="monotone"
              dataKey="underlying"
              stroke="none"
              fill={T.green}
              fillOpacity={0.06}
            />

            <Line
              type="monotone"
              dataKey="underlying"
              stroke={T.green}
              strokeWidth={2}
              dot={false}
              name="Underlying"
              isAnimationActive={false}
            />

            <Line
              type="monotone"
              dataKey="max_pain"
              stroke={T.pink}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              name="Max Pain"
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
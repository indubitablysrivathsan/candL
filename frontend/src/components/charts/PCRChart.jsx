// frontend/src/components/charts/PCRChart.jsx

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine
} from 'recharts';

function CustomTooltip({
  active,
  payload,
  label
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const value = payload[0]?.value;

  return (
    <div
      className="
        bg-card
        border
        border-white/10
        rounded-xl
        px-4
        py-3
      "
    >
      <p className="text-sm font-semibold text-white mb-2">
        {label}
      </p>

      <div className="flex items-center justify-between gap-5 text-sm">
        <span style={{ color: '#FFA726' }}>
          PCR
        </span>

        <span className="text-white">
          {Number(value || 0).toFixed(3)}
        </span>
      </div>
    </div>
  );
}

export default function PCRChart({
  analyticsData = []
}) {
  return (
    <div className="card p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">
          Put-Call Ratio (PCR)
        </h3>

        <p className="text-sm text-white/45">
          PCR trend over expiry lifecycle
        </p>
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={analyticsData}
            margin={{
              top: 20,
              right: 20,
              left: 0,
              bottom: 20
            }}
          >
            <defs>
              <linearGradient
                id="pcrGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="#FFA726"
                  stopOpacity={0.45}
                />

                <stop
                  offset="100%"
                  stopColor="#FFA726"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
            />

            <XAxis
              dataKey="trade_date"
              tick={{
                fill: 'rgba(255,255,255,0.7)',
                fontSize: 11
              }}
              tickLine={false}
              axisLine={{
                stroke: 'rgba(255,255,255,0.1)'
              }}
            />

            <YAxis
              tick={{
                fill: 'rgba(255,255,255,0.7)',
                fontSize: 11
              }}
              tickFormatter={(v) =>
                Number(v).toFixed(2)
              }
              tickLine={false}
              axisLine={{
                stroke: 'rgba(255,255,255,0.1)'
              }}
            />

            <Tooltip content={<CustomTooltip />} />

            <ReferenceLine
              y={1.0}
              stroke="#ffffff"
              strokeDasharray="5 5"
              strokeOpacity={0.45}
              label={{
                value: 'PCR = 1',
                fill: 'rgba(255,255,255,0.7)',
                fontSize: 11,
                position: 'right'
              }}
            />

            <Area
              type="monotone"
              dataKey="pcr"
              stroke="#FFA726"
              strokeWidth={3}
              fill="url(#pcrGradient)"
              dot={false}
              activeDot={{
                r: 5
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
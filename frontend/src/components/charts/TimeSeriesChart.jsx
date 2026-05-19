// frontend/src/components/charts/TimeSeriesChart.jsx

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area
} from 'recharts';

import {
  formatCurrency
} from '../../api/client';

function CustomTooltip({
  active,
  payload,
  label
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const underlying = payload.find(
    (p) => p.dataKey === 'underlying'
  );

  const maxPain = payload.find(
    (p) => p.dataKey === 'max_pain'
  );

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
      <p className="text-sm font-semibold text-white mb-3">
        {label}
      </p>

      <div className="space-y-2">
        <div className="flex justify-between gap-5 text-sm">
          <span style={{ color: '#26a69a' }}>
            Underlying
          </span>

          <span className="text-white">
            {formatCurrency(
              underlying?.value,
              2
            )}
          </span>
        </div>

        <div className="flex justify-between gap-5 text-sm">
          <span style={{ color: '#FF69B4' }}>
            Max Pain
          </span>

          <span className="text-white">
            {formatCurrency(
              maxPain?.value,
              2
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TimeSeriesChart({
  analyticsData = []
}) {
  return (
    <div className="card p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">
          Underlying vs Max Pain
        </h3>

        <p className="text-sm text-white/45">
          Price movement across expiry lifecycle
        </p>
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={analyticsData}
            margin={{
              top: 20,
              right: 20,
              left: 0,
              bottom: 20
            }}
          >
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
                `₹${Number(v).toLocaleString('en-IN')}`
              }
              tickLine={false}
              axisLine={{
                stroke: 'rgba(255,255,255,0.1)'
              }}
            />

            <Tooltip content={<CustomTooltip />} />

            <Legend />

            <Area
              type="monotone"
              dataKey="underlying"
              stroke="none"
              fill="#26a69a"
              fillOpacity={0.08}
            />

            <Line
              type="monotone"
              dataKey="underlying"
              stroke="#26a69a"
              strokeWidth={3}
              dot={false}
              name="Underlying"
            />

            <Line
              type="monotone"
              dataKey="max_pain"
              stroke="#FF69B4"
              strokeWidth={3}
              strokeDasharray="6 6"
              dot={false}
              name="Max Pain"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
// frontend/src/components/charts/StrikeBarChart.jsx

import { useMemo } from 'react';

import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  ReferenceLine,
} from 'recharts';

import {
  getMetricFields,
  getMetricColors,
  getMetricLabel,
  formatNumber
} from '../../api/client';

function CustomTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="
        bg-card
        border
        border-white/10
        rounded-xl
        px-4
        py-3
        shadow-xl
      "
    >
      <p className="text-sm font-semibold text-white mb-2">
        Strike: {formatNumber(label)}
      </p>

      {payload.map((entry) => (
        <div
          key={entry.name}
          className="flex items-center justify-between gap-4 text-sm"
        >
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="text-white">{formatNumber(entry.value)}</span>
        </div>
      ))}

      <p className="mt-3 text-[11px] text-white/45">
        {getMetricLabel(metric)}
      </p>
    </div>
  );
}

export default function StrikeBarChart({
  snapshotData,
  metric   = 'oi',
  yDomain  = null,
  xScale   = null,   // { x_min, x_max, strike_gap }
}) {
  const strikes = snapshotData?.strikes || [];
  const fields  = getMetricFields(metric);
  const colors  = getMetricColors(metric);

  const chartData = strikes.map((row) => ({
    strike: Number(row.strike),
    ce:     Number(row[fields.ce] || 0),
    pe:     Number(row[fields.pe] || 0),
  }));

  // Full stable tick array derived from xScale so the axis never shifts
  // between dates. Falls back to whatever strikes are in the snapshot.
  const stableTicks = useMemo(() => {
    if (!xScale) return chartData.map((d) => d.strike);

    const { x_min, x_max, strike_gap } = xScale;
    const ticks = [];
    for (let s = x_min; s <= x_max + 0.001; s += strike_gap) {
      ticks.push(Math.round(s));
    }
    return ticks;
  }, [xScale, chartData]);

  const visibleTickInterval = Math.max(
    1,
    Math.ceil(stableTicks.length / 15)
  );

  const xDomain = xScale
    ? [xScale.x_min - xScale.strike_gap, xScale.x_max + xScale.strike_gap]
    : ['dataMin', 'dataMax'];

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">
            Strike Distribution
          </h3>

          <p className="text-sm text-white/45">
            CE vs PE {getMetricLabel(metric)}
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: colors.ce }}
            />
            <span className="text-white/70">CE</span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: colors.pe }}
            />
            <span className="text-white/70">PE</span>
          </div>
        </div>
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 20, left: 0, bottom: 20 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
            />

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

            <Legend wrapperStyle={{ color: 'white' }} />

            {snapshotData?.underlying != null && snapshotData?.max_pain != null && (() => {
              const u = Number(snapshotData.underlying);
              const m = Number(snapshotData.max_pain);
              const uPos = u <= m ? 'insideTopRight' : 'insideTopLeft';
              const mPos = m <= u ? 'insideTopRight' : 'insideTopLeft';
              return (
                <>
                  <ReferenceLine
                    x={u}
                    stroke="#FFD700"
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    label={{ value: `Underlying ${u.toFixed(2)}`, fill: '#FFD700', fontSize: 11, position: uPos }}
                  />
                  <ReferenceLine
                    x={m}
                    stroke="#FF69B4"
                    strokeWidth={2}
                    strokeDasharray="2 6"
                    label={{ value: `Max Pain ${m.toFixed(2)}`, fill: '#FF69B4', fontSize: 11, position: mPos }}
                  />
                </>
              );
            })()}

            {snapshotData?.underlying != null && snapshotData?.max_pain == null && (
              <ReferenceLine
                x={Number(snapshotData.underlying)}
                stroke="#FFD700"
                strokeWidth={2}
                strokeDasharray="6 6"
                label={{ value: `Underlying ${Number(snapshotData.underlying).toFixed(2)}`, fill: '#FFD700', fontSize: 11, position: 'insideTopLeft' }}
              />
            )}

            {snapshotData?.max_pain != null && snapshotData?.underlying == null && (
              <ReferenceLine
                x={Number(snapshotData.max_pain)}
                stroke="#FF69B4"
                strokeWidth={2}
                strokeDasharray="2 6"
                label={{ value: `Max Pain ${Number(snapshotData.max_pain).toFixed(2)}`, fill: '#FF69B4', fontSize: 11, position: 'insideTopLeft' }}
              />
            )}

            <Bar
              dataKey="ce"
              name="CE"
              fill={colors.ce}
              radius={[4, 4, 0, 0]}
              isAnimationActive={true}
              animationDuration={180}
            />

            <Bar
              dataKey="pe"
              name="PE"
              fill={colors.pe}
              radius={[4, 4, 0, 0]}
              isAnimationActive={true}
              animationDuration={180}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
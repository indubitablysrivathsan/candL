// frontend/src/components/shared/ChartTooltip.jsx

import { T, mono, labelStyle } from '../../theme';
import { fmtK } from '../../utils/formatters';

// Recharts custom tooltip — dark card with a colored dot per series.
// Pass `valueFormatter(value, name)` to override the default fmtK() display.
export default function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
      padding: '10px 14px', minWidth: 180,
    }}>
      <div style={labelStyle({ color: T.amber, marginBottom: 8 })}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, background: p.color, flexShrink: 0 }} />
            <span style={{ ...mono, fontSize: 10, color: p.color }}>{p.name}</span>
          </div>
          <span style={{ ...mono, fontSize: 11, color: T.textHi, fontWeight: 600 }}>
            {valueFormatter ? valueFormatter(p.value, p.name) : fmtK(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// frontend/src/components/shared/TabBar.jsx

import { T, mono } from '../../theme';

// Top-level page tab strip — amber underline on the active tab.
// tabs: [{ key, label }]
export default function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: `1px solid ${T.borderHi}`,
      background: T.surface,
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '8px 18px',
            fontSize: 10,
            ...mono,
            letterSpacing: '0.09em',
            fontWeight: active === key ? 700 : 400,
            color: active === key ? T.amber : T.textMid,
            background: active === key ? T.amberDim : 'transparent',
            border: 'none',
            borderBottom: active === key ? `2px solid ${T.amber}` : '2px solid transparent',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            textTransform: 'uppercase',
            transition: 'color 0.15s, background 0.15s',
            marginBottom: -1,
            borderRadius: 0,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

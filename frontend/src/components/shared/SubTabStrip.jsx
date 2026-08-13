// frontend/src/components/shared/SubTabStrip.jsx

import { T, mono } from '../../theme';

// Secondary tab strip nested inside a Panel — blue underline, smaller than TabBar.
// tabs: [{ key, label }]
export default function SubTabStrip({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, marginBottom: 14 }}>
      {tabs.map(({ key, label }) => (
        <button key={key} onClick={() => onChange(key)} style={{
          ...mono,
          padding: '6px 14px',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          background: 'transparent',
          border: 'none',
          borderBottom: active === key ? `2px solid ${T.blue}` : '2px solid transparent',
          color: active === key ? T.blue : T.textLo,
          cursor: 'pointer',
          transition: 'all 0.12s',
          marginBottom: -1,
        }}>
          {label}
        </button>
      ))}
    </div>
  );
}

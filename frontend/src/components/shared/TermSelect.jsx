// frontend/src/components/shared/TermSelect.jsx

import { T, mono } from '../../theme';

// Styled native <select> with a chevron indicator, matching terminal aesthetic.
// Usage: <TermSelect value={v} onChange={setV}>{options.map(o => <option key={o} value={o}>{o}</option>)}</TermSelect>
export default function TermSelect({ value, onChange, children, style = {} }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...mono,
        fontSize: 10,
        padding: '4px 24px 4px 8px',
        background: T.surfaceHi,
        border: `1px solid ${T.border}`,
        color: T.textMid,
        outline: 'none',
        borderRadius: 0,
        letterSpacing: '0.04em',
        cursor: 'pointer',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(255,255,255,0.25)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        ...style,
      }}
    >
      {children}
    </select>
  );
}

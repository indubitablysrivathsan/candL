// frontend/src/components/shared/PageHeader.jsx

import { T, mono } from '../../theme';

// Standard page title bar: bold uppercase title + dim subtitle on the left,
// pulsing "live" dot indicator on the right. `extra` can add additional
// dim uppercase info spans between title and the live indicator (e.g.
// ticker counts, session date) — rendered with left borders like Futures/Options.
export default function PageHeader({ title, subtitle, extra, live = true, liveLabel = 'NSE LIVE' }) {
  return (
    <div style={{
      padding: '8px 20px',
      borderBottom: `1px solid ${T.border}`,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      background: T.surface,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: T.textHi, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>
        {title}
      </span>
      {subtitle && (
        <span style={{ fontSize: 9, color: T.textLo, letterSpacing: '0.1em', ...mono }}>
          {subtitle}
        </span>
      )}
      {extra?.map((item, i) => (
        <span key={i} style={{
          fontSize: 10, letterSpacing: '0.12em', color: T.textLo, textTransform: 'uppercase', ...mono,
          borderLeft: `1px solid ${T.border}`, paddingLeft: 16,
        }}>
          {item}
        </span>
      ))}
      {live && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, boxShadow: `0 0 6px ${T.green}`, display: 'inline-block' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.12em', color: T.green, textTransform: 'uppercase', ...mono }}>{liveLabel}</span>
        </div>
      )}
    </div>
  );
}

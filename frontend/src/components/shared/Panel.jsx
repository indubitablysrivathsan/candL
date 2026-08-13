// frontend/src/components/shared/Panel.jsx

import { T, mono, labelStyle } from '../../theme';

// Header bar for a Panel: title (amber, uppercase) + optional subtitle + right-aligned controls.
export function PanelHeader({ title, subtitle, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 14px',
      borderBottom: `1px solid ${T.border}`,
      background: T.surfaceHi,
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={labelStyle({ color: T.amber, letterSpacing: '0.16em' })}>{title}</span>
        {subtitle && <span style={{ ...mono, fontSize: 10, color: T.textLo }}>{subtitle}</span>}
      </div>
      {right && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{right}</div>}
    </div>
  );
}

// Bordered surface with a PanelHeader and padded body — the standard section
// container used across FII / Participants / Market pages.
export default function Panel({ title, subtitle, right, children, style = {} }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 0, overflow: 'hidden', ...style }}>
      <PanelHeader title={title} subtitle={subtitle} right={right} />
      <div style={{ padding: '14px' }}>{children}</div>
    </div>
  );
}

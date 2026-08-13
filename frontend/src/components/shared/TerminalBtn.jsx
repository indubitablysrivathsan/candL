// frontend/src/components/shared/TerminalBtn.jsx

import { T, mono } from '../../theme';

// Small uppercase toggle/action button used throughout the terminal UI
// (period presets, asset-class toggles, tab-like filters, CSV export, etc).
export default function TerminalBtn({ active, children, onClick, disabled, color, small, style = {} }) {
  const accent    = color || T.amber;
  const accentDim = color ? `${color}20` : T.amberDim;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...mono,
        padding: small ? '3px 8px' : '4px 11px',
        fontSize: small ? 9 : 10,
        fontWeight: 600,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        border: `1px solid ${active ? accent : T.border}`,
        background: active ? accentDim : 'transparent',
        color: active ? accent : T.textMid,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
        borderRadius: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

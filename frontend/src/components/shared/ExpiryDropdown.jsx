// frontend/src/components/shared/ExpiryDropdown.jsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { T, mono } from '../../theme';
import PortalDropdown from './PortalDropdown';

const monoSm = { fontSize: 11, letterSpacing: '0.04em', color: T.textMid, ...mono };

const sectionLabel = (extra = {}) => ({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.textLo,
  ...extra,
});

const dropItem = (active, disabled) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '7px 12px',
  fontSize: 11,
  ...mono,
  letterSpacing: '0.05em',
  color: disabled ? T.textGhost : active ? T.amber : T.textHi,
  background: active ? T.amberDim : 'transparent',
  border: 'none',
  borderBottom: `1px solid ${T.border}`,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  borderRadius: 0,
  textTransform: 'uppercase',
  transition: 'background 0.1s',
});

// Multi-select (or single-select) expiry picker with a checkbox-style dropdown menu.
// Used by Futures.jsx and Options.jsx control bars.
export default function ExpiryDropdown({ expiries, selectedExpiries, onToggle, singleSelect, maxSelect, label: labelText }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const triggerLabel = useMemo(() => {
    if (selectedExpiries.length === 0) return 'Select expiry…';
    if (selectedExpiries.length === 1) return selectedExpiries[0];
    return `${selectedExpiries.length} selected`;
  }, [selectedExpiries]);

  const isAtMax = maxSelect && selectedExpiries.length >= maxSelect;

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={sectionLabel()}>
        {labelText}
        {maxSelect ? <span style={{ color: T.textGhost, marginLeft: 5 }}>max {maxSelect}</span> : ''}
      </span>
      <div ref={triggerRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '5px 10px', minWidth: 200, height: 30, background: T.bg,
            border: `1px solid ${open ? T.amber : T.border}`, color: selectedExpiries.length ? T.textHi : T.textMid,
            fontSize: 11, ...mono, letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: 'pointer', transition: 'border-color 0.15s', whiteSpace: 'nowrap', borderRadius: 0,
          }}
        >
          <span>{triggerLabel}</span>
          <span style={{ fontSize: 10, color: T.textLo }}>▾</span>
        </button>
      </div>
      <PortalDropdown anchorRef={triggerRef} open={open} minWidth={200}>
        {expiries.length === 0
          ? <div style={{ padding: '8px 12px', ...monoSm }}>No expiries</div>
          : expiries.map((exp) => {
            const active = selectedExpiries.includes(exp);
            const disabled = !active && isAtMax;
            return (
              <button
                key={exp}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (disabled) return;
                  onToggle(exp);
                  if (singleSelect) setOpen(false);
                }}
                style={{ ...dropItem(active, disabled), display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span style={{
                  width: 11, height: 11, flexShrink: 0,
                  border: `1px solid ${active ? T.amber : T.border}`,
                  background: active ? T.amber : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0,
                }}>
                  {active && <span style={{ fontSize: 9, color: '#000', lineHeight: 1, fontWeight: 800 }}>✓</span>}
                </span>
                {exp}
              </button>
            );
          })}
      </PortalDropdown>
    </div>
  );
}

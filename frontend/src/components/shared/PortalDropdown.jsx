// frontend/src/components/shared/PortalDropdown.jsx

import { useEffect, useState } from 'react';
import { T } from '../../theme';

// Fixed-position dropdown panel anchored under `anchorRef`'s bounding box.
// Used by ExpiryDropdown / TickerSearch-style menus that must escape
// overflow:hidden ancestors (control-bar cells).
export default function PortalDropdown({ anchorRef, open, children, minWidth = 160 }) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    setRect(anchorRef.current.getBoundingClientRect());
  }, [open, anchorRef]);

  if (!open || !rect) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: rect.bottom + 2,
        left: rect.left,
        minWidth: Math.max(rect.width, minWidth),
        maxHeight: 300,
        overflowY: 'auto',
        background: '#0b0f16',
        border: `1px solid ${T.borderHi}`,
        zIndex: 9999,
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        borderRadius: 0,
      }}
    >
      {children}
    </div>
  );
}

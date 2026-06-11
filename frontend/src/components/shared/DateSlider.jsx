// frontend/src/components/shared/DateSlider.jsx

import { useMemo, useRef, useEffect, useCallback } from 'react';

/* ─── design tokens ───────────────────────────────────────────── */
const T = {
  bg:       '#06080C',
  surface:  '#0B0F16',
  elevated: '#111720',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.18)',
  amber:    '#F0A500',
  amberDim: 'rgba(240,165,0,0.15)',
  amberMid: 'rgba(240,165,0,0.35)',
  textHi:   'rgba(255,255,255,0.90)',
  textMid:  'rgba(255,255,255,0.45)',
  textLo:   'rgba(255,255,255,0.20)',
};

const monoFont = "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace";

/* ─── helpers ─────────────────────────────────────────────────── */
// How many side-slots are visible (each side of selected)
const SIDE_VISIBLE = 3;
const TOTAL_VISIBLE = SIDE_VISIBLE * 2 + 1; // 7 slots

// Format date string to compact display: "2024-03-15" → "15 MAR"
function fmtShort(d) {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length < 3) return d;
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${parts[2]} ${months[parseInt(parts[1], 10) - 1] ?? ''}`;
}

function fmtFull(d) {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length < 3) return d;
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${parts[2]} ${months[parseInt(parts[1], 10) - 1] ?? ''} ${parts[0]}`;
}

/* ─── Component ───────────────────────────────────────────────── */
export default function DateSlider({ dates = [], selectedDate, onChange }) {
  const railRef = useRef(null);

  const selectedIndex = useMemo(() => {
    if (!dates.length) return 0;
    const idx = dates.findIndex((d) => d === selectedDate);
    return idx >= 0 ? idx : 0;
  }, [dates, selectedDate]);

  const goPrevious = useCallback(() => {
    if (selectedIndex > 0) onChange(dates[selectedIndex - 1]);
  }, [selectedIndex, dates, onChange]);

  const goNext = useCallback(() => {
    if (selectedIndex < dates.length - 1) onChange(dates[selectedIndex + 1]);
  }, [selectedIndex, dates, onChange]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrevious(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goPrevious, goNext]);

  if (!dates.length) {
    return (
      <div style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        padding: '12px 16px',
        fontFamily: monoFont,
        fontSize: 10,
        color: T.textLo,
        letterSpacing: '0.10em',
      }}>
        NO DATES
      </div>
    );
  }

  const progress = dates.length > 1 ? selectedIndex / (dates.length - 1) : 0;

  // Build the 7-slot window centred on selectedIndex
  const slots = Array.from({ length: TOTAL_VISIBLE }, (_, i) => {
    const offset = i - SIDE_VISIBLE; // -3 … +3
    const idx    = selectedIndex + offset;
    return {
      offset,
      idx,
      date: idx >= 0 && idx < dates.length ? dates[idx] : null,
    };
  });

  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderTop: `1px solid ${T.borderHi}`,
        fontFamily: monoFont,
        userSelect: 'none',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Top strip: progress bar + meta ─────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px 0',
        gap: 12,
      }}>
        {/* Selected date — large anchor */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            color: T.amber,
            letterSpacing: '0.08em',
          }}>
            {fmtFull(selectedDate)}
          </span>
          <span style={{
            fontSize: 9,
            color: T.textLo,
            letterSpacing: '0.12em',
          }}>
            EXPIRY DATE
          </span>
        </div>

        {/* Counter + position indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontSize: 9,
            color: T.textLo,
            letterSpacing: '0.10em',
          }}>
            {selectedIndex + 1} <span style={{ color: T.textLo, opacity: 0.5 }}>/</span> {dates.length}
          </span>
          {/* Mini dot-track — compressed to MAX_DOTS buckets so it never overflows */}
          {(() => {
            const MAX_DOTS = 350;
            const total    = dates.length;
            // How many real dates each dot represents (always ≥ 1)
            const ratio    = Math.ceil(total / MAX_DOTS);
            const dotCount = Math.ceil(total / ratio);
            // Which bucket is the selected index in?
            const activeBucket = Math.floor(selectedIndex / ratio);

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {Array.from({ length: dotCount }, (_, b) => {
                  const isActive = b === activeBucket;
                  // Is this bucket entirely before the selected index?
                  const bucketEnd = (b + 1) * ratio - 1;
                  const isPast    = bucketEnd < selectedIndex && !isActive;
                  return (
                    <div
                      key={b}
                      onClick={() => {
                        // Jump to the first date in this bucket
                        const targetIdx = Math.min(b * ratio, total - 1);
                        onChange(dates[targetIdx]);
                      }}
                      style={{
                        width:  isActive ? 10 : 3,
                        height: 3,
                        background: isActive
                          ? T.amber
                          : isPast
                          ? 'rgba(240,165,0,0.30)'
                          : T.border,
                        cursor: 'pointer',
                        transition: 'width 0.15s, background 0.15s',
                        flexShrink: 0,
                      }}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Progress bar ───────────────────────────────────────── */}
      <div style={{ padding: '6px 16px 0' }}>
        <div
          style={{
            width: '100%',
            height: 1,
            background: T.border,
            position: 'relative',
            cursor: 'pointer',
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            const idx = Math.round(ratio * (dates.length - 1));
            const clamped = Math.max(0, Math.min(dates.length - 1, idx));
            onChange(dates[clamped]);
          }}
        >
          {/* filled portion */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${progress * 100}%`,
            background: T.amberMid,
          }} />
          {/* thumb */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: `${progress * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 8,
            height: 8,
            background: T.amber,
            border: `1px solid ${T.bg}`,
          }} />
        </div>
      </div>

      {/* ── Date rail ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        marginTop: 8,
        borderTop: `1px solid ${T.border}`,
      }}>
        {/* Prev button */}
        <button
          onClick={goPrevious}
          disabled={selectedIndex === 0}
          style={{
            width: 36,
            background: 'transparent',
            border: 'none',
            borderRight: `1px solid ${T.border}`,
            color: selectedIndex === 0 ? T.textLo : T.textMid,
            fontSize: 10,
            cursor: selectedIndex === 0 ? 'not-allowed' : 'pointer',
            opacity: selectedIndex === 0 ? 0.3 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.1s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { if (selectedIndex > 0) e.currentTarget.style.color = T.amber; }}
          onMouseLeave={e => { e.currentTarget.style.color = selectedIndex === 0 ? T.textLo : T.textMid; }}
        >
          ◀
        </button>

        {/* 7-slot windowed date rail */}
        <div
          ref={railRef}
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: `repeat(${TOTAL_VISIBLE}, 1fr)`,
            overflow: 'hidden',
          }}
        >
          {slots.map(({ offset, idx, date }) => {
            const isSelected = offset === 0;
            const isEdge     = Math.abs(offset) === SIDE_VISIBLE;
            const exists     = date != null;
            const opacity    = exists
              ? isSelected ? 1
              : isEdge     ? 0.35
              : 1 - Math.abs(offset) * 0.18
              : 0.15;

            return (
              <div
                key={offset}
                onClick={() => exists && onChange(date)}
                style={{
                  padding: '9px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  cursor: exists ? 'pointer' : 'default',
                  opacity,
                  background: isSelected ? T.amberDim : 'transparent',
                  borderLeft:  isSelected ? `1px solid ${T.amberMid}` : `1px solid ${T.border}`,
                  borderRight: isSelected ? `1px solid ${T.amberMid}` : 'none',
                  transition: 'background 0.1s',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  if (exists && !isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* Amber top border on selected */}
                {isSelected && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: T.amber,
                  }} />
                )}

                <span style={{
                  fontSize: isSelected ? 11 : 10,
                  fontWeight: isSelected ? 700 : 400,
                  color: isSelected ? T.amber : T.textMid,
                  letterSpacing: '0.06em',
                  lineHeight: 1,
                }}>
                  {exists ? fmtShort(date) : '·'}
                </span>

                {/* Offset label: T-1, T+1 etc */}
                {exists && !isSelected && (
                  <span style={{
                    fontSize: 8,
                    color: T.textLo,
                    letterSpacing: '0.08em',
                  }}>
                    {offset < 0 ? `T${offset}` : `T+${offset}`}
                  </span>
                )}
                {isSelected && (
                  <span style={{
                    fontSize: 8,
                    color: T.amber,
                    letterSpacing: '0.10em',
                    opacity: 0.7,
                  }}>
                    T
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Next button */}
        <button
          onClick={goNext}
          disabled={selectedIndex === dates.length - 1}
          style={{
            width: 36,
            background: 'transparent',
            border: 'none',
            borderLeft: `1px solid ${T.border}`,
            color: selectedIndex === dates.length - 1 ? T.textLo : T.textMid,
            fontSize: 10,
            cursor: selectedIndex === dates.length - 1 ? 'not-allowed' : 'pointer',
            opacity: selectedIndex === dates.length - 1 ? 0.3 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.1s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { if (selectedIndex < dates.length - 1) e.currentTarget.style.color = T.amber; }}
          onMouseLeave={e => { e.currentTarget.style.color = selectedIndex === dates.length - 1 ? T.textLo : T.textMid; }}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
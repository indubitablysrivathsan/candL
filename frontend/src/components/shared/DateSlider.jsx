// frontend/src/components/shared/DateSlider.jsx

import { useMemo } from 'react';

const s = {
  wrap: {
    background: '#0d1117',
    border: '1px solid rgba(255,255,255,0.08)',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  btn: {
    width: 28,
    height: 28,
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'color 0.15s, border-color 0.15s',
  },
  btnDisabled: {
    opacity: 0.25,
    cursor: 'not-allowed',
  },
  sliderWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  date: {
    fontSize: 12,
    fontWeight: 500,
    color: '#F5A623',
    letterSpacing: '0.04em',
  },
  counter: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: '0.06em',
  },
};

export default function DateSlider({ dates = [], selectedDate, onChange }) {
  const selectedIndex = useMemo(() => {
    if (!dates.length) return 0;
    const idx = dates.findIndex((d) => d === selectedDate);
    return idx >= 0 ? idx : 0;
  }, [dates, selectedDate]);

  const goPrevious = () => { if (selectedIndex > 0) onChange(dates[selectedIndex - 1]); };
  const goNext     = () => { if (selectedIndex < dates.length - 1) onChange(dates[selectedIndex + 1]); };

  if (!dates.length) {
    return (
      <div style={s.wrap}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>NO DATES</span>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <style>{`
        .terminal-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 2px;
          background: rgba(255,255,255,0.08);
          outline: none;
          cursor: pointer;
        }
        .terminal-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          background: #F5A623;
          border-radius: 0;
          cursor: pointer;
        }
        .terminal-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          background: #F5A623;
          border-radius: 0;
          cursor: pointer;
          border: none;
        }
        .terminal-slider::-webkit-slider-runnable-track {
          background: linear-gradient(
            to right,
            rgba(245,166,35,0.5) 0%,
            rgba(245,166,35,0.5) calc(${(selectedIndex / Math.max(dates.length - 1, 1)) * 100}%),
            rgba(255,255,255,0.08) calc(${(selectedIndex / Math.max(dates.length - 1, 1)) * 100}%)
          );
        }
        .terminal-nav-btn:hover:not(:disabled) { color: #F5A623 !important; border-color: rgba(245,166,35,0.4) !important; }
      `}</style>

      <button
        className="terminal-nav-btn"
        onClick={goPrevious}
        disabled={selectedIndex === 0}
        style={{ ...s.btn, ...(selectedIndex === 0 ? s.btnDisabled : {}) }}
      >
        ◀
      </button>

      <div style={s.sliderWrap}>
        <div style={s.meta}>
          <span style={s.date}>{selectedDate}</span>
          <span style={s.counter}>
            {selectedIndex + 1} / {dates.length}
          </span>
        </div>
        <input
          type="range"
          className="terminal-slider"
          min={0}
          max={dates.length - 1}
          step={1}
          value={selectedIndex}
          onChange={(e) => { const d = dates[Number(e.target.value)]; if (d) onChange(d); }}
        />
      </div>

      <button
        className="terminal-nav-btn"
        onClick={goNext}
        disabled={selectedIndex === dates.length - 1}
        style={{ ...s.btn, ...(selectedIndex === dates.length - 1 ? s.btnDisabled : {}) }}
      >
        ▶
      </button>
    </div>
  );
}
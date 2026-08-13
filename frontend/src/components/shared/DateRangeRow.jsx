// frontend/src/components/shared/DateRangeRow.jsx

import { T, mono } from '../../theme';
import { defaultRange } from '../../utils/dateRange';
import TerminalBtn from './TerminalBtn';

// 1M/3M/6M/1Y preset buttons that snap startDate/endDate to a range ending
// at the latest of `allDates`.
export function RangePresets({ allDates, onStart, onEnd }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${T.border}` }}>
      {[{ l: '1M', m: 1 }, { l: '3M', m: 3 }, { l: '6M', m: 6 }, { l: '1Y', m: 12 }].map(({ l, m }, i) => (
        <TerminalBtn key={l}
          onClick={() => { const r = defaultRange(allDates, m); onStart(r.start); onEnd(r.end); }}
          style={{ borderWidth: 0, borderRight: i < 3 ? `1px solid ${T.border}` : 0 }}>
          {l}
        </TerminalBtn>
      ))}
    </div>
  );
}

// RangePresets + explicit start/end <input type="date"> pair — the standard
// date-range control used by chart panels across Participants.jsx / Market.jsx.
export default function DateRangeRow({ allDates, startDate, endDate, onStart, onEnd }) {
  const inputStyle = {
    ...mono, fontSize: 10, padding: '4px 8px',
    background: T.surfaceHi, border: `1px solid ${T.border}`,
    color: T.textMid, outline: 'none', borderRadius: 0, letterSpacing: '0.04em',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <RangePresets allDates={allDates} onStart={onStart} onEnd={onEnd} />
      <input type="date" value={startDate} onChange={e => onStart(e.target.value)} style={inputStyle} />
      <span style={{ color: T.textLo, fontSize: 10 }}>→</span>
      <input type="date" value={endDate}   onChange={e => onEnd(e.target.value)}   style={inputStyle} />
    </div>
  );
}

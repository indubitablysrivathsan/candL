// frontend/src/components/shared/DataTable.jsx

import { T, mono } from '../../theme';

const thStyle = {
  ...mono,
  padding: '6px 10px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.textLo,
  borderBottom: `1px solid ${T.borderHi}`,
  whiteSpace: 'nowrap',
  background: T.surfaceHi,
};

// Generic scrollable data grid.
// columns: [{ key, label, align, render(row) }]
// rows: array of row objects.
export function DataTable({ columns, rows, maxHeight = 480, rowKey }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, overflowX: 'auto', overflowY: 'auto', maxHeight }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ ...thStyle, textAlign: col.align || 'right' }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? (row[rowKey] ?? i) : i} style={{ background: i % 2 === 0 ? T.surface : 'transparent' }}>
              {columns.map((col) => (
                <td key={col.key} style={{
                  ...mono, textAlign: col.align || 'right',
                  padding: '5px 10px', fontSize: 11, color: T.textMid,
                  borderBottom: `1px solid ${T.border}`,
                }}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Terminal table primitives ───────────────────────────────────
   Lower-level <table>/<tr>/<th>/<td> building blocks for bespoke
   layouts (multi-row-span cells, grouped headers) that don't fit the
   columns/rows shape of <DataTable>. Used by Futures.jsx, Options.jsx. */

export function TerminalTable({ children }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, letterSpacing: '0.03em', ...mono }}>
      {children}
    </table>
  );
}

export function TerminalTr({ children, header, atm }) {
  return (
    <tr style={{
      borderBottom: `1px solid ${T.border}`,
      background: atm ? 'rgba(240,165,0,0.07)' : header ? 'rgba(255,255,255,0.025)' : 'transparent',
      transition: 'background 0.1s',
    }}>
      {children}
    </tr>
  );
}

export function TerminalTh({ children }) {
  return (
    <th style={{
      padding: '7px 14px',
      textAlign: 'left',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: T.textHi,
    }}>
      {children}
    </th>
  );
}

export function TerminalTd({ children, accent, bold }) {
  return (
    <td style={{ padding: '6px 14px', color: accent || T.textMid, fontWeight: bold ? 600 : 400 }}>
      {children}
    </td>
  );
}

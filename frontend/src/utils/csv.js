// frontend/src/utils/csv.js
// Shared CSV export helper used by every page's "↓ Export CSV" buttons.
// See frontend/CONTEXT.md for usage guidance.

// rows: array of objects.
// filename: download filename.
// cols (optional): [{ key, label }] — controls column order/headers/subset.
//   If omitted, columns are inferred from Object.keys(rows[0]) and used as headers.
export function downloadCSV(rows, filename, cols) {
  if (!rows?.length) return;
  const columns = cols ?? Object.keys(rows[0]).map((key) => ({ key, label: key }));

  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    columns.map((c) => c.label).join(','),
    ...rows.map((row) => columns.map((c) => escape(row[c.key])).join(',')),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

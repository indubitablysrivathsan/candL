// frontend/src/components/shared/ExpirySnapshotTable.jsx

import { formatCurrency, formatNumber } from '../../api/client';

/* =========================================
   PCR SIGNAL HELPERS
========================================= */

function getPCRStyle(pcr) {
  if (pcr == null) return { color: 'text-white/80', label: '—', dot: 'bg-white/20' };
  if (pcr >= 1.2)  return { color: 'text-[#26a69a]', label: 'Bullish',  dot: 'bg-[#26a69a]' };
  if (pcr <= 0.8)  return { color: 'text-[#ef5350]', label: 'Bearish',  dot: 'bg-[#ef5350]' };
  return              { color: 'text-[#FFA726]',  label: 'Neutral',  dot: 'bg-[#FFA726]'  };
}

/* =========================================
   CSV DOWNLOAD
========================================= */

function downloadCSV(ticker, expiry, selectedDate, row) {
  if (!row) return;

  const headers = [
    'Ticker',
    'Expiry',
    'Trade Date',
    'Underlying',
    'Max Pain',
    'PCR',
    'CE OI',
    'PE OI',
    'Net OI (CE-PE)',
  ];

  const netOI =
    row.ce != null && row.pe != null
      ? row.ce - row.pe
      : '';

  const values = [
    ticker,
    expiry,
    selectedDate,
    row.underlying ?? '',
    row.max_pain   ?? '',
    row.pcr != null ? Number(row.pcr).toFixed(4) : '',
    row.ce  ?? '',
    row.pe  ?? '',
    netOI,
  ];

  const csv = [headers.join(','), values.join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const anchor      = document.createElement('a');
  anchor.href       = url;
  anchor.download   = `${selectedDate}_daily_expiry_snapshot.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/* =========================================
   COMPONENT
========================================= */

export default function ExpirySnapshotTable({
  ticker,
  expiry,
  selectedDate,
  row,
}) {
  /* --- empty state --------------------------------------------------- */
  if (!row) {
    return (
      <div className="card p-8 flex items-center justify-center min-h-[160px]">
        <p className="text-sm text-white/50">
          No summary data available for {selectedDate}
        </p>
      </div>
    );
  }

  const pcrStyle = getPCRStyle(row.pcr);
  const netOI    =
    row.ce != null && row.pe != null ? row.ce - row.pe : null;

  /* --- row definitions ---------------------------------------------- */
  const rows = [
    {
      field: 'Underlying',
      value: formatCurrency(row.underlying, 2),
      valueClass: 'text-[#FFD700]',
      signal: null,
    },
    {
      field: 'Max Pain',
      value: formatCurrency(row.max_pain, 2),
      valueClass: 'text-[#FF69B4]',
      signal: null,
    },
    {
      field: 'PCR',
      value: row.pcr != null ? Number(row.pcr).toFixed(3) : '--',
      valueClass: pcrStyle.color,
      signal: {
        dot:   pcrStyle.dot,
        label: pcrStyle.label,
        class: pcrStyle.color,
      },
    },
    {
      field: 'CE OI (Total)',
      value: formatNumber(row.ce),
      valueClass: 'text-[#00B0F0]',
      signal: null,
    },
    {
      field: 'PE OI (Total)',
      value: formatNumber(row.pe),
      valueClass: 'text-[#FF00FF]',
      signal: null,
    },
    {
      field: 'Net OI  (CE − PE)',
      value: netOI != null ? formatNumber(netOI) : '--',
      valueClass:
        netOI == null
          ? 'text-white/60'
          : netOI > 0
          ? 'text-[#26a69a]'
          : 'text-[#ef5350]',
      signal: null,
    },
  ];

  /* --- render ------------------------------------------------------- */
  return (
    <div className="card overflow-hidden">
      {/* ── header ─────────────────────────────────── */}
      <div
        className="
          flex items-center justify-between
          px-5 py-4
          border-b border-white/8
        "
      >
        <div>
          <h3 className="text-sm font-semibold text-white">
            Daily Expiry Summary
          </h3>

          <p className="mt-0.5 text-xs text-white/45">
            {ticker}&nbsp;·&nbsp;{expiry}&nbsp;·&nbsp;{selectedDate}
          </p>
        </div>

        <button
          onClick={() =>
            downloadCSV(ticker, expiry, selectedDate, row)
          }
          className="
            flex items-center gap-2
            px-4 py-2
            rounded-xl
            border border-[#00B0F0]/25
            bg-[#00B0F0]/10
            text-[#00B0F0] text-sm
            transition
            hover:bg-[#00B0F0]/20
            active:scale-95
          "
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download CSV
        </button>
      </div>

      {/* ── table ──────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Signal</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.field}>
                {/* field label */}
                <td className="text-white/55 font-normal">
                  {r.field}
                </td>

                {/* value */}
                <td
                  className={`
                    font-semibold tabular-nums tracking-wide
                    ${r.valueClass}
                  `}
                >
                  {r.value}
                </td>

                {/* signal badge */}
                <td>
                  {r.signal ? (
                    <span
                      className={`
                        inline-flex items-center gap-1.5
                        text-xs font-medium
                        ${r.signal.class}
                      `}
                    >
                      <span
                        className={`
                          w-1.5 h-1.5 rounded-full
                          ${r.signal.dot}
                        `}
                      />
                      {r.signal.label}
                    </span>
                  ) : (
                    <span className="text-white/20 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
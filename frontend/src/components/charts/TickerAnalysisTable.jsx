// src/components/TickerAnalysisTable.jsx

import { useEffect, useMemo, useState } from 'react';
import { getTickerAnalysis } from '../../api/client';
import LoadingSpinner from '../../components/shared/LoadingSpinner';

/* ── tiny helpers ──────────────────────────────────────────────── */

function fmt(val, digits = 0) {
  if (val == null || isNaN(val)) return '—';
  return Number(val).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(val) {
  if (val == null || isNaN(val)) return '—';
  const pct = val * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function fmtPCR(val) {
  if (val == null || isNaN(val)) return '—';
  return Number(val).toFixed(3);
}

function fmtCurrency(val) {
  if (val == null || isNaN(val)) return '—';
  return `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* colour helpers */
function pcrColor(pcr) {
  if (pcr == null) return 'text-white/60';
  if (pcr > 1.2)  return 'text-[#26a69a]';   // bullish (high put OI relative to calls)
  if (pcr < 0.8)  return 'text-[#ef5350]';   // bearish
  return 'text-[#FFA726]';                    // neutral
}

function driftColor(drift) {
  if (drift == null) return 'text-white/60';
  if (drift >  0.01) return 'text-[#ef5350]';  // max pain above underlying → bearish pull
  if (drift < -0.01) return 'text-[#26a69a]';  // max pain below → bullish pull
  return 'text-white/60';
}

function shareBar(share, color) {
  if (share == null) return null;
  const w = Math.round(share * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-white/70">{w}%</span>
    </div>
  );
}

/* ── CSV export ────────────────────────────────────────────────── */
function buildCSV(rows, expiries) {
  const expLabels = ['Current Month', 'Next Month', 'Far Month'];

  // header row 1 — group labels
  const h1 = ['Trade Date', 'Underlying', ...expiries.flatMap((_, i) => [
    expLabels[i] || expiries[i], '', '', '', '', '', ''
  ]), 'Combined OI', '', ''];

  // header row 2 — column labels
  const h2 = ['', '', ...expiries.flatMap(() => [
    'PE', 'CE', 'PCR', 'Max Pain', 'MaxPain Drift %', 'Share COI PE %', 'Share COI CE %'
  ]), 'PE', 'CE', 'PCR'];

  const dataRows = rows.map((r) => {
    const cols = [
      r.trade_date,
      r.underlying ?? '',
    ];
    r.expiry_data.forEach((ed) => {
      if (!ed) { cols.push('', '', '', '', '', '', ''); return; }
      cols.push(
        ed.pe ?? '',
        ed.ce ?? '',
        ed.pcr != null ? Number(ed.pcr).toFixed(3) : '',
        ed.max_pain ?? '',
        ed.maxpain_drift != null ? (ed.maxpain_drift * 100).toFixed(2) : '',
        ed.share_pe != null ? (ed.share_pe * 100).toFixed(2) : '',
        ed.share_ce != null ? (ed.share_ce * 100).toFixed(2) : '',
      );
    });
    cols.push(r.combined_pe ?? '', r.combined_ce ?? '', r.combined_pcr != null ? Number(r.combined_pcr).toFixed(3) : '');
    return cols;
  });

  const escape = (v) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [h1, h2, ...dataRows].map((row) => row.map(escape).join(',')).join('\n');
}

/* ── main component ────────────────────────────────────────────── */

export default function TickerAnalysisTable({ assetType, ticker, selectedExpiry, allExpiries }) {
  // derive current + next 2 from the full sorted list
const expiries = useMemo(() => {
    const sorted = [...allExpiries].sort();
    const idx = sorted.indexOf(selectedExpiry);
    if (idx === -1) return [selectedExpiry];
    return sorted.slice(idx, idx + 3);
  }, [allExpiries, selectedExpiry]);

  const { derivedStart, derivedEnd } = useMemo(() => {
    const sorted = [...allExpiries].sort();
    const idx = sorted.indexOf(selectedExpiry);
    // start = day after previous expiry, or '' if it's the first
    let derivedStart = '';
    if (idx > 0) {
      const prev = new Date(sorted[idx - 1]);
      prev.setDate(prev.getDate() + 1);
      derivedStart = prev.toISOString().slice(0, 10);
    }
    const derivedEnd = selectedExpiry; // up to and including expiry day
    return { derivedStart, derivedEnd };
  }, [allExpiries, selectedExpiry]);

  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [sortDir, setSortDir] = useState('desc'); // desc = newest first

  useEffect(() => {
    if (!ticker || !expiries?.length) return;
    let mounted = true;
    setRows([]);        // clear stale data immediately
    setLoading(true);
    setError('');

    getTickerAnalysis(assetType, ticker, expiries, derivedStart, derivedEnd)
      .then((data) => { if (mounted) setRows(data); })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load analysis'); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [assetType, ticker, selectedExpiry, derivedStart, derivedEnd]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) =>
      sortDir === 'desc'
        ? b.trade_date.localeCompare(a.trade_date)
        : a.trade_date.localeCompare(b.trade_date)
    );
  }, [rows, sortDir]);

  const expLabels = ['Current Month', 'Next Month', 'Far Month'];

  function downloadCSV() {
    const csv = buildCSV(sortedRows, expiries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${ticker}_ticker_analysis_${startDate || 'all'}_${endDate || 'all'}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  if (loading) return (
    <div className="card min-h-[300px] flex items-center justify-center"><LoadingSpinner /></div>
  );

  if (error) return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
      <p className="text-red-400 text-sm">{error}</p>
    </div>
  );

  if (!rows.length) return (
    <div className="card p-8"><p className="text-white/50 text-sm">No data for selected range.</p></div>
  );

  return (
    <div className="space-y-4">

      {/* ── toolbar ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-white">{ticker} — Multi-Expiry OI Analysis</h2>
          <span className="text-xs text-white/40 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
            {rows.length} trading days
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* sort toggle */}
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="px-3 py-2 rounded-xl border border-white/10 bg-[#151922] text-white/65 text-xs hover:bg-white/5 transition"
          >
            Date {sortDir === 'desc' ? '↓ Newest' : '↑ Oldest'}
          </button>
          <button
            onClick={downloadCSV}
            className="px-4 py-2 rounded-xl border border-[#00B0F0]/25 bg-[#00B0F0]/10 text-[#00B0F0] text-sm transition hover:bg-[#00B0F0]/20"
          >
            ↓ Download CSV
          </button>
        </div>
      </div>

      {/* ── legend ── */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-white/50">
        <span>PCR colour:</span>
        <span className="text-[#26a69a]">● &gt;1.2 Bullish</span>
        <span className="text-[#FFA726]">● 0.8–1.2 Neutral</span>
        <span className="text-[#ef5350]">● &lt;0.8 Bearish</span>
        <span className="ml-4">MaxPain Drift:</span>
        <span className="text-[#ef5350]">● above underlying</span>
        <span className="text-[#26a69a]">● below underlying</span>
      </div>

      {/* ── table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              {/* group header */}
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left text-white/50 font-medium sticky left-0 bg-[#1a1d26]">Date</th>
                <th className="px-3 py-2 text-right text-white/50 font-medium">Underlying</th>
                {expiries.map((exp, i) => (
                  <th
                    key={exp}
                    colSpan={7}
                    className="px-3 py-2 text-center font-semibold border-l border-white/10"
                    style={{ color: ['#00B0F0','#FF00FF','#FFA726'][i] }}
                  >
                    {expLabels[i] || exp} · {exp}
                  </th>
                ))}
                <th colSpan={3} className="px-3 py-2 text-center text-white/70 font-semibold border-l border-white/10">
                  Combined OI
                </th>
              </tr>
              {/* column header */}
              <tr className="border-b border-white/10 bg-white/3">
                <th className="px-3 py-2 sticky left-0 bg-[#1a1d26]" />
                <th className="px-3 py-2" />
                {expiries.map((exp) => (
                  <>
                    <th key={`${exp}-pe`}    className="px-3 py-2 text-right text-white/40 border-l border-white/10">PE OI</th>
                    <th key={`${exp}-ce`}    className="px-3 py-2 text-right text-white/40">CE OI</th>
                    <th key={`${exp}-pcr`}   className="px-3 py-2 text-right text-white/40">PCR</th>
                    <th key={`${exp}-mp`}    className="px-3 py-2 text-right text-white/40">Max Pain</th>
                    <th key={`${exp}-drift`} className="px-3 py-2 text-right text-white/40">MP Drift</th>
                    <th key={`${exp}-spe`}   className="px-3 py-2 text-right text-white/40">COI%PE</th>
                    <th key={`${exp}-sce`}   className="px-3 py-2 text-right text-white/40">COI%CE</th>
                  </>
                ))}
                <th className="px-3 py-2 text-right text-white/40 border-l border-white/10">PE</th>
                <th className="px-3 py-2 text-right text-white/40">CE</th>
                <th className="px-3 py-2 text-right text-white/40">PCR</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, ri) => {
                const isEven = ri % 2 === 0;
                return (
                  <tr
                    key={row.trade_date}
                    className={`border-b border-white/5 transition hover:bg-white/4 ${isEven ? '' : 'bg-white/2'}`}
                  >
                    {/* date */}
                    <td className="px-3 py-2 font-medium text-white/80 sticky left-0 bg-[#1a1d26] whitespace-nowrap">
                      {row.trade_date}
                    </td>
                    {/* underlying */}
                    <td className="px-3 py-2 text-right text-[#FFD700] font-medium whitespace-nowrap">
                      {fmtCurrency(row.underlying)}
                    </td>

                    {/* per-expiry columns */}
                    {row.expiry_data.map((ed, ei) => {
                      if (!ed) return (
                        <>
                          {[...Array(7)].map((_, k) => (
                            <td key={k} className={`px-3 py-2 text-center text-white/20 ${k === 0 ? 'border-l border-white/10' : ''}`}>—</td>
                          ))}
                        </>
                      );
                      return (
                        <>
                          <td key="pe"    className="px-3 py-2 text-right text-[#FF00FF] border-l border-white/10 tabular-nums">{fmt(ed.pe)}</td>
                          <td key="ce"    className="px-3 py-2 text-right text-[#00B0F0] tabular-nums">{fmt(ed.ce)}</td>
                          <td key="pcr"   className={`px-3 py-2 text-right font-semibold tabular-nums ${pcrColor(ed.pcr)}`}>{fmtPCR(ed.pcr)}</td>
                          <td key="mp"    className="px-3 py-2 text-right text-[#FF69B4] tabular-nums">{fmtCurrency(ed.max_pain)}</td>
                          <td key="drift" className={`px-3 py-2 text-right font-medium tabular-nums ${driftColor(ed.maxpain_drift)}`}>{fmtPct(ed.maxpain_drift)}</td>
                          <td key="spe"   className="px-3 py-2">{shareBar(ed.share_pe, '#FF00FF')}</td>
                          <td key="sce"   className="px-3 py-2">{shareBar(ed.share_ce, '#00B0F0')}</td>
                        </>
                      );
                    })}

                    {/* combined */}
                    <td className="px-3 py-2 text-right text-[#FF00FF] border-l border-white/10 tabular-nums">{fmt(row.combined_pe)}</td>
                    <td className="px-3 py-2 text-right text-[#00B0F0] tabular-nums">{fmt(row.combined_ce)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${pcrColor(row.combined_pcr)}`}>{fmtPCR(row.combined_pcr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
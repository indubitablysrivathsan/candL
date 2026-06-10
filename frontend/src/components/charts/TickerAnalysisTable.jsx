// src/components/TickerAnalysisTable.jsx

import { useEffect, useMemo, useState, Fragment } from 'react';
import { getTickerAnalysis } from '../../api/client';
import LoadingSpinner from '../../components/shared/LoadingSpinner';

/* ─── design tokens ──────────────────────────────────────────── */
const T = {
  bg:        '#06080c',
  surface:   '#0b0f16',
  surfaceAlt:'rgba(255,255,255,0.018)',
  border:    'rgba(255,255,255,0.07)',
  borderHi:  'rgba(255,255,255,0.14)',
  amber:     '#F0A500',
  amberDim:  'rgba(240,165,0,0.12)',
  green:     '#26a69a',
  red:       '#ef5350',
  orange:    '#FFA726',
  blue:      '#00B0F0',
  magenta:   '#E040FB',
  gold:      '#FFD700',
  pink:      '#D66E9A',
  textHi:    'rgba(255,255,255,0.90)',
  textMid:   'rgba(255,255,255,0.50)',
  textLo:    'rgba(255,255,255,0.25)',
  textGhost: 'rgba(255,255,255,0.12)',
};

const monoFont = "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace";

/* per-expiry column accent colours */
const EXP_COLORS = [T.blue, T.magenta, T.orange];

/* ─── tiny helpers ───────────────────────────────────────────── */
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

function pcrColor(pcr) {
  if (pcr == null) return T.textMid;
  if (pcr > 1.2)   return T.green;
  if (pcr < 0.8)   return T.red;
  return T.orange;
}

function driftColor(drift) {
  if (drift == null) return T.textMid;
  if (drift >  0.01) return T.red;
  if (drift < -0.01) return T.green;
  return T.textMid;
}

function ShareBar({ share, color }) {
  if (share == null) return <span style={{ color: T.textGhost }}>—</span>;
  const w = Math.round(share * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 52,
        height: 4,
        background: 'rgba(255,255,255,0.08)',
        flexShrink: 0,
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: `${w}%`,
          background: color,
        }} />
      </div>
      <span style={{ fontSize: 10, color: T.textMid, fontVariantNumeric: 'tabular-nums' }}>{w}%</span>
    </div>
  );
}

/* ─── CSV export ─────────────────────────────────────────────── */
function buildCSV(rows, expiries) {
  const expLabels = ['Current Month', 'Next Month', 'Far Month'];
  const h1 = ['Trade Date', 'Underlying', ...expiries.flatMap((_, i) => [
    expLabels[i] || expiries[i], '', '', '', '', '', ''
  ]), 'Combined OI', '', ''];
  const h2 = ['', '', ...expiries.flatMap(() => [
    'PE', 'CE', 'PCR', 'Max Pain', 'MaxPain Drift %', 'Share COI PE %', 'Share COI CE %'
  ]), 'PE', 'CE', 'PCR'];
  const dataRows = rows.map((r) => {
    const cols = [r.trade_date, r.underlying ?? ''];
    r.expiry_data.forEach((ed) => {
      if (!ed) { cols.push('', '', '', '', '', '', ''); return; }
      cols.push(
        ed.pe ?? '', ed.ce ?? '',
        ed.pcr != null ? Number(ed.pcr).toFixed(3) : '',
        ed.max_pain ?? '',
        ed.maxpain_drift != null ? (ed.maxpain_drift * 100).toFixed(2) : '',
        ed.share_pe != null ? (ed.share_pe * 100).toFixed(2) : '',
        ed.share_ce != null ? (ed.share_ce * 100).toFixed(2) : '',
      );
    });
    cols.push(
      r.combined_pe ?? '', r.combined_ce ?? '',
      r.combined_pcr != null ? Number(r.combined_pcr).toFixed(3) : '',
    );
    return cols;
  });
  const escape = (v) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [h1, h2, ...dataRows].map((row) => row.map(escape).join(',')).join('\n');
}

/* ─── table cell style helpers ───────────────────────────────── */
const th = (extra = {}) => ({
  padding: '7px 12px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.textLo,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  background: T.surface,
  ...extra,
});

const td = (extra = {}) => ({
  padding: '6px 12px',
  fontSize: 11,
  letterSpacing: '0.03em',
  color: T.textMid,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  borderBottom: `1px solid ${T.border}`,
  ...extra,
});

const borderL = { borderLeft: `1px solid ${T.border}` };

/* ─── main component ─────────────────────────────────────────── */
export default function TickerAnalysisTable({ assetType, ticker, selectedExpiry, allExpiries }) {
  const expiries = useMemo(() => {
    const sorted = [...allExpiries].sort();
    const idx = sorted.indexOf(selectedExpiry);
    if (idx === -1) return [selectedExpiry];
    return sorted.slice(idx, idx + 3);
  }, [allExpiries, selectedExpiry]);

  const { derivedStart, derivedEnd } = useMemo(() => {
    const sorted = [...allExpiries].sort();
    const idx = sorted.indexOf(selectedExpiry);
    let derivedStart = '';
    if (idx > 0) {
      const prev = new Date(sorted[idx - 1]);
      prev.setDate(prev.getDate() + 1);
      derivedStart = prev.toISOString().slice(0, 10);
    }
    return { derivedStart, derivedEnd: selectedExpiry };
  }, [allExpiries, selectedExpiry]);

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    if (!ticker || !expiries?.length) return;
    let mounted = true;
    setRows([]);
    setLoading(true);
    setError('');
    getTickerAnalysis(assetType, ticker, expiries, derivedStart, derivedEnd)
      .then((data) => { if (mounted) setRows(data); })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load analysis'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [assetType, ticker, selectedExpiry, derivedStart, derivedEnd]);

  const sortedRows = useMemo(() =>
    [...rows].sort((a, b) =>
      sortDir === 'desc'
        ? b.trade_date.localeCompare(a.trade_date)
        : a.trade_date.localeCompare(b.trade_date)
    ),
  [rows, sortDir]);

  const expLabels = ['Current Month', 'Next Month', 'Far Month'];

  function downloadCSV() {
    const csv  = buildCSV(sortedRows, expiries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${ticker}_ticker_analysis_${derivedStart || 'all'}_${derivedEnd || 'all'}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  /* ── loading / error / empty ── */
  if (loading) return (
    <div style={{ ...panelStyle, minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <LoadingSpinner />
    </div>
  );

  if (error) return (
    <div style={{ ...panelStyle, padding: 16, borderLeft: `3px solid ${T.red}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: T.red, marginBottom: 6, textTransform: 'uppercase' }}>Error</div>
      <div style={{ fontSize: 11, color: T.textMid }}>{error}</div>
    </div>
  );

  if (!rows.length) return (
    <div style={{ ...panelStyle, padding: 32 }}>
      <span style={{ fontSize: 11, color: T.textLo, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        No data for selected range
      </span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: monoFont }}>

      {/* ── toolbar ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.textHi, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {ticker}
          </span>
          <span style={{ fontSize: 10, color: T.textLo, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
            Multi-Expiry OI Analysis
          </span>
          <span style={{
            fontSize: 9,
            color: T.textLo,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            border: `1px solid ${T.border}`,
            padding: '2px 8px',
          }}>
            {rows.length} days
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            style={{
              padding: '4px 11px',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              border: `1px solid ${T.border}`,
              background: 'transparent',
              color: T.textMid,
              cursor: 'pointer',
              fontFamily: monoFont,
              borderRadius: 0,
            }}
          >
            Date {sortDir === 'desc' ? '↓' : '↑'} {sortDir === 'desc' ? 'Newest' : 'Oldest'}
          </button>
          <button
            onClick={downloadCSV}
            style={{
              padding: '4px 11px',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              border: `1px solid ${T.amber}`,
              background: T.amberDim,
              color: T.amber,
              cursor: 'pointer',
              fontFamily: monoFont,
              borderRadius: 0,
            }}
          >
            ↓ CSV
          </button>
        </div>
      </div>

      {/* ── PCR legend ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textLo }}>PCR</span>
        {[
          ['>1.2', T.green,  'Bullish'],
          ['0.8–1.2', T.orange, 'Neutral'],
          ['<0.8', T.red,   'Bearish'],
        ].map(([range, color, label]) => (
          <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, background: color }} />
            <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {range} {label}
            </span>
          </div>
        ))}
        <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textLo, marginLeft: 8 }}>Max Pain Drift</span>
        <span style={{ fontSize: 9, color: T.red,   letterSpacing: '0.08em', textTransform: 'uppercase' }}>↑ above underlying</span>
        <span style={{ fontSize: 9, color: T.green, letterSpacing: '0.08em', textTransform: 'uppercase' }}>↓ below underlying</span>
      </div>

      {/* ── table ── */}
      <div style={{ ...panelStyle, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: monoFont }}>
            <thead>
              {/* group header */}
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={{ ...th({ textAlign: 'left' }), position: 'sticky', left: 0 }}>Date</th>
                <th style={th()}>Underlying</th>
                {expiries.map((exp, i) => (
                  <th
                    key={exp}
                    colSpan={7}
                    style={{
                      ...th({ textAlign: 'center', color: EXP_COLORS[i] }),
                      ...borderL,
                    }}
                  >
                    {expLabels[i] || exp} · {exp}
                  </th>
                ))}
                <th colSpan={3} style={{ ...th({ textAlign: 'center', color: T.textHi }), ...borderL }}>
                  Combined OI
                </th>
              </tr>
              {/* column header */}
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.02)' }}>
                <th style={{ ...th({ textAlign: 'left' }), position: 'sticky', left: 0 }} />
                <th style={th()} />
                {expiries.map((exp) => (
                  <Fragment key={exp}>
                    <th style={{ ...th(), ...borderL }}>PE OI</th>
                    <th style={th()}>CE OI</th>
                    <th style={th()}>PCR</th>
                    <th style={th()}>Max Pain</th>
                    <th style={th()}>MP Drift</th>
                    <th style={th()}>COI%PE</th>
                    <th style={th()}>COI%CE</th>
                  </Fragment>
                ))}
                <th style={{ ...th(), ...borderL }}>PE</th>
                <th style={th()}>CE</th>
                <th style={th()}>PCR</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, ri) => (
                <tr
                  key={row.trade_date}
                  style={{ background: ri % 2 === 1 ? T.surfaceAlt : 'transparent' }}
                >
                  {/* date */}
                  <td style={{
                    ...td({ textAlign: 'left', color: T.textHi, fontWeight: 600, position: 'sticky', left: 0, background: T.surface }),
                  }}>
                    {row.trade_date}
                  </td>

                  {/* underlying */}
                  <td style={td({ color: T.gold })}>
                    {fmtCurrency(row.underlying)}
                  </td>

                  {/* per-expiry columns */}
                  {row.expiry_data.map((ed, ei) => {
                    if (!ed) return (
                      <Fragment key={`empty-${ei}`}>
                        {[...Array(7)].map((_, k) => (
                          <td key={k} style={{ ...td(), ...(k === 0 ? borderL : {}), color: T.textGhost, textAlign: 'center' }}>—</td>
                        ))}
                      </Fragment>
                    );
                    return (
                      <Fragment key={`ed-${ei}`}>
                        <td style={{ ...td({ color: T.magenta }), ...borderL }}>{fmt(ed.pe)}</td>
                        <td style={td({ color: T.blue })}>{fmt(ed.ce)}</td>
                        <td style={td({ color: pcrColor(ed.pcr), fontWeight: 600 })}>{fmtPCR(ed.pcr)}</td>
                        <td style={td({ color: T.pink })}>{fmtCurrency(ed.max_pain)}</td>
                        <td style={td({ color: driftColor(ed.maxpain_drift), fontWeight: 500 })}>{fmtPct(ed.maxpain_drift)}</td>
                        <td style={td({ textAlign: 'left' })}><ShareBar share={ed.share_pe} color={T.magenta} /></td>
                        <td style={td({ textAlign: 'left' })}><ShareBar share={ed.share_ce} color={T.blue} /></td>
                      </Fragment>
                    );
                  })}

                  {/* combined */}
                  <td style={{ ...td({ color: T.magenta }), ...borderL }}>{fmt(row.combined_pe)}</td>
                  <td style={td({ color: T.blue })}>{fmt(row.combined_ce)}</td>
                  <td style={td({ color: pcrColor(row.combined_pcr), fontWeight: 600 })}>{fmtPCR(row.combined_pcr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const panelStyle = {
  background: '#0b0f16',
  border: '1px solid rgba(255,255,255,0.07)',
};
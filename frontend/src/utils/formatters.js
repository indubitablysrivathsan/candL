// frontend/src/utils/formatters.js
// Shared number/date formatting helpers used across all terminal pages.
// See frontend/CONTEXT.md for usage guidance.

import { T } from '../theme';

// Plain locale-formatted number. dec = decimal places (default 0).
export const fmt = (n, dec = 0) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });

// Integer formatter (no decimals).
export const fmtInt = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Compact K/L (thousand/lakh) formatter for large contract/volume counts.
export const fmtK = (v) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_00_000) return `${(v / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)    return `${(v / 1_000).toFixed(1)}K`;
  return fmtInt(v);
};

// Currency in ₹ Crores.
export const fmtCr = (v, dec = 1) => v == null ? '—' : `₹${fmt(v, dec)} Cr`;

// '+' prefix for positive values, '' otherwise (no digits).
export const sign = (v) => v == null ? '' : v >= 0 ? '+' : '';

// '+'-prefixed compact value, e.g. "+1.2K" / "-340".
export const signed = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + fmtK(v);

// Color by sign — green/red/dim-gray.
export const netCol = (v) => v == null ? T.textLo : v >= 0 ? T.green : T.red;
export const netBg  = (v) => v == null ? 'transparent' : v >= 0 ? T.greenDim : T.redDim;
export const pctColor = (v) => v > 0 ? T.green : v < 0 ? T.red : T.textLo;
export const pctSign  = (v) => v > 0 ? '+' : '';

export const subtractDays = (dateStr, n) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

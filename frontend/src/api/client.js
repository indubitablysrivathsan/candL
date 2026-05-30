// frontend/src/api/client.js

const API_BASE = '';

async function request(url) {
  const response = await fetch(`${API_BASE}${url}`);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data?.detail) message = data.detail;
    } catch (_) {
      // ignore json parse failure
    }
    throw new Error(message);
  }

  return response.json();
}

/* =========================================
   HEALTH
========================================= */

export async function healthCheck() {
  return request('/health');
}

/* =========================================
   DISCOVERY
   Works for: options | index_options | futures | index_futures
========================================= */

export const discovery = {
  /** All tickers grouped by asset type. Pass assetType to filter. */
  tickers: (assetType = null) => {
    const p = assetType ? `?asset_type=${encodeURIComponent(assetType)}` : '';
    return request(`/discovery/tickers${p}`);
  },

  /** Most recent available date per data domain. */
  dates: () =>
    request('/discovery/dates'),

  /** What's available for a single ticker across all asset types. */
  tickerInfo: (ticker) =>
    request(`/discovery/ticker/${encodeURIComponent(ticker)}`),

  /** Row count summary per table for a date range — ingestion sanity check. */
  coverage: (startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/discovery/coverage?${p}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────────────────────────────────────

export const admin = {
  /** Processing status for every data domain on a given trade date. */
  status: (tradeDate) =>
    request(`/admin/status/${encodeURIComponent(tradeDate)}`),
};

export async function getTickers(assetType = 'stock_options') {
  return request(`/api/v1/${assetType}/tickers`);
}

function _sortExpiries(expiries) {
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const future = [];
  const past = [];

  for (const exp of expiries) {
    const d = new Date(exp);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    if (monthStart >= currentMonthStart) {
      future.push(exp);
    } else {
      past.push(exp);
    }
  }

  // future/current ascending, past descending
  future.sort((a, b) => new Date(a) - new Date(b));
  past.sort((a, b) => new Date(b) - new Date(a));

  return [...future, ...past];
}

export async function getExpiries(assetType = 'stock_options', ticker) {
  if (!ticker) throw new Error('Ticker required');
  const res = await request(`/api/v1/${assetType}/expiries/${encodeURIComponent(ticker)}`);
  return { ...res, expiries: _sortExpiries(res?.expiries ?? []) };
}

export async function getDates(assetType = 'stock_options', ticker, expiry) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');
  return request(
    `/api/v1/${assetType}/dates/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}`
  );
}

/* =========================================
   OPTIONS SNAPSHOT
   Works for: options | index_options
========================================= */

export async function getSnapshot(assetType = 'stock_options', ticker, expiry, tradeDate) {
  if (!ticker || !expiry || !tradeDate) throw new Error('Ticker, expiry and trade date required');
  return request(
    `/api/v1/${assetType}/snapshot/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}/${encodeURIComponent(tradeDate)}`
  );
}

/* =========================================
   ANALYTICS
   Works for: options | index_options
========================================= */

export async function getAnalytics(assetType = 'stock_options', ticker, expiry, startDate, endDate) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');

  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate)   params.append('end_date',   endDate);
  const query = params.toString();

  return request(
    `/api/v1/${assetType}/analytics/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}${query ? `?${query}` : ''}`
  );
}

/* =========================================
   DAILY EXPIRY SNAPSHOT
   Works for: options | index_options
========================================= */

export async function getDailyExpirySnapshot(assetType = 'stock_options', expiry, tradeDate) {
  if (!expiry || !tradeDate) throw new Error('Expiry and trade date required');
  return request(
    `/api/v1/${assetType}/daily-expiry-snapshot/${encodeURIComponent(expiry)}/${encodeURIComponent(tradeDate)}`
  );
}

/* =========================================
   RAW DATA
   Works for: options | index_options
========================================= */

export async function getRawData(assetType = 'stock_options', ticker, expiry, startDate, endDate) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');

  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate)   params.append('end_date',   endDate);
  const query = params.toString();

  return request(
    `/api/v1/${assetType}/data/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}${query ? `?${query}` : ''}`
  );
}

/* =========================================
   CHART SCALE
   Works for: options | index_options
========================================= */

export async function getChartScale(assetType = 'stock_options', ticker, expiry, startDate, endDate, metric) {
  if (!ticker || !expiry || !startDate || !endDate || !metric) {
    throw new Error('All parameters required for chart scale');
  }

  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, metric });
  return request(
    `/api/v1/${assetType}/chart-scale/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}?${params}`
  );
}

/* =========================================
   TICKER ANALYSIS
   Fetches analytics for multiple expiries in parallel,
   merges by trade_date, computes COI shares + maxpain drift.
========================================= */

export async function getTickerAnalysis(assetType, ticker, expiries, startDate, endDate) {
  if (!ticker || !expiries?.length) throw new Error('Ticker and expiries required');
  const sortedExpiries = [...expiries].sort((a, b) => new Date(a) - new Date(b));

  // fetch all expiries in parallel using the sorted order
  const results = await Promise.all(
    sortedExpiries.map((expiry) => {
      return getAnalytics(assetType, ticker, expiry, startDate, endDate);
    })
  );

  // build a map: trade_date → { expiry: rowData }
  const byDate = {};
  results.forEach((res, i) => {
    const expiry = sortedExpiries[i];
    (res?.rows || []).forEach((row) => {
      const d = row.trade_date;
      if (!byDate[d]) byDate[d] = { trade_date: d };
      byDate[d][expiry] = row;
    });
  });

  // sorted dates
  const dates = Object.keys(byDate).sort();

  return dates.map((d) => {
    const entry = byDate[d];

    // combined OI
    let combinedPE = 0, combinedCE = 0;
    sortedExpiries.forEach((exp) => {
      combinedPE += Number(entry[exp]?.pe ?? 0);
      combinedCE += Number(entry[exp]?.ce ?? 0);
    });
    const combinedPCR = combinedCE > 0 ? combinedPE / combinedCE : null;

    const expiryData = sortedExpiries.map((exp) => {
      const row = entry[exp];
      if (!row) return null;
      const pe  = Number(row.pe ?? 0);
      const ce  = Number(row.ce ?? 0);
      const underlying = Number(row.underlying ?? 0);
      const max_pain   = Number(row.max_pain ?? 0);
      return {
        pe,
        ce,
        pcr:         row.pcr != null ? Number(row.pcr) : null,
        max_pain:   row.max_pain,
        underlying: row.underlying,
        maxpain_drift: (underlying > 0 && row.max_pain != null)
          ? (max_pain - underlying) / underlying
          : null,
        share_pe: combinedPE > 0 ? pe / combinedPE : null,
        share_ce: combinedCE > 0 ? ce / combinedCE : null,
      };
    });

    // underlying lives on whichever expiry has it (same value across all)
    const underlying = sortedExpiries.map(exp => entry[exp]?.underlying).find(v => v != null) ?? null;

    return {
      trade_date: d,
      underlying,
      expiries: sortedExpiries,   // Now properly maps parallel to [Current, Next, Far]
      expiry_data: expiryData, 
      combined_pe:  combinedPE,
      combined_ce:  combinedCE,
      combined_pcr: combinedPCR,
    };
  });
}

/* =========================================
   OPTIONS CYCLE
   Works for: options | index_options
========================================= */

export const OPTIONS_COMBINED_TICKER = '__OPTIONS_COMBINED__';

export async function getOptionsCycleHistory(assetType = 'stock_options', ticker) {
  if (!ticker) throw new Error('Ticker required');
  return request(`/api/v1/${assetType}/cycle-history/${encodeURIComponent(ticker)}`);
}

export async function getOptionsCombinedHistory(assetType = 'stock_options', allDates = [], expiry = '') {
  // Use daily-expiry-snapshot per date to get all tickers, sum ce_oi + pe_oi
  const results = await Promise.all(
    allDates.map((date) =>
      request(`/api/v1/${assetType}/daily-expiry-snapshot/${encodeURIComponent(expiry)}/${encodeURIComponent(date)}`)
        .then((res) => {
          const rows = res?.rows ?? [];
          const ce = rows.reduce((s, r) => s + (Number(r.ce) || 0), 0);
          const pe = rows.reduce((s, r) => s + (Number(r.pe) || 0), 0);
          return { date, ce, pe };
        })
        .catch(() => ({ date, ce: 0, pe: 0 }))
    )
  );
  return {
    rows: results.map(({ date, ce, pe }) => ({
      trade_date: date,
      expiry:     expiry,
      ce_oi:      ce,
      pe_oi:      pe,
    })),
  };
}

export async function getOptionsMarketHistory(assetType = 'stock_options') {
  return request(`/api/v1/${assetType}/market-history`);
}

/* =========================================
   FUTURES ANALYTICS
   Works for: futures | index_futures
========================================= */

export async function getFuturesAnalytics(assetType = 'stock_futures', ticker, expiry) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');
  return request(
    `/api/v1/${assetType}/analytics/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}`
  );
}

/* =========================================
   FUTURES ROLLUP
   Works for: futures | index_futures
========================================= */

export async function getFuturesRollup(assetType = 'stock_futures', tradeDate, ticker = null) {
  if (!tradeDate) throw new Error('Trade date required');
  const path = ticker
    ? `/api/v1/${assetType}/rollup/${encodeURIComponent(tradeDate)}/${encodeURIComponent(ticker)}`
    : `/api/v1/${assetType}/rollup/${encodeURIComponent(tradeDate)}`;

  return request(path);
}

/* =========================================
   FUTURES CYCLE
   Works for: futures | index_futures
========================================= */

export async function getFuturesCycleHistory(
  assetType = 'stock_futures',
  ticker
) {
  if (!ticker) {
    throw new Error('Ticker required');
  }

  return request(
    `/api/v1/${assetType}/cycle-history/${encodeURIComponent(ticker)}`
  );
}

export const FUTURES_COMBINED_TICKER = '__FUTURES_COMBINED__';

export async function getFuturesCombinedHistory(assetType = 'stock_futures', allDates = []) {
  // Fetch rollup for every trading date and sum open_int across all tickers
  const results = await Promise.all(
    allDates.map((date) =>
      getFuturesRollup(assetType, date)
        .then((res) => {
          const rows = res?.rows ?? [];
          const total = rows.reduce((sum, r) => sum + (Number(r.open_int) || 0), 0);
          return { date, total };
        })
        .catch(() => ({ date, total: 0 }))
    )
  );
  // Return in same shape as cycle-history rows so ScreenerOIChart can reuse logic
  return {
    rows: results.map(({ date, total }) => ({
      trade_date: date,
      expiry: null,
      open_int: total,
    })),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// STOCKS (EQ)
// ─────────────────────────────────────────────────────────────────────────────

export const stocks = {
  tickers: () =>
    request('/stocks/tickers'),

  dates: () =>
    request('/stocks/dates'),

  ohlc: (ticker, startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/stocks/${encodeURIComponent(ticker)}/ohlc?${p}`);
  },

  rolling: (ticker, startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/stocks/${encodeURIComponent(ticker)}/rolling?${p}`);
  },

  snapshot: (tradeDate, limit = 200) => {
    const p = new URLSearchParams({ trade_date: tradeDate, limit });
    return request(`/stocks/snapshot?${p}`);
  },

  deliveryLeaders: (tradeDate, topN = 50) => {
    const p = new URLSearchParams({ trade_date: tradeDate, top_n: topN });
    return request(`/stocks/delivery-leaders?${p}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PARTICIPANT ACTIVITY
// ─────────────────────────────────────────────────────────────────────────────

export const participant = {
  dates: () =>
    request('/participant/dates'),

  netOI: (startDate, endDate, assetClass = 'INDEX') => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate, asset_class: assetClass });
    return request(`/participant/net-oi?${p}`);
  },

  netVol: (startDate, endDate, assetClass = 'INDEX') => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate, asset_class: assetClass });
    return request(`/participant/net-vol?${p}`);
  },

  latest: (assetClass = 'INDEX') => {
    const p = new URLSearchParams({ asset_class: assetClass });
    return request(`/participant/latest?${p}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MARKET ACTIVITY
// ─────────────────────────────────────────────────────────────────────────────

export const market = {
  dates: () =>
    request('/market/dates'),

  indexNames: () =>
    request('/market/index-names'),

  summary: (startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/market/summary?${p}`);
  },

  indexHistory: (indexName, startDate, endDate) => {
    const p = new URLSearchParams({ index_name: indexName, start_date: startDate, end_date: endDate });
    return request(`/market/index-history?${p}`);
  },

  indexSnapshot: (tradeDate) => {
    const p = new URLSearchParams({ trade_date: tradeDate });
    return request(`/market/index-snapshot?${p}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FII STATISTICS
// ─────────────────────────────────────────────────────────────────────────────

export const fii = {
  dates: () =>
    request('/fii/dates'),

  instruments: () =>
    request('/fii/instruments'),

  stats: (startDate, endDate, instruments) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    if (instruments?.length) p.append('instruments', instruments.join(','));
    return request(`/fii/stats?${p}`);
  },

  indexFlow: (startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/fii/index-flow?${p}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// VOLATILITY
// ─────────────────────────────────────────────────────────────────────────────

export const volatility = {
  tickers: () =>
    request('/volatility/tickers'),

  dates: () =>
    request('/volatility/dates'),

  series: (ticker, startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/volatility/${encodeURIComponent(ticker)}?${p}`);
  },

  snapshot: (tradeDate, topN = 50) => {
    const p = new URLSearchParams({ trade_date: tradeDate, top_n: topN });
    return request(`/volatility/snapshot?${p}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH
// ─────────────────────────────────────────────────────────────────────────────

export const research = {
  fiiVsNifty: (startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/research/fii-vs-nifty?${p}`);
  },
};


/* =========================================
   MARKET DATES
   Works for: futures | index_futures
========================================= */

export async function getMarketDates(assetType = 'stock_futures') {
  return request(`/api/v1/${assetType}/market-dates`);
}

/* =========================================
   HELPERS
========================================= */

export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `₹${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function getMetricFields(metric) {
  switch (metric) {
    case 'oi':      return { ce: 'ce_oi',      pe: 'pe_oi'      };
    case 'oi_chng': return { ce: 'ce_oi_chng', pe: 'pe_oi_chng' };
    case 'vol':     return { ce: 'ce_vol',      pe: 'pe_vol'     };
    default:        return { ce: 'ce_oi',       pe: 'pe_oi'      };
  }
}

export function getMetricLabel(metric) {
  switch (metric) {
    case 'oi':                     return 'Open Interest';
    case 'oi_chng':                return 'OI Change';
    case 'vol':                    return 'Volume';
    case 'ts':                     return 'Time Series';
    case 'daily_expiry_snapshot':  return 'Daily Expiry Snapshot';
    default:                       return metric;
  }
}

export function getMetricColors(metric) {
  switch (metric) {
    case 'oi':      return { ce: '#00B0F0', pe: '#FF00FF' };
    case 'oi_chng': return { ce: '#92D050', pe: '#E46C0A' };
    case 'vol':     return { ce: '#26a69a', pe: '#ef5350' };
    default:        return { ce: '#00B0F0', pe: '#FF00FF' };
  }
}

export const QUADRANT_META = {
  long_buildup:   { label: 'Long Buildup',   color: '#92D050', desc: '+OI  +Price' },
  short_buildup:  { label: 'Short Buildup',  color: '#ef5350', desc: '+OI  −Price' },
  short_covering: { label: 'Short Covering', color: '#26a69a', desc: '−OI  +Price' },
  long_unwinding: { label: 'Long Unwinding', color: '#FFA726', desc: '−OI  −Price' },
};

export function calculateTotals(snapshotData, metric) {
  if (!snapshotData?.strikes?.length) return { ceTotal: 0, peTotal: 0 };

  const fields = getMetricFields(metric);
  let ceTotal = 0;
  let peTotal = 0;

  snapshotData.strikes.forEach((strike) => {
    ceTotal += Number(strike[fields.ce] || 0);
    peTotal += Number(strike[fields.pe] || 0);
  });

  return { ceTotal, peTotal };
}

export function findATMStrike(strikes, underlying) {
  if (!strikes?.length || underlying == null) return null;

  let closest = strikes[0];
  let minDiff = Math.abs(Number(strikes[0].strike) - Number(underlying));

  for (const strike of strikes) {
    const diff = Math.abs(Number(strike.strike) - Number(underlying));
    if (diff < minDiff) { closest = strike; minDiff = diff; }
  }

  return closest?.strike ?? null;
}
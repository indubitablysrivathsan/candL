// frontend/src/api/client.js

const API_BASE =
  import.meta.env.VITE_API_URL
  || 'http://127.0.0.1:8000/api/v1';

export async function request(url) {
  const response = await fetch(`${API_BASE}${url}`);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const data = await response.json();
      if (data?.detail) message = data.detail;
    } catch (_) {}

    throw new Error(message);
  }

  return response.json();
}

/* =========================================
   HEALTH
========================================= */

export async function healthCheck() {
  return fetch('/health').then(r => r.json());
}

/* =========================================
   DISCOVERY
   GET /api/v1/discovery/tickers
   GET /api/v1/discovery/dates
   GET /api/v1/discovery/ticker/{ticker}
   GET /api/v1/discovery/coverage
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

/* =========================================
   ADMIN
   GET /api/v1/admin/status/{trade_date}
========================================= */

export const admin = {
  /** Processing status for every data domain on a given trade date. */
  status: (tradeDate) =>
    request(`/admin/status/${encodeURIComponent(tradeDate)}`),
};

/* =========================================
   F&O — TICKERS / EXPIRIES / DATES
   Works for: stock_options | index_options | stock_futures | index_futures
   GET /api/v1/{assetType}/tickers
   GET /api/v1/{assetType}/expiries/{ticker}
   GET /api/v1/{assetType}/dates/{ticker}/{expiry}
   GET /api/v1/{assetType}/market-dates
========================================= */

export async function getTickers(assetType = 'stock_options') {
  return request(`/${assetType}/tickers`);
}

function _sortExpiries(expiries) {
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const future = [];
  const past   = [];

  for (const exp of expiries) {
    const d          = new Date(exp);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    if (monthStart >= currentMonthStart) {
      future.push(exp);
    } else {
      past.push(exp);
    }
  }

  future.sort((a, b) => new Date(a) - new Date(b));
  past.sort((a, b)   => new Date(b) - new Date(a));

  return [...future, ...past];
}

export async function getExpiries(assetType = 'stock_options', ticker = null) {
  const endpoint = ticker
    ? `/${assetType}/expiries/${encodeURIComponent(ticker)}`
    : `/${assetType}/expiries`;

  const res = await request(endpoint);

  return {
    ...res,
    expiries: _sortExpiries(res?.expiries ?? []),
  };
}

export async function getDates(assetType = 'stock_options', expiry, ticker = null) {
  if (!expiry) throw new Error('Expiry required');

  const endpoint = ticker
    ? `/${assetType}/dates/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}`
    : `/${assetType}/dates/${encodeURIComponent(expiry)}`;

  return request(endpoint);
}

export async function getMarketDates(assetType = 'stock_futures') {
  return request(`/${assetType}/market-dates`);
}

/* =========================================
   OPTIONS — SNAPSHOT
   GET /api/v1/{assetType}/snapshot/{ticker}/{expiry}/{tradeDate}
========================================= */

export async function getSnapshot(assetType = 'stock_options', ticker, expiry, tradeDate) {
  if (!ticker || !expiry || !tradeDate) throw new Error('Ticker, expiry and trade date required');
  return request(
    `/${assetType}/snapshot/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}/${encodeURIComponent(tradeDate)}`
  );
}

/* =========================================
   OPTIONS — ANALYTICS
   GET /api/v1/{assetType}/analytics/{ticker}/{expiry}
========================================= */

export async function getAnalytics(assetType = 'stock_options', ticker, expiry, startDate, endDate) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');

  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate)   params.append('end_date',   endDate);
  const query = params.toString();

  return request(
    `/${assetType}/analytics/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}${query ? `?${query}` : ''}`
  );
}

/* =========================================
   OPTIONS — DAILY EXPIRY SNAPSHOT
   GET /api/v1/{assetType}/daily-expiry-snapshot/{expiry}/{tradeDate}
========================================= */

export async function getDailyExpirySnapshot(assetType = 'stock_options', expiry, tradeDate) {
  if (!expiry || !tradeDate) throw new Error('Expiry and trade date required');
  return request(
    `/${assetType}/daily-expiry-snapshot/${encodeURIComponent(expiry)}/${encodeURIComponent(tradeDate)}`
  );
}

/* =========================================
   OPTIONS — RAW DATA
   GET /api/v1/{assetType}/data/{ticker}/{expiry}
========================================= */

export async function getRawData(assetType = 'stock_options', ticker, expiry, startDate, endDate) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');

  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate)   params.append('end_date',   endDate);
  const query = params.toString();

  return request(
    `/${assetType}/data/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}${query ? `?${query}` : ''}`
  );
}

/* =========================================
   OPTIONS — CHART SCALE
   GET /api/v1/{assetType}/chart-scale/{ticker}/{expiry}
========================================= */

export async function getChartScale(assetType = 'stock_options', ticker, expiry, startDate, endDate, metric) {
  if (!ticker || !expiry || !startDate || !endDate || !metric) {
    throw new Error('All parameters required for chart scale');
  }

  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, metric });
  return request(
    `/${assetType}/chart-scale/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}?${params}`
  );
}

/* =========================================
   OPTIONS — TICKER ANALYSIS
   Fetches analytics for multiple expiries in parallel,
   merges by trade_date, computes combined OI shares + maxpain drift.
========================================= */

export async function getTickerAnalysis(assetType, ticker, expiries, startDate, endDate) {
  if (!ticker || !expiries?.length) throw new Error('Ticker and expiries required');
  const sortedExpiries = [...expiries].sort((a, b) => new Date(a) - new Date(b));

  const results = await Promise.all(
    sortedExpiries.map((expiry) => getAnalytics(assetType, ticker, expiry, startDate, endDate))
  );

  const byDate = {};
  results.forEach((res, i) => {
    const expiry = sortedExpiries[i];
    (res?.rows || []).forEach((row) => {
      const d = row.trade_date;
      if (!byDate[d]) byDate[d] = { trade_date: d };
      byDate[d][expiry] = row;
    });
  });

  const dates = Object.keys(byDate).sort();

  return dates.map((d) => {
    const entry = byDate[d];

    let combinedPE = 0, combinedCE = 0;
    sortedExpiries.forEach((exp) => {
      combinedPE += Number(entry[exp]?.pe ?? 0);
      combinedCE += Number(entry[exp]?.ce ?? 0);
    });
    const combinedPCR = combinedCE > 0 ? combinedPE / combinedCE : null;

    const expiryData = sortedExpiries.map((exp) => {
      const row = entry[exp];
      if (!row) return null;
      const pe         = Number(row.pe ?? 0);
      const ce         = Number(row.ce ?? 0);
      const underlying = Number(row.underlying ?? 0);
      const max_pain   = Number(row.max_pain ?? 0);
      return {
        pe,
        ce,
        pcr:           row.pcr != null ? Number(row.pcr) : null,
        max_pain:      row.max_pain,
        underlying:    row.underlying,
        maxpain_drift: (underlying > 0 && row.max_pain != null)
          ? (max_pain - underlying) / underlying
          : null,
        share_pe: combinedPE > 0 ? pe / combinedPE : null,
        share_ce: combinedCE > 0 ? ce / combinedCE : null,
      };
    });

    const underlying = sortedExpiries
      .map((exp) => entry[exp]?.underlying)
      .find((v) => v != null) ?? null;

    return {
      trade_date:   d,
      underlying,
      expiries:     sortedExpiries,
      expiry_data:  expiryData,
      combined_pe:  combinedPE,
      combined_ce:  combinedCE,
      combined_pcr: combinedPCR,
    };
  });
}

/* =========================================
   OPTIONS — CYCLE HISTORY
   GET /api/v1/{assetType}/cycle-history/{ticker}
   GET /api/v1/{assetType}/market-history
========================================= */

export const OPTIONS_COMBINED_TICKER = '__OPTIONS_COMBINED__';

export async function getOptionsCycleHistory(assetType = 'stock_options', ticker) {
  if (!ticker) throw new Error('Ticker required');
  return request(`/${assetType}/cycle-history/${encodeURIComponent(ticker)}`);
}

export async function getOptionsCombinedHistory(assetType = 'stock_options', allDates = [], expiry = '') {
  const results = await Promise.all(
    allDates.map((date) =>
      request(`/${assetType}/daily-expiry-snapshot/${encodeURIComponent(expiry)}/${encodeURIComponent(date)}`)
        .then((res) => {
          const rows = res?.rows ?? [];
          const ce   = rows.reduce((s, r) => s + (Number(r.ce) || 0), 0);
          const pe   = rows.reduce((s, r) => s + (Number(r.pe) || 0), 0);
          return { date, ce, pe };
        })
        .catch(() => ({ date, ce: 0, pe: 0 }))
    )
  );
  return {
    rows: results.map(({ date, ce, pe }) => ({
      trade_date: date,
      expiry,
      ce_oi: ce,
      pe_oi: pe,
    })),
  };
}

export async function getOptionsMarketHistory(assetType = 'stock_options') {
  return request(`/${assetType}/market-history`);
}

/* =========================================
   FUTURES — ANALYTICS
   GET /api/v1/{assetType}/analytics/{ticker}/{expiry}
========================================= */

export async function getFuturesAnalytics(assetType = 'stock_futures', ticker, expiry) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');
  return request(
    `/${assetType}/analytics/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}`
  );
}

/* =========================================
   FUTURES — ROLLUP
   GET /api/v1/{assetType}/rollup/{tradeDate}
   GET /api/v1/{assetType}/rollup/{tradeDate}/{ticker}
========================================= */

export async function getFuturesRollup(assetType = 'stock_futures', tradeDate, ticker = null) {
  if (!tradeDate) throw new Error('Trade date required');
  const path = ticker
    ? `/${assetType}/rollup/${encodeURIComponent(tradeDate)}/${encodeURIComponent(ticker)}`
    : `/${assetType}/rollup/${encodeURIComponent(tradeDate)}`;
  return request(path);
}

/* =========================================
   FUTURES — CYCLE HISTORY
   GET /api/v1/{assetType}/cycle-history/{ticker}
========================================= */

export const FUTURES_COMBINED_TICKER = '__FUTURES_COMBINED__';

export async function getFuturesCycleHistory(assetType = 'stock_futures', ticker) {
  if (!ticker) throw new Error('Ticker required');
  return request(`/${assetType}/cycle-history/${encodeURIComponent(ticker)}`);
}

export async function getFuturesCombinedHistory(assetType = 'stock_futures', allDates = []) {
  const results = await Promise.all(
    allDates.map((date) =>
      getFuturesRollup(assetType, date)
        .then((res) => {
          const rows  = res?.rows ?? [];
          const total = rows.reduce((sum, r) => sum + (Number(r.open_int) || 0), 0);
          return { date, total };
        })
        .catch(() => ({ date, total: 0 }))
    )
  );
  return {
    rows: results.map(({ date, total }) => ({
      trade_date: date,
      expiry:     null,
      open_int:   total,
    })),
  };
}

/* =========================================
   STOCKS (EQ)
   GET /api/v1/stocks/tickers
   GET /api/v1/stocks/dates
   GET /api/v1/stocks/snapshot
   GET /api/v1/stocks/delivery-leaders
   GET /api/v1/stocks/{ticker}/ohlc
   GET /api/v1/stocks/{ticker}/rolling
========================================= */

export const stocks = {
  tickers: () =>
    request('/stocks/tickers'),

  dates: () =>
    request('/stocks/dates'),

  snapshot: (tradeDate, limit = 200) => {
    const p = new URLSearchParams({ trade_date: tradeDate, limit });
    return request(`/stocks/snapshot?${p}`);
  },

  deliveryLeaders: (tradeDate, topN = 50) => {
    const p = new URLSearchParams({ trade_date: tradeDate, top_n: topN });
    return request(`/stocks/delivery-leaders?${p}`);
  },

  ohlc: (ticker, startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/stocks/${encodeURIComponent(ticker)}/ohlc?${p}`);
  },

  rolling: (ticker, startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/stocks/${encodeURIComponent(ticker)}/rolling?${p}`);
  },
};


/* =========================================
   MARKET ACTIVITY
========================================= */

export const market = {
  // ── existing ──────────────────────────────────────────────────────────────

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

  // ── breadth ───────────────────────────────────────────────────────────────

  breadth: (startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/market/breadth?${p}`);
  },

  breadthSnapshot: (tradeDate) => {
    const p = new URLSearchParams({ trade_date: tradeDate });
    return request(`/market/breadth/snapshot?${p}`);
  },

  // ── top stocks ────────────────────────────────────────────────────────────

  /**
   * Top N stocks by turnover for a given date.
   * series defaults to 'EQ'. limit defaults to 25.
   */
  topStocks: (tradeDate, { series = 'EQ', limit = 25 } = {}) => {
    const p = new URLSearchParams({ trade_date: tradeDate, series, limit });
    return request(`/market/top-stocks?${p}`);
  },

  /**
   * Top gainers and losers by pct_change for a given date.
   * Returns { gainers: [...], losers: [...] }
   * minTurnover is in lacs.
   */
  topGainersLosers: (tradeDate, { series = 'EQ', limit = 10, minTurnover = 100.0 } = {}) => {
    const p = new URLSearchParams({
      trade_date:   tradeDate,
      series,
      limit,
      min_turnover: minTurnover,
    });
    return request(`/market/top-stocks/gainers-losers?${p}`);
  },

  // ── securities ────────────────────────────────────────────────────────────

  /**
   * All securities for a date sorted by turnover desc.
   * series defaults to 'EQ'. minTurnover is optional, in lacs.
   */
  securitySnapshot: (tradeDate, { series = 'EQ', minTurnover } = {}) => {
    const p = new URLSearchParams({ trade_date: tradeDate, series });
    if (minTurnover != null) p.append('min_turnover', minTurnover);
    return request(`/market/security/snapshot?${p}`);
  },

  /**
   * OHLC + delivery time series for a single symbol.
   * series defaults to 'EQ'.
   */
  securityHistory: (symbol, startDate, endDate, series = 'EQ') => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate, series });
    return request(`/market/security/${encodeURIComponent(symbol)}?${p}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PARTICIPANT ACTIVITY
//   GET /api/v1/participant/dates
//   GET /api/v1/participant/net-oi
//   GET /api/v1/participant/net-vol
//   GET /api/v1/participant/latest
//   GET /api/v1/participant/summary
// ─────────────────────────────────────────────────────────────────────────────
 
export const participant = {
  /**
   * All trade dates with participant activity data.
   * @returns {Promise<string[]>} sorted array of YYYY-MM-DD strings
   */
  dates: () => request('/participant/dates'),
 
  /**
   * Net OI time series (long − short) per participant, per day.
   * @param {string} startDate  YYYY-MM-DD
   * @param {string} endDate    YYYY-MM-DD
   * @param {'INDEX'|'STOCK'} assetClass
   * @returns rows: { trade_date, participant_type, option_side, long_contracts, short_contracts, net_contracts }
   */
  netOI: (startDate, endDate, assetClass = 'INDEX') => {
    const p = new URLSearchParams({
      start_date:  startDate,
      end_date:    endDate,
      asset_class: assetClass,
    });
    return request(`/participant/net-oi?${p}`);
  },
 
  /**
   * Net volume time series (buy − sell) per participant, per day.
   * Same shape as netOI.
   */
  netVol: (startDate, endDate, assetClass = 'INDEX') => {
    const p = new URLSearchParams({
      start_date:  startDate,
      end_date:    endDate,
      asset_class: assetClass,
    });
    return request(`/participant/net-vol?${p}`);
  },
 
  /**
   * Latest day's full OI breakdown — all participants × all sides.
   * @param {'INDEX'|'STOCK'} assetClass
   */
  latest: (assetClass = 'INDEX') => {
    const p = new URLSearchParams({ asset_class: assetClass });
    return request(`/participant/latest?${p}`);
  },
 
  /**
   * Single-day pivot table matching the NSE fao_participant_oi_*.csv layout.
   * Returns one row per participant with wide columns:
   *   fut_long, fut_short, fut_net,
   *   ce_long,  ce_short,  ce_net,
   *   pe_long,  pe_short,  pe_net,
   *   total_long, total_short, total_net
   *
   * @param {string} tradeDate  YYYY-MM-DD
   * @param {'INDEX'|'STOCK'} assetClass
   */
  summary: (tradeDate, assetClass = 'INDEX') => {
    const p = new URLSearchParams({
      trade_date:  tradeDate,
      asset_class: assetClass,
    });
    return request(`/participant/summary?${p}`);
  },
};
 
// ─────────────────────────────────────────────────────────────────────────────
// FII STATISTICS
//   GET /api/v1/fii/dates
//   GET /api/v1/fii/instruments
//   GET /api/v1/fii/stats
//   GET /api/v1/fii/index-flow
//   GET /api/v1/fii/summary
// ─────────────────────────────────────────────────────────────────────────────
 
export const fii = {
  /** All trade dates with FII stats data. */
  dates: () => request('/fii/dates'),
 
  /** All instrument names present in fii_stats table. */
  instruments: () => request('/fii/instruments'),
 
  /**
   * FII buy/sell/OI stats for a date range.
   * Returns rows: { trade_date, instrument, buy_contracts, buy_amount_cr,
   *                 sell_contracts, sell_amount_cr, oi_contracts, oi_amount_cr,
   *                 net_contracts, net_amount_cr }
   *
   * @param {string}   startDate
   * @param {string}   endDate
   * @param {string[]} [instruments]  optional filter list
   */
  stats: (startDate, endDate, instruments) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    if (instruments?.length) p.append('instruments', instruments.join(','));
    return request(`/fii/stats?${p}`);
  },
 
  /**
   * FII net index futures positions over time.
   * Covers INDEX FUTURES + NIFTY FUTURES + BANKNIFTY FUTURES.
   * The primary institutional-flow signal.
   */
  indexFlow: (startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/fii/index-flow?${p}`);
  },
 
  /**
   * Single-day FII snapshot — all instruments with buy/sell/OI/net.
   * Mirrors the NSE fii_stats_*.xls table layout.
   * @param {string} tradeDate  YYYY-MM-DD
   */
  summary: (tradeDate) => {
    const p = new URLSearchParams({ trade_date: tradeDate });
    return request(`/fii/summary?${p}`);
  },
};
 
/* =========================================
   VOLATILITY
   GET /api/v1/volatility/tickers
   GET /api/v1/volatility/dates
   GET /api/v1/volatility/snapshot
   GET /api/v1/volatility/{ticker}
========================================= */

export const volatility = {
  tickers: () =>
    request('/volatility/tickers'),

  dates: () =>
    request('/volatility/dates'),

  snapshot: (tradeDate, topN = 50) => {
    const p = new URLSearchParams({ trade_date: tradeDate, top_n: topN });
    return request(`/volatility/snapshot?${p}`);
  },

  series: (ticker, startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/volatility/${encodeURIComponent(ticker)}?${p}`);
  },
};

/* =========================================
   RESEARCH
   GET /api/v1/research/fii-vs-nifty
========================================= */

export const research = {
  fiiVsNifty: (startDate, endDate) => {
    const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request(`/research/fii-vs-nifty?${p}`);
  },
};

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

export function formatK(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_00_000) return `${(v / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)    return `${(v /     1_000).toFixed(1)}K`;
  return formatNumber(v);
}
 
export function formatCr(v) {
  if (v == null) return '—';
  return `₹${formatNumber(v, 2)} Cr`;
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
    case 'oi':                    return 'Open Interest';
    case 'oi_chng':               return 'OI Change';
    case 'vol':                   return 'Volume';
    case 'ts':                    return 'Time Series';
    case 'daily_expiry_snapshot': return 'Daily Expiry Snapshot';
    default:                      return metric;
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
  let minDiff  = Math.abs(Number(strikes[0].strike) - Number(underlying));

  for (const strike of strikes) {
    const diff = Math.abs(Number(strike.strike) - Number(underlying));
    if (diff < minDiff) { closest = strike; minDiff = diff; }
  }

  return closest?.strike ?? null;
}
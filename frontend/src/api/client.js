// frontend/src/api/client.js

const API_BASE = '';

async function request(url) {
  const response = await fetch(`${API_BASE}${url}`);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const data = await response.json();

      if (data?.detail) {
        message = data.detail;
      }
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
========================================= */

export async function getTickers(assetType = 'options') {
  return request(`/api/v1/${assetType}/tickers`);
}

export async function getExpiries(assetType = 'options', ticker) {
  if (!ticker) {
    throw new Error('Ticker required');
  }

  return request(
    `/api/v1/${assetType}/expiries/${encodeURIComponent(ticker)}`
  );
}

export async function getDates(
  assetType = 'options',
  ticker,
  expiry
) {
  if (!ticker || !expiry) {
    throw new Error('Ticker and expiry required');
  }

  return request(
    `/api/v1/${assetType}/dates/${encodeURIComponent(
      ticker
    )}/${encodeURIComponent(expiry)}`
  );
}

/* =========================================
   OPTIONS SNAPSHOT
========================================= */

export async function getSnapshot(
  ticker,
  expiry,
  tradeDate
) {
  if (!ticker || !expiry || !tradeDate) {
    throw new Error('Ticker, expiry and trade date required');
  }

  return request(
    `/api/v1/options/snapshot/${encodeURIComponent(
      ticker
    )}/${encodeURIComponent(
      expiry
    )}/${encodeURIComponent(tradeDate)}`
  );
}

/* =========================================
   ANALYTICS
========================================= */

export async function getAnalytics(
  ticker,
  expiry,
  startDate,
  endDate
) {
  if (!ticker || !expiry) {
    throw new Error('Ticker and expiry required');
  }

  const params = new URLSearchParams();

  if (startDate) {
    params.append('start_date', startDate);
  }

  if (endDate) {
    params.append('end_date', endDate);
  }

  const query = params.toString();

  return request(
    `/api/v1/options/analytics/${encodeURIComponent(
      ticker
    )}/${encodeURIComponent(expiry)}${
      query ? `?${query}` : ''
    }`
  );
}

/* =========================================
   DAILY EXPIRY SNAPSHOT
========================================= */

export async function getDailyExpirySnapshot(
  expiry,
  tradeDate
) {
  if (!expiry || !tradeDate) {
    throw new Error('Expiry and trade date required');
  }

  return request(
    `/api/v1/options/daily-expiry-snapshot/${encodeURIComponent(
      expiry
    )}/${encodeURIComponent(tradeDate)}`
  );
}

/* =========================================
   RAW DATA
========================================= */

export async function getRawData(
  ticker,
  expiry,
  startDate,
  endDate
) {
  if (!ticker || !expiry) {
    throw new Error('Ticker and expiry required');
  }

  const params = new URLSearchParams();

  if (startDate) {
    params.append('start_date', startDate);
  }

  if (endDate) {
    params.append('end_date', endDate);
  }

  const query = params.toString();

  return request(
    `/api/v1/options/data/${encodeURIComponent(
      ticker
    )}/${encodeURIComponent(expiry)}${
      query ? `?${query}` : ''
    }`
  );
}

/* =========================================
   CHART SCALE
========================================= */

export async function getChartScale(ticker, expiry, startDate, endDate, metric) {
  if (!ticker || !expiry || !startDate || !endDate || !metric) {
    throw new Error('All parameters required for chart scale');
  }

  const params = new URLSearchParams({
    start_date: startDate,
    end_date:   endDate,
    metric,
  });

  return request(
    `/api/v1/options/chart-scale/${encodeURIComponent(
      ticker
    )}/${encodeURIComponent(expiry)}?${params}`
  );
}

/* =========================================
   FUTURES
========================================= */

export async function getFuturesAnalytics(ticker, expiry) {
  if (!ticker || !expiry) throw new Error('Ticker and expiry required');
  return request(
    `/api/v1/futures/analytics/${encodeURIComponent(ticker)}/${encodeURIComponent(expiry)}`
  );
}

export async function getFuturesRollup(tradeDate) {
  if (!tradeDate) throw new Error('Trade date required');
  return request(`/api/v1/futures/rollup/${encodeURIComponent(tradeDate)}`);
}

/* =========================================
   HELPERS
========================================= */

export function formatNumber(value, digits = 0) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  ) {
    return '--';
  }

  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatCurrency(value, digits = 2) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  ) {
    return '--';
  }

  return `₹${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

export function getMetricFields(metric) {
  switch (metric) {
    case 'oi':
      return { ce: 'ce_oi',      pe: 'pe_oi'      };
    case 'oi_chng':
      return { ce: 'ce_oi_chng', pe: 'pe_oi_chng' };
    case 'vol':
      return { ce: 'ce_vol',     pe: 'pe_vol'     };
    default:
      return { ce: 'ce_oi',      pe: 'pe_oi'      };
  }
}

export function getMetricLabel(metric) {
  switch (metric) {
    case 'oi':      return 'Open Interest';
    case 'oi_chng': return 'OI Change';
    case 'vol':     return 'Volume';
    case 'ts':      return 'Time Series';
    case 'daily_expiry_snapshot':  return 'Daily Expiry Snapshot';
    default:        return metric;
  }
}

export function getMetricColors(metric) {
  switch (metric) {
    case 'oi':
      return { ce: '#00B0F0', pe: '#FF00FF' };
    case 'oi_chng':
      return { ce: '#92D050', pe: '#E46C0A' };
    case 'vol':
      return { ce: '#26a69a', pe: '#ef5350' };
    default:
      return { ce: '#00B0F0', pe: '#FF00FF' };
  }
}

export const QUADRANT_META = {
  long_buildup:   { label: 'Long Buildup',   color: '#92D050', desc: '+OI  +Price' },
  short_buildup:  { label: 'Short Buildup',  color: '#ef5350', desc: '+OI  −Price' },
  short_covering: { label: 'Short Covering', color: '#26a69a', desc: '−OI  +Price' },
  long_unwinding: { label: 'Long Unwinding', color: '#FFA726', desc: '−OI  −Price' },
};

export function calculateTotals(snapshotData, metric) {
  if (!snapshotData?.strikes?.length) {
    return { ceTotal: 0, peTotal: 0 };
  }

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
  if (!strikes?.length || underlying == null) {
    return null;
  }

  let closest = strikes[0];
  let minDiff = Math.abs(Number(strikes[0].strike) - Number(underlying));

  for (const strike of strikes) {
    const diff = Math.abs(Number(strike.strike) - Number(underlying));
    if (diff < minDiff) {
      closest = strike;
      minDiff = diff;
    }
  }

  return closest?.strike ?? null;
}

export async function getFuturesMarketDates() {
  return request('/api/v1/futures/market-dates');
}
// frontend/src/pages/Futures.jsx

import { useEffect, useMemo, useState } from 'react';

import Sidebar from '../components/layout/Sidebar';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import MetricCard from '../components/shared/MetricCard';
import DateSlider from '../components/shared/DateSlider';

import {
  getTickers,
  getExpiries,
  getDates,
  getFuturesAnalytics,
  getFuturesRollup,
  getFuturesMarketDates,
  formatCurrency,
  formatNumber,
  QUADRANT_META,
} from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   QUADRANT ORDER + CONFIG
───────────────────────────────────────────────────────────────── */

const QUADRANTS = [
  'long_buildup',
  'short_buildup',
  'short_covering',
  'long_unwinding',
];

/** percentage change helper — returns formatted string or '--' */
const formatPercent = (value, decimals = 2) => {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) {
    return '--';
  }

  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(decimals)}%`;
};

/* ─────────────────────────────────────────────────────────────────
   ANALYTICS TIME SERIES PANEL
   Shows basis, cost-of-carry, and quadrant timeline for one expiry
───────────────────────────────────────────────────────────────── */

function AnalyticsPanel({ ticker, expiry }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // FIX: was missing entirely — panel was permanently stuck on loading
  useEffect(() => {
    if (!ticker || !expiry) return;

    let mounted = true;
    setLoading(true);
    setError('');
    setData([]);

    getFuturesAnalytics(ticker, expiry)
      .then((res) => {
        if (!mounted) return;
        setData(res?.rows || []);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [ticker, expiry]);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <LoadingSpinner />
    </div>
  );

  if (error) return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300 text-sm">
      {error}
    </div>
  );

  if (!data.length) return (
    <p className="text-white/50 text-sm py-8">No analytics data available.</p>
  );

  const latest = data[data.length - 1];

  return (
    <div className="space-y-4">
      {/* Summary cards for latest date */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard
          title="Close"
          value={formatCurrency(latest.close, 2)}
          accent="#00B0F0"
        />
        <MetricCard
          title="Basis"
          value={formatCurrency(latest.basis, 2)}
          accent={latest.basis >= 0 ? '#92D050' : '#ef5350'}
        />
        <MetricCard
          title="Cost of Carry"
          value={
            latest.cost_of_carry != null
              ? `${(Number(latest.cost_of_carry) * 100).toFixed(2)}%`
              : '--'
          }
          accent="#FFA726"
        />
        <MetricCard
          title="Signal"
          value={QUADRANT_META[latest.quadrant]?.label ?? '--'}
          accent={QUADRANT_META[latest.quadrant]?.color ?? '#ffffff'}
        />
      </div>

      {/* Rolling history table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            Rolling Analytics — {ticker} / {expiry}
          </h3>
          <button
            onClick={() => {
              const headers = [
                'Date','Close','Prev Close','Chng Price','Chng Price %',
                'Chng OI','Basis','CoC %','Vol/OI','DTE','Signal',
              ];
              const csvRows = [...data].reverse().map((row) => [
                row.trade_date,
                row.close ?? '',
                row.prev_close ?? '',
                row.chng_in_price ?? '',
                row.chng_price_per ?? '',
                row.chng_in_oi ?? '',
                row.chng_oi_per ?? '',
                row.basis ?? '',
                row.cost_of_carry != null ? (row.cost_of_carry * 100).toFixed(2) : '',
                row.volume_oi_ratio != null ? Number(row.volume_oi_ratio).toFixed(3) : '',
                row.days_to_expiry ?? '',
                row.quadrant ?? '',
              ].join(','));
              const csv  = [headers.join(','), ...csvRows].join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement('a');
              a.href     = url;
              a.download = `ticker_analytics_${ticker}_${expiry}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            className="px-4 py-2 rounded-xl border border-[#00B0F0]/25 bg-[#00B0F0]/10 text-[#00B0F0] text-sm transition hover:bg-[#00B0F0]/20"
          >
            Download CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Close</th>
                <th>Chng Price</th>
                <th>Chng Price %</th>
                <th>Chng OI</th>
                <th>Chng OI %</th>
                <th>Basis</th>
                <th>CoC %</th>
                <th>Vol/OI</th>
                <th>DTE</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row) => {
                // FIX: `activeQuadrant` doesn't exist in this scope;
                // look up meta per-row from the row's own quadrant value
                const meta =
                  QUADRANT_META[row.quadrant] ?? QUADRANT_META.long_buildup;
                return (
                  <tr key={row.trade_date}>
                    <td className="text-white/70">{row.trade_date}</td>
                    <td>{formatCurrency(row.close, 2)}</td>
                    <td className={row.chng_in_price >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {row.chng_in_price >= 0 ? '+' : ''}
                      {formatNumber(row.chng_in_price, 2)}
                    </td>
                    <td className={row.chng_price_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {formatPercent(row.chng_price_per)}
                    </td>
                    <td className={row.chng_in_oi >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {row.chng_in_oi >= 0 ? '+' : ''}
                      {formatNumber(row.chng_in_oi)}
                    </td>
                    <td className={row.chng_oi_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {formatPercent(row.chng_oi_per)}
                    </td>
                    <td className={row.basis >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {formatNumber(row.basis, 2)}
                    </td>
                    <td>
                      {row.cost_of_carry != null
                        ? `${(Number(row.cost_of_carry) * 100).toFixed(2)}%`
                        : '--'}
                    </td>
                    <td>
                      {row.volume_oi_ratio != null
                        ? Number(row.volume_oi_ratio).toFixed(3)
                        : '--'}
                    </td>
                    <td className="text-white/60">{row.days_to_expiry ?? '--'}</td>
                    <td>
                      <span
                        className="px-2 py-1 rounded-lg text-xs font-medium"
                        style={{
                          color:           meta.color,
                          backgroundColor: `${meta.color}18`,
                          border:          `1px solid ${meta.color}30`,
                        }}
                      >
                        {meta.label ?? row.quadrant}
                      </span>
                    </td>
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

/* ─────────────────────────────────────────────────────────────────
   ROLLUP SCREENER PANEL
   One date → all tickers, grouped into 4 quadrant tabs
───────────────────────────────────────────────────────────────── */

function RollupPanel({ allDates }) {
  const [selectedDate, setSelectedDate]         = useState('');
  const [pendingDate, setPendingDate]           = useState('');
  const [dateMode, setDateMode]                 =  useState('expiry');
  const [data, setData]                         = useState([]);
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState('');
  const [activeQuadrant, setActiveQuadrant]     = useState('long_buildup');

  const visibleDates = useMemo(() => {
    if (dateMode === 'full') {
      return allDates;
    }

    if (dateMode === '30d') {
      return allDates.slice(-30);
    }

    if (dateMode === '90d') {
      return allDates.slice(-90);
    }

    return allDates;
  }, [allDates, dateMode]);

  // Set default date to latest
  useEffect(() => {
    if (allDates.length > 0 && !selectedDate) {
      setSelectedDate(allDates[allDates.length - 1]);
    }
  }, [allDates, selectedDate]);

  useEffect(() => {
    if (!pendingDate) return;

    const timer = setTimeout(() => {
      setSelectedDate(pendingDate);
    }, 120);

    return () => clearTimeout(timer);
  }, [pendingDate]);

  // Fetch rollup when date changes
  useEffect(() => {
    if (!selectedDate) return;

    let mounted = true;
    setLoading(true);
    setError('');

    getFuturesRollup(selectedDate)
      .then((res) => {
        if (!mounted) return;
        setData(res?.rows || []);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [selectedDate]);

  // Group rows by quadrant
  const grouped = useMemo(() => {
    const map = {};
    QUADRANTS.forEach((q) => { map[q] = []; });
    data.forEach((row) => {
      if (map[row.quadrant]) {
        map[row.quadrant].push(row);
      }
    });
    // Sort each group by abs(chng_in_oi) desc
    QUADRANTS.forEach((q) => {
      map[q].sort(
        (a, b) => Math.abs(b.chng_in_oi ?? 0) - Math.abs(a.chng_in_oi ?? 0)
      );
    });
    return map;
  }, [data]);

  const activeRows = grouped[activeQuadrant] ?? [];
  const meta =
    QUADRANT_META[activeQuadrant] ??
    QUADRANT_META.long_buildup;

  return (
    <div className="space-y-4">
      {/* Date slider */}
      
      <div className="flex items-center gap-3">
        <span className="text-sm text-white/60">
          Timeline
        </span>

        <select
          value={dateMode}
          onChange={(e) => setDateMode(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#151922]"
        >
          <option value="expiry">
            Current Expiry
          </option>

          <option value="30d">
            Last 30 Sessions
          </option>

          <option value="90d">
            Last 90 Sessions
          </option>

          <option value="full">
            Full History
          </option>
        </select>
      </div>
      <DateSlider
        dates={allDates}
        selectedDate={pendingDate || selectedDate}
        onChange={setPendingDate}
      />

      {/* Summary counts */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {QUADRANTS.map((q) => {
          const m = QUADRANT_META[q];
          return (
            <button
              key={q}
              onClick={() => setActiveQuadrant(q)}
              className="card p-4 text-left transition hover:brightness-110"
              style={{
                borderColor: activeQuadrant === q ? m.color : 'rgba(255,255,255,0.08)',
                borderWidth:  '1px',
              }}
            >
              <div className="text-2xl font-bold" style={{ color: m.color }}>
                {grouped[q]?.length ?? 0}
              </div>
              <div className="text-sm text-white mt-1">{m.label}</div>
              <div className="text-xs text-white/45 mt-0.5">{m.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Quadrant tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {QUADRANTS.map((q) => {
          const m = QUADRANT_META[q];
          return (
            <button
              key={q}
              onClick={() => setActiveQuadrant(q)}
              className="px-4 py-2 rounded-xl border text-sm transition"
              style={{
                borderColor:     activeQuadrant === q ? `${m.color}50` : 'rgba(255,255,255,0.1)',
                backgroundColor: activeQuadrant === q ? `${m.color}18` : '#151922',
                color:           activeQuadrant === q ? m.color : 'rgba(255,255,255,0.65)',
              }}
            >
              {m.label}
              <span className="ml-2 opacity-60">({grouped[q]?.length ?? 0})</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300 text-sm">
          {error}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div
            className="px-4 py-3 border-b border-white/8 flex items-center gap-3"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: meta.color }}
            />
            <h3 className="text-sm font-semibold text-white">
              {meta.label}
            </h3>
            <span className="text-xs text-white/45">{meta.desc}</span>
            <span className="ml-auto text-xs text-white/40">
              {activeRows.length} contracts
            </span>
          </div>

          {activeRows.length === 0 ? (
            <p className="px-4 py-8 text-white/45 text-sm">
              No contracts in this quadrant for {selectedDate}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Ticker</th>
                    <th>Expiry</th>
                    <th>Close</th>
                    <th>Chng Price</th>
                    <th>Chng Price %</th>
                    <th>Chng OI</th>
                    <th>Chng OI %</th>
                    <th>Basis</th>
                    <th>CoC %</th>
                    <th>Vol/OI</th>
                    <th>DTE</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row, idx) => (
                    <tr key={`${row.ticker}-${row.expiry}`}>
                      <td className="text-white/35">{idx + 1}</td>
                      <td className="font-semibold text-white">
                        {row.ticker}
                      </td>
                      <td className="text-white/60">{row.expiry}</td>
                      <td>{formatCurrency(row.close, 2)}</td>
                      <td
                        className={
                          row.chng_in_price >= 0
                            ? 'text-[#92D050]'
                            : 'text-[#ef5350]'
                        }
                      >
                        {row.chng_in_price >= 0 ? '+' : ''}
                        {formatNumber(row.chng_in_price, 2)}
                      </td>

                      <td className={row.chng_price_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {formatPercent(row.chng_price_per)}

                      </td>
                      
                      <td
                          className={
                            row.chng_in_oi >= 0
                              ? 'text-[#92D050]'
                              : 'text-[#ef5350]'
                          }
                        >
                        {row.chng_in_oi >= 0 ? '+' : ''}
                        {formatNumber(row.chng_in_oi)}
                      </td>
                      
                      <td className={row.chng_oi_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {formatPercent(row.chng_oi_per)}
                      </td>

                      <td
                        className={
                          row.basis >= 0
                            ? 'text-[#92D050]'
                            : 'text-[#ef5350]'
                        }
                      >
                        {formatNumber(row.basis, 2)}
                      </td>



                      <td>
                        {row.cost_of_carry != null
                          ? `${(Number(row.cost_of_carry) * 100).toFixed(2)}%`
                          : '--'}
                      </td>
                      <td>
                        {row.volume_oi_ratio != null
                          ? Number(row.volume_oi_ratio).toFixed(3)
                          : '--'}
                      </td>
                      <td className="text-white/60">
                        {row.days_to_expiry ?? '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   EXPIRY PANEL — per-ticker analytics tab
───────────────────────────────────────────────────────────────── */

function ExpiryPanel({ ticker, expiry }) {
  return (
    <AnalyticsPanel ticker={ticker} expiry={expiry} />
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

export default function Futures() {
  const [tickerList, setTickerList]             = useState([]);
  const [selectedTicker, setSelectedTicker]     = useState('');
  const [expiries, setExpiries]                 = useState([]);
  const [selectedExpiries, setSelectedExpiries] = useState([]);
  const [activeExpiry, setActiveExpiry]         = useState('');
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState('');

  // Mode: 'screener' = rollup across all tickers, 'expiry' = single ticker
  const [mode, setMode] = useState('screener');

  // All unique dates across the first ticker's first expiry
  // used to drive the screener date slider
  const [allDates, setAllDates] = useState([]);

  /* ── Load tickers ── */
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    getTickers('futures')
      .then((res) => {
        if (!mounted) return;
        const tickers = res?.tickers || [];
        setTickerList(tickers);
        if (tickers.length > 0) setSelectedTicker(tickers[0]);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  /* ── Load expiries when ticker changes ── */
  useEffect(() => {
    if (!selectedTicker) return;
    let mounted = true;

    getExpiries('futures', selectedTicker)
      .then((res) => {
        if (!mounted) return;
        const list = [...(res?.expiries || [])].reverse();
        setExpiries(list);
        const defaults = list.slice(0, 3);
        setSelectedExpiries(defaults);
        if (defaults.length > 0) setActiveExpiry(defaults[0]);
      })
      .catch(console.error);

    return () => { mounted = false; };
  }, [selectedTicker]);

 /* ── Load dates for screener slider ── */
  useEffect(() => {
    if (!tickerList.length) return;

    let mounted = true;

    async function loadDates() {
      try {
        const firstTicker = tickerList[0];

        const expRes = await getExpiries(
          'futures',
          firstTicker
        );

        if (!mounted) return;

        const expiryList = [
          ...(expRes?.expiries || [])
        ].sort(
          (a, b) => new Date(b) - new Date(a)
        );

        if (!expiryList.length) {
          console.error('No expiries found');
          return;
        }

        const latestExpiry = expiryList[0];

        const dateRes = await getDates(
          'futures',
          firstTicker,
          latestExpiry
        );

        if (!mounted) return;

        const dates = [
          ...(dateRes?.dates || [])
        ].sort(
          (a, b) => new Date(a) - new Date(b)
        );

        console.log('Loaded screener dates:', dates);

        setAllDates(dates);

      } catch (err) {
        console.error(
          'Failed loading screener dates',
          err
        );
      }
    }

    loadDates();

    return () => {
      mounted = false;
    };
  }, [tickerList]);

  /* ── Keep activeExpiry valid ── */
  useEffect(() => {
    if (
      selectedExpiries.length > 0 &&
      !selectedExpiries.includes(activeExpiry)
    ) {
      setActiveExpiry(selectedExpiries[0]);
    }
  }, [selectedExpiries]);

  if (loading && tickerList.length === 0) {
    return (
      <div className="h-[calc(100vh-64px)] flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
          <h2 className="text-red-400 text-lg font-semibold">
            Failed to load futures data
          </h2>
          <p className="mt-3 text-sm text-red-100/80">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex">
      {/* SIDEBAR — reuse existing, simplified for futures */}
      <Sidebar
        mode={mode}
        assetType="futures"
        tickerList={tickerList}
        selectedTicker={selectedTicker}
        onTickerChange={(t) => {
          setSelectedTicker(t);
          if (mode === 'screener') setMode('expiry');
        }}
        expiries={expiries}
        selectedExpiries={selectedExpiries}
        onExpiriesChange={setSelectedExpiries}
        selectedMetric="ts"
        onMetricChange={() => {}}
        startDate=""
        endDate=""
        onStartDateChange={() => {}}
        onEndDateChange={() => {}}
      />

      {/* MAIN */}
      <main className="flex-1 p-6 overflow-x-hidden">
        {/* Header + mode toggle */}
        <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {mode === 'screener' ? 'Futures Screener' : selectedTicker}
            </h1>
            <p className="mt-1 text-sm text-white/45">
              {mode === 'screener'
                ? 'Market-wide OI + Price signal across all futures contracts'
                : 'Single ticker futures analytics'
              }
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('screener')}
              className={`
                px-4 py-2 rounded-xl border text-sm transition
                ${mode === 'screener'
                  ? 'border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
                }
              `}
            >
              Market Screener
            </button>

            <button
              onClick={() => setMode('expiry')}
              className={`
                px-4 py-2 rounded-xl border text-sm transition
                ${mode === 'expiry'
                  ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
                }
              `}
            >
              Ticker Analytics
            </button>
          </div>
        </div>

        {/* SCREENER MODE */}
        {mode === 'screener' && (
          <RollupPanel allDates={allDates} />
        )}

        {/* TICKER ANALYTICS MODE */}
        {mode === 'expiry' && (
          <>
            {selectedExpiries.length === 0 && (
              <div className="card p-8">
                <p className="text-white/60">Select at least one expiry</p>
              </div>
            )}

            {selectedExpiries.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
                  {selectedExpiries.map((expiry) => (
                    <button
                      key={expiry}
                      onClick={() => setActiveExpiry(expiry)}
                      className={`
                        px-5 py-3 rounded-xl border whitespace-nowrap text-sm transition
                        ${activeExpiry === expiry
                          ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                          : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
                        }
                      `}
                    >
                      {expiry}
                    </button>
                  ))}
                </div>

                {activeExpiry && (
                  <ExpiryPanel
                    key={`${selectedTicker}-${activeExpiry}`}
                    ticker={selectedTicker}
                    expiry={activeExpiry}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
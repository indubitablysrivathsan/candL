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
  formatCurrency,
  formatNumber,
  QUADRANT_META,
} from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */

const QUADRANTS = [
  'long_buildup',
  'short_buildup',
  'short_covering',
  'long_unwinding',
];

const formatPercent = (value, decimals = 2) => {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(decimals)}%`;
};

/* ─────────────────────────────────────────────────────────────────
   ANALYTICS PANEL
───────────────────────────────────────────────────────────────── */

function AnalyticsPanel({ assetType, ticker, expiry }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!ticker || !expiry) return;
    let mounted = true;
    setLoading(true);
    setError('');
    setData([]);

    getFuturesAnalytics(assetType, ticker, expiry)
      .then((res) => { if (mounted) setData(res?.rows || []); })
      .catch((err) => { if (mounted) setError(err.message); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [assetType, ticker, expiry]);

  if (loading) return (
    <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
  );

  if (error) return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>
  );

  if (!data.length) return (
    <p className="text-white/50 text-sm py-8">No analytics data available.</p>
  );

  const latest = data[data.length - 1];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard title="Close"         value={formatCurrency(latest.close, 2)}  accent="#00B0F0" />
        <MetricCard title="Basis"         value={formatCurrency(latest.basis, 2)}  accent={latest.basis >= 0 ? '#92D050' : '#ef5350'} />
        <MetricCard
          title="Cost of Carry"
          value={latest.cost_of_carry != null ? `${(Number(latest.cost_of_carry) * 100).toFixed(2)}%` : '--'}
          accent="#FFA726"
        />
        <MetricCard
          title="Signal"
          value={QUADRANT_META[latest.quadrant]?.label ?? '--'}
          accent={QUADRANT_META[latest.quadrant]?.color ?? '#ffffff'}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            Rolling Analytics — {ticker} / {expiry}
          </h3>
          <button
            onClick={() => {
              const headers = ['Date','Close','Prev Close','Chng Price','Chng Price %','Chng OI','Chng OI %','Basis','CoC %','Vol/OI','DTE','Signal'];
              const csvRows = [...data].reverse().map((row) => [
                row.trade_date, row.close ?? '', row.prev_close ?? '',
                row.chng_in_price ?? '', row.chng_price_per ?? '',
                row.chng_in_oi ?? '', row.chng_oi_per ?? '',
                row.basis ?? '',
                row.cost_of_carry != null ? (row.cost_of_carry * 100).toFixed(2) : '',
                row.volume_oi_ratio != null ? Number(row.volume_oi_ratio).toFixed(3) : '',
                row.days_to_expiry ?? '', row.quadrant ?? '',
              ].join(','));
              const csv  = [headers.join(','), ...csvRows].join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement('a');
              a.href = url; a.download = `futures_analytics_${ticker}_${expiry}.csv`;
              document.body.appendChild(a); a.click();
              document.body.removeChild(a); URL.revokeObjectURL(url);
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
                <th>Date</th><th>Close</th><th>Chng Price</th><th>Chng Price %</th>
                <th>OI</th><th>Chng OI</th><th>Chng OI %</th><th>Basis</th>
                <th>CoC %</th><th>Vol/OI</th><th>DTE</th><th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row) => {
                const meta = QUADRANT_META[row.quadrant] ?? QUADRANT_META.long_buildup;
                return (
                  <tr key={row.trade_date}>
                    <td className="text-white/70">{row.trade_date}</td>
                    <td>{formatCurrency(row.close, 2)}</td>
                    <td className={row.chng_in_price >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {row.chng_in_price >= 0 ? '+' : ''}{formatNumber(row.chng_in_price, 2)}
                    </td>
                    <td className={row.chng_price_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {formatPercent(row.chng_price_per)}
                    </td>
                    <td className={row.open_int >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {formatNumber(row.open_int)}
                    </td>
                    <td className={row.chng_in_oi >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {row.chng_in_oi >= 0 ? '+' : ''}{formatNumber(row.chng_in_oi)}
                    </td>
                    <td className={row.chng_oi_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {formatPercent(row.chng_oi_per)}
                    </td>
                    <td className={row.basis >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                      {formatNumber(row.basis, 2)}
                    </td>
                    <td>
                      {row.cost_of_carry != null ? `${(Number(row.cost_of_carry) * 100).toFixed(2)}%` : '--'}
                    </td>
                    <td>{row.volume_oi_ratio != null ? Number(row.volume_oi_ratio).toFixed(3) : '--'}</td>
                    <td className="text-white/60">{row.days_to_expiry ?? '--'}</td>
                    <td>
                      <span
                        className="px-2 py-1 rounded-lg text-xs font-medium"
                        style={{ color: meta.color, backgroundColor: `${meta.color}18`, border: `1px solid ${meta.color}30` }}
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
   ROLLUP PANEL
───────────────────────────────────────────────────────────────── */

function RollupPanel({ assetType, allDates, screenerExpiries, activeScreenerExpiry, onScreenerExpiryChange }) {
  const [selectedDate, setSelectedDate]     = useState('');
  const [pendingDate, setPendingDate]       = useState('');
  const [data, setData]                     = useState([]);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const [activeQuadrant, setActiveQuadrant] = useState('long_buildup');

  // Initialize selectedDate to the last available date
  useEffect(() => {
    if (allDates.length > 0 && !selectedDate) {
      setSelectedDate(allDates[allDates.length - 1]);
    }
  }, [allDates, selectedDate]);

  // Debounce slider changes
  useEffect(() => {
    if (!pendingDate) return;
    const timer = setTimeout(() => setSelectedDate(pendingDate), 120);
    return () => clearTimeout(timer);
  }, [pendingDate]);

  // Fetch rollup data when date changes
  useEffect(() => {
    if (!selectedDate) return;
    let mounted = true;
    setLoading(true);
    setError('');

    getFuturesRollup(assetType, selectedDate)
      .then((res) => { if (mounted) setData(res?.rows || []); })
      .catch((err) => { if (mounted) setError(err.message); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [assetType, selectedDate]);



  // Pre-compute combined OI across all 3 screener expiries, per ticker, from full data
  const combinedOIMap = useMemo(() => {
    const map = {};
    data.forEach((row) => {
      if (!screenerExpiries.includes(row.expiry)) return;
      if (row.open_int == null) return;
      map[row.ticker] = (map[row.ticker] ?? 0) + Number(row.open_int);
    });
    return map;
  }, [data, screenerExpiries]);

  // Group rows by quadrant, filtered to the active screener expiry only
  const grouped = useMemo(() => {
    const map = {};
    QUADRANTS.forEach((q) => { map[q] = []; });

    data.forEach((row) => {
      // Only show rows matching the currently active screener expiry tab
      if (activeScreenerExpiry && row.expiry !== activeScreenerExpiry) return;
      if (map[row.quadrant]) map[row.quadrant].push(row);
    });

    QUADRANTS.forEach((q) => {
      map[q].sort((a, b) => Math.abs(b.chng_in_oi ?? 0) - Math.abs(a.chng_in_oi ?? 0));
    });

    return map;
  }, [data, activeScreenerExpiry]);

  const activeRows = grouped[activeQuadrant] ?? [];
  const meta = QUADRANT_META[activeQuadrant] ?? QUADRANT_META.long_buildup;

  return (
    <div className="space-y-4">
      {/* Expiry tabs — mirroring ticker analytics style */}
      {screenerExpiries.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {screenerExpiries.map((expiry) => (
            <button
              key={expiry}
              onClick={() => onScreenerExpiryChange(expiry)}
              className={`px-5 py-3 rounded-xl border whitespace-nowrap text-sm transition ${
                activeScreenerExpiry === expiry
                  ? 'border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
              }`}
            >
              {expiry}
            </button>
          ))}
        </div>
      )}

      {/* Date slider */}
      <DateSlider
        dates={allDates}
        selectedDate={pendingDate || selectedDate}
        onChange={setPendingDate}
      />

      {/* Quadrant summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {QUADRANTS.map((q) => {
          const m = QUADRANT_META[q];
          return (
            <button
              key={q}
              onClick={() => setActiveQuadrant(q)}
              className="card p-4 text-left transition hover:brightness-110"
              style={{ borderColor: activeQuadrant === q ? m.color : 'rgba(255,255,255,0.08)', borderWidth: '1px' }}
            >
              <div className="text-2xl font-bold" style={{ color: m.color }}>{grouped[q]?.length ?? 0}</div>
              <div className="text-sm text-white mt-1">{m.label}</div>
              <div className="text-xs text-white/45 mt-0.5">{m.desc}</div>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/8 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
            <h3 className="text-sm font-semibold text-white">{meta.label}</h3>
            <span className="text-xs text-white/45">{meta.desc}</span>
            <span className="ml-auto text-xs text-white/40">{activeRows.length} contracts</span>
          </div>

          {activeRows.length === 0 ? (
            <p className="px-4 py-8 text-white/45 text-sm">
              No contracts in this quadrant for {selectedDate}
              {activeScreenerExpiry ? ` / ${activeScreenerExpiry}` : ''}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Ticker</th><th>Expiry</th><th>Close</th>
                    <th>Chng Price</th><th>Chng Price %</th>
                    <th>OI</th><th>Combined OI</th><th>Chng OI</th><th>Chng OI %</th>
                    <th>Basis</th><th>CoC %</th><th>Vol/OI</th><th>DTE</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row, idx) => (
                    <tr key={`${row.ticker}-${row.expiry}`}>
                      <td className="text-white/35">{idx + 1}</td>
                      <td className="font-semibold text-white">{row.ticker}</td>
                      <td className="text-white/60">{row.expiry}</td>
                      <td>{formatCurrency(row.close, 2)}</td>
                      <td className={row.chng_in_price >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {row.chng_in_price >= 0 ? '+' : ''}{formatNumber(row.chng_in_price, 2)}
                      </td>
                      <td className={row.chng_price_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {formatPercent(row.chng_price_per)}
                      </td>
                      <td className={row.open_int >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {formatNumber(row.open_int)}
                      </td>
                      {/* Combined OI — same value regardless of active expiry tab */}
                      <td className={combinedOIMap[row.ticker] >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {combinedOIMap[row.ticker] != null
                          ? formatNumber(combinedOIMap[row.ticker])
                          : '--'}
                      </td>
                      <td className={row.chng_in_oi >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {row.chng_in_oi >= 0 ? '+' : ''}{formatNumber(row.chng_in_oi)}
                      </td>
                      <td className={row.chng_oi_per >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {formatPercent(row.chng_oi_per)}
                      </td>
                      <td className={row.basis >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {formatNumber(row.basis, 2)}
                      </td>
                      <td>{row.cost_of_carry != null ? `${(Number(row.cost_of_carry) * 100).toFixed(2)}%` : '--'}</td>
                      <td>{row.volume_oi_ratio != null ? Number(row.volume_oi_ratio).toFixed(3) : '--'}</td>
                      <td className="text-white/60">{row.days_to_expiry ?? '--'}</td>
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
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

export default function Futures({ assetType = 'stock_futures' }) {
  const [tickerList, setTickerList]                       = useState([]);
  const [selectedTicker, setSelectedTicker]               = useState('');
  const [expiries, setExpiries]                           = useState([]);
  const [selectedExpiries, setSelectedExpiries]           = useState([]);
  const [activeExpiry, setActiveExpiry]                   = useState('');
  const [loading, setLoading]                             = useState(true);
  const [error, setError]                                 = useState('');
  const [mode, setMode]                                   = useState('screener');
  const [allDates, setAllDates]                           = useState([]);

  // Screener-mode expiry state (derived from first ticker, ascending)
  const [screenerExpiries, setScreenerExpiries]           = useState([]);   // full list ascending
  const [screenerSelectedExpiry, setScreenerSelectedExpiry] = useState(''); // single user selection
  const [activeScreenerExpiry, setActiveScreenerExpiry]   = useState('');   // active tab

  // The 3 expiries shown as tabs in screener: selected + next 2 ascending
  const screenerThreeExpiries = useMemo(() => {
    if (!screenerSelectedExpiry || screenerExpiries.length === 0) return [];
    const idx = screenerExpiries.indexOf(screenerSelectedExpiry);
    if (idx === -1) return [screenerSelectedExpiry];
    return screenerExpiries.slice(idx, idx + 3);
  }, [screenerExpiries, screenerSelectedExpiry]);

  // Keep activeScreenerExpiry pointing at the first of the three when they change
  useEffect(() => {
    if (screenerThreeExpiries.length > 0 && !screenerThreeExpiries.includes(activeScreenerExpiry)) {
      setActiveScreenerExpiry(screenerThreeExpiries[0]);
    }
  }, [screenerThreeExpiries, activeScreenerExpiry]);

  // Reset all state when assetType changes
  useEffect(() => {
    setTickerList([]);
    setSelectedTicker('');
    setExpiries([]);
    setSelectedExpiries([]);
    setActiveExpiry('');
    setAllDates([]);
    setScreenerExpiries([]);
    setScreenerSelectedExpiry('');
    setActiveScreenerExpiry('');
    setMode('screener');
    setError('');
    setLoading(true);
  }, [assetType]);

  /* ── Load tickers ── */
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    getTickers(assetType)
      .then((res) => {
        if (!mounted) return;
        const tickers = res?.tickers || [];
        setTickerList(tickers);
        if (tickers.length > 0) setSelectedTicker(tickers[0]);
      })
      .catch((err) => { if (mounted) setError(err.message); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [assetType]);

  /* ── Load expiries for ticker analytics when ticker changes ── */
  useEffect(() => {
    if (!selectedTicker) return;
    let mounted = true;

    getExpiries(assetType, selectedTicker)
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
  }, [assetType, selectedTicker]);

  /* ── Load screener expiries from the first ticker (ascending) ── */
  useEffect(() => {
    if (!tickerList.length) return;
    let mounted = true;

    async function loadScreenerExpiries() {
      try {
        const firstTicker = tickerList[0];
        const expRes      = await getExpiries(assetType, firstTicker);
        if (!mounted) return;

        // Sort ascending (nearest expiry first)
        const sorted = [...(expRes?.expiries || [])].sort((a, b) => new Date(a) - new Date(b));
        setScreenerExpiries(sorted);
        if (sorted.length > 0) setScreenerSelectedExpiry(sorted[0]);
      } catch (err) {
        console.error('Failed loading screener expiries', err);
      }
    }

    loadScreenerExpiries();
    return () => { mounted = false; };
  }, [assetType, tickerList]);

  /* ── Load dates for screener slider (from first ticker's nearest expiry) ── */
  useEffect(() => {
    if (!tickerList.length || !screenerExpiries.length) return;
    let mounted = true;

    async function loadDates() {
      try {
        const firstTicker = tickerList[0];
        const nearestExpiry = screenerExpiries[0];
        const dateRes = await getDates(assetType, firstTicker, nearestExpiry);
        if (!mounted) return;
        setAllDates([...(dateRes?.dates || [])].sort((a, b) => new Date(a) - new Date(b)));
      } catch (err) {
        console.error('Failed loading screener dates', err);
      }
    }

    loadDates();
    return () => { mounted = false; };
  }, [assetType, tickerList, screenerExpiries]);

  /* ── Keep activeExpiry valid in ticker analytics mode ── */
  useEffect(() => {
    if (selectedExpiries.length > 0 && !selectedExpiries.includes(activeExpiry)) {
      setActiveExpiry(selectedExpiries[0]);
    }
  }, [selectedExpiries, activeExpiry]);

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
          <h2 className="text-red-400 text-lg font-semibold">Failed to load futures data</h2>
          <p className="mt-3 text-sm text-red-100/80">{error}</p>
        </div>
      </div>
    );
  }

  const label = assetType === 'index_futures' ? 'Index Futures' : 'Stock Futures';

  return (
    <div className="flex min-h-screen">
      <Sidebar
        mode={mode}
        assetType={assetType}
        tickerList={tickerList}
        selectedTicker={selectedTicker}
        onTickerChange={(t) => { setSelectedTicker(t); if (mode === 'screener') setMode('expiry'); }}
        expiries={mode === 'screener' ? screenerExpiries : expiries}
        selectedExpiries={mode === 'screener' ? [screenerSelectedExpiry] : selectedExpiries}
        onExpiriesChange={mode === 'screener'
          ? (arr) => setScreenerSelectedExpiry(arr[arr.length - 1] ?? screenerSelectedExpiry)
          : setSelectedExpiries
        }
        selectedMetric="ts"
        onMetricChange={() => {}}
        startDate=""
        endDate=""
        onStartDateChange={() => {}}
        onEndDateChange={() => {}}
      />

      <main className="flex-1 p-6 overflow-x-hidden">
        <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {mode === 'screener' ? `${label} Screener` : selectedTicker}
            </h1>
            <p className="mt-1 text-sm text-white/45">
              {mode === 'screener'
                ? `Market-wide OI + Price signal across all ${label.toLowerCase()} contracts`
                : `Single ticker ${label.toLowerCase()} analytics`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('screener')}
              className={`px-4 py-2 rounded-xl border text-sm transition ${
                mode === 'screener'
                  ? 'border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
              }`}
            >
              Market Screener
            </button>
            <button
              onClick={() => setMode('expiry')}
              className={`px-4 py-2 rounded-xl border text-sm transition ${
                mode === 'expiry'
                  ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                  : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
              }`}
            >
              Ticker Analytics
            </button>
          </div>
        </div>

        {mode === 'screener' && (
          <RollupPanel
            assetType={assetType}
            allDates={allDates}
            screenerExpiries={screenerThreeExpiries}
            activeScreenerExpiry={activeScreenerExpiry}
            onScreenerExpiryChange={setActiveScreenerExpiry}
          />
        )}

        {mode === 'expiry' && (
          <>
            {selectedExpiries.length === 0 && (
              <div className="card p-8"><p className="text-white/60">Select at least one expiry</p></div>
            )}
            {selectedExpiries.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
                  {selectedExpiries.map((expiry) => (
                    <button
                      key={expiry}
                      onClick={() => setActiveExpiry(expiry)}
                      className={`px-5 py-3 rounded-xl border whitespace-nowrap text-sm transition ${
                        activeExpiry === expiry
                          ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                          : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
                      }`}
                    >
                      {expiry}
                    </button>
                  ))}
                </div>
                {activeExpiry && (
                  <AnalyticsPanel
                    key={`${assetType}-${selectedTicker}-${activeExpiry}`}
                    assetType={assetType}
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
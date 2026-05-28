// frontend/src/pages/Futures.jsx

import { useEffect, useMemo, useState } from 'react';

import Sidebar from '../components/layout/Sidebar';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import MetricCard from '../components/shared/MetricCard';
import DateSlider from '../components/shared/DateSlider';
import OIChart, { ScreenerOIChart } from '../components/charts/OIChart';

import {
  getTickers,
  getExpiries,
  getDates,
  getFuturesAnalytics,
  getFuturesRollup,
  getFuturesCombinedHistory,
  formatCurrency,
  formatNumber,
  QUADRANT_META,
  FUTURES_COMBINED_TICKER,
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

const formatDate = (dateString) => {
  const date  = new Date(dateString);
  const day   = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year  = date.getFullYear();
  return `${day}-${month}-${year}`;
};

/** Strip T00:00:00 suffix that the API returns on expiry timestamps */
const normalizeExpiry = (expiry) => (expiry ? expiry.split('T')[0] : expiry);

/* ─────────────────────────────────────────────────────────────────
   ANALYTICS PANEL
───────────────────────────────────────────────────────────────── */

function AnalyticsPanel({ assetType, ticker, expiry, allExpiries }) {
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [activeTab, setActiveTab] = useState('table'); // 'table' | 'chart'

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

  /* ── Cycle-scoped stats ── */
  const cycleData = useMemo(() => {
    if (!data.length) return data;

    const current = new Date(expiry);

    // find nearest older expiry
    const prevExpiry = allExpiries
      .map((e) => new Date(e))
      .filter((e) => e < current)
      .sort((a, b) => b - a)[0];

    if (!prevExpiry) return data;

    return data.filter((r) => {
      const td = new Date(r.trade_date);

      return (
        td > prevExpiry &&
        td <= current
      );
    });

  }, [data, expiry, allExpiries]);

  const stats = useMemo(() => {
    if (!cycleData.length) return null;
    const valid = cycleData.filter((r) => r.open_int != null && r.open_int > 0 && r.close != null);
    if (!valid.length) return null;
    const maxOI    = valid.reduce((a, b) => (b.open_int > a.open_int ? b : a));
    const minOI    = valid.reduce((a, b) => (b.open_int < a.open_int ? b : a));
    const maxClose = valid.reduce((a, b) => (b.close > a.close ? b : a));
    const minClose = valid.reduce((a, b) => (b.close < a.close ? b : a));
    return { maxOI, minOI, maxClose, minClose };
  }, [cycleData]);

  if (loading) return (
    <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>
  );
  if (!data.length) return (
    <p className="text-white/50 text-sm py-8">No analytics data available.</p>
  );

  return (
    <div className="space-y-4">
      {/* Metric cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard
          title="Max OI (cycle)"
          value={stats ? (<>{formatNumber(stats.maxOI.open_int)}<br />{formatDate(stats.maxOI.trade_date)}</>) : '--'}
          accent="#92D050"
        />
        <MetricCard
          title="Min OI (cycle)"
          value={stats ? (<>{formatNumber(stats.minOI.open_int)}<br />{formatDate(stats.minOI.trade_date)}</>) : '--'}
          accent="#ef5350"
        />
        <MetricCard
          title="Max Close (cycle)"
          value={stats ? (<>{formatCurrency(stats.maxClose.close, 2)}<br />{formatDate(stats.maxClose.trade_date)}</>) : '--'}
          accent="#00B0F0"
        />
        <MetricCard
          title="Min Close (cycle)"
          value={stats ? (<>{formatCurrency(stats.minClose.close, 2)}<br />{formatDate(stats.minClose.trade_date)}</>) : '--'}
          accent="#FFA726"
        />
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab('table')}
          className={`px-4 py-2 rounded-xl border text-sm transition ${
            activeTab === 'table'
              ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
              : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
          }`}
        >
          Rolling Table
        </button>
        <button
          onClick={() => setActiveTab('chart')}
          className={`px-4 py-2 rounded-xl border text-sm transition ${
            activeTab === 'chart'
              ? 'border-[#92D050]/30 bg-[#92D050]/10 text-[#92D050]'
              : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
          }`}
        >
          OI Chart
        </button>
      </div>

      {activeTab === 'chart' && (
        <OIChart
          assetType={assetType}
          ticker={ticker}
          expiries={allExpiries}
          mode="ticker"
        />
      )}

      {activeTab === 'table' && (
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
                      <td>{row.cost_of_carry != null ? `${(Number(row.cost_of_carry) * 100).toFixed(2)}%` : '--'}</td>
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
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   ROLLUP PANEL
───────────────────────────────────────────────────────────────── */

function RollupPanel({
  assetType,
  allDates,
  screenerExpiries,
  // Charts sub-tab props
  chartSelectedExpiries,
  allScreenerExpiries,
  chartTicker,
  // Screener table props
  activeScreenerExpiry,
  onScreenerExpiryChange,
  activeTab,
}) {
  const [selectedDate, setSelectedDate]     = useState('');
  const [pendingDate, setPendingDate]       = useState('');
  const [data, setData]                     = useState([]);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const [activeQuadrant, setActiveQuadrant] = useState('long_buildup');

  /* ── Initialize to last available date ── */
  useEffect(() => {
    if (allDates.length > 0) {
      const last = allDates[allDates.length - 1];
      setSelectedDate(last);
      setPendingDate(last);
    }
  }, [allDates]);

  /* ── Debounce slider → selectedDate ── */
  useEffect(() => {
    if (!pendingDate) return;
    const timer = setTimeout(() => setSelectedDate(pendingDate), 120);
    return () => clearTimeout(timer);
  }, [pendingDate]);

  /* ── Fetch rollup on date change ── */
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

  /* ── Combined OI across all 3 screener expiries per ticker ── */
  const combinedOIMap = useMemo(() => {
    const map = {};
    data.forEach((row) => {
      const expiry = normalizeExpiry(row.expiry);
      if (!screenerExpiries.includes(expiry)) return;
      if (row.open_int == null) return;
      map[row.ticker] = (map[row.ticker] ?? 0) + Number(row.open_int);
    });
    return map;
  }, [data, screenerExpiries]);

  /* ── Group by quadrant, filtered to active screener expiry ── */
  const grouped = useMemo(() => {
    const map = {};
    QUADRANTS.forEach((q) => { map[q] = []; });

    data.forEach((row) => {
      const expiry = normalizeExpiry(row.expiry);
      if (activeScreenerExpiry && expiry !== activeScreenerExpiry) return;
      if (map[row.quadrant]) {
        map[row.quadrant].push({ ...row, expiry });
      }
    });

    QUADRANTS.forEach((q) => {
      map[q].sort((a, b) => Math.abs(b.chng_in_oi ?? 0) - Math.abs(a.chng_in_oi ?? 0));
    });

    return map;
  }, [data, activeScreenerExpiry]);

  const activeRows = grouped[activeQuadrant] ?? [];
  const meta       = QUADRANT_META[activeQuadrant] ?? QUADRANT_META.long_buildup;

  /* ── Charts sub-tab: delegate to ScreenerOIChart ── */
  if (activeTab === 'charts') {
    return (
      <ScreenerOIChart
        assetType={assetType}
        ticker={chartTicker}
        allExpiries={allScreenerExpiries}
        selectedCycles={chartSelectedExpiries}
        allDates={allDates}
      />
    );
  }

  /* ── Screener table ── */
  return (
    <div className="space-y-4">
      {/* Expiry tabs */}
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
              style={{
                borderColor: activeQuadrant === q ? m.color : 'rgba(255,255,255,0.08)',
                borderWidth: '1px',
              }}
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
                      <td className={combinedOIMap[row.ticker] >= 0 ? 'text-[#92D050]' : 'text-[#ef5350]'}>
                        {combinedOIMap[row.ticker] != null ? formatNumber(combinedOIMap[row.ticker]) : '--'}
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
  const [tickerList, setTickerList]           = useState([]);
  const [selectedTicker, setSelectedTicker]   = useState('');
  const [expiries, setExpiries]               = useState([]);
  const [selectedExpiries, setSelectedExpiries] = useState([]);
  const [activeExpiry, setActiveExpiry]       = useState('');
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');
  const [mode, setMode]                       = useState('screener'); // 'screener' | 'expiry'
  const [allDates, setAllDates]               = useState([]);

  // Full master expiry chain (from API, no sorting)
  const [screenerExpiries, setScreenerExpiries]           = useState([]);
  // Subset driving the 3-tab view in the screener table

  const validChartExpiries = useMemo(() => {
    if (!screenerExpiries.length) return [];
    const today = new Date();
    // completed cycles (expiry already passed) + the single nearest upcoming/active cycle
    const completed = screenerExpiries.filter((e) => new Date(e) < today);
    const inProgress = screenerExpiries.find((e) => new Date(e) >= today);
    return inProgress ? [inProgress, ...completed] : completed;
  }, [screenerExpiries]);

  const [screenerSelectedExpiry, setScreenerSelectedExpiry] = useState('');
  const [activeScreenerExpiry, setActiveScreenerExpiry]   = useState('');
  // Subset selected for the Charts sub-tab (max 5)
  const [chartSelectedExpiries, setChartSelectedExpiries] = useState([]);

  // Top-level screener tab: 'screener' | 'charts'
  const [screenerTab, setScreenerTab] = useState('screener');

  const displayTickerList = useMemo(() =>
    (mode === 'screener' && screenerTab === 'charts')
      ? [...tickerList, FUTURES_COMBINED_TICKER]
      : tickerList,
  [tickerList, mode, screenerTab]);

  /* ── The 3 expiry tabs for the screener table: selected + next 2 ── */
  const screenerThreeExpiries = useMemo(() => {
    if (!screenerSelectedExpiry || !screenerExpiries.length) return [];
    const idx = screenerExpiries.indexOf(screenerSelectedExpiry);
    if (idx === -1) return [screenerSelectedExpiry];
    return screenerExpiries.slice(idx, idx + 3);
  }, [screenerExpiries, screenerSelectedExpiry]);


  useEffect(() => {
    if (!validChartExpiries.length) return;

    setChartSelectedExpiries(
      validChartExpiries.slice(0, 5)
    );
  }, [validChartExpiries]);

  /* ── Keep activeScreenerExpiry pointing at first of the three ── */
  useEffect(() => {
    if (
      screenerThreeExpiries.length > 0 &&
      !screenerThreeExpiries.includes(activeScreenerExpiry)
    ) {
      setActiveScreenerExpiry(screenerThreeExpiries[0]);
    }
  }, [screenerThreeExpiries, activeScreenerExpiry]);

  /* ── Reset on assetType change ── */
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
    setChartSelectedExpiries([]);
    setMode('screener');
    setScreenerTab('screener');
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

  /* ── Load expiries for ticker analytics ── */
  useEffect(() => {
    if (!selectedTicker || selectedTicker === FUTURES_COMBINED_TICKER) return;
    let mounted = true;

    getExpiries(assetType, selectedTicker)
      .then((res) => {
        if (!mounted) return;
        const list     = res?.expiries || [];
        setExpiries(list);
        const defaults = list.slice(0, 3);
        setSelectedExpiries(defaults);
        if (defaults.length > 0) setActiveExpiry(defaults[0]);
      })
      .catch(console.error);

    return () => { mounted = false; };
  }, [assetType, selectedTicker]);

  useEffect(() => {
    if (!(mode === 'screener' && screenerTab === 'charts') && selectedTicker === FUTURES_COMBINED_TICKER) {
      setSelectedTicker(tickerList[0] || '');
    }
  }, [mode, screenerTab, selectedTicker, tickerList]);

  /* ── Load screener expiries from first ticker (master chain) ── */
  useEffect(() => {
    if (!tickerList.length) return;
    let mounted = true;

    getExpiries(assetType, tickerList[0])
      .then((res) => {
        if (!mounted) return;
        const list = res?.expiries || [];
        setScreenerExpiries(list);
        if (list.length > 0) {
          setScreenerSelectedExpiry(list[0]);
        }
      })
      .catch((err) => console.error('Failed loading screener expiries', err));

    return () => { mounted = false; };
  }, [assetType, tickerList]);

  /* ── Load dates for screener slider ── */
  useEffect(() => {
    if (!tickerList.length || !screenerSelectedExpiry) return;
    let mounted = true;

    getDates(assetType, tickerList[0], screenerSelectedExpiry)
      .then((res) => {
        if (!mounted) return;
        const sorted = [...(res?.dates || [])].sort((a, b) => new Date(a) - new Date(b));

        const idx        = screenerExpiries.indexOf(screenerSelectedExpiry);
        const prevExpiry = idx > 0 ? screenerExpiries[idx - 1] : null;
        const cycleStart = prevExpiry ? sorted.find((d) => d > prevExpiry) : sorted[0];
        const cycleDates = cycleStart ? sorted.filter((d) => d >= cycleStart) : sorted;

        setAllDates(cycleDates);
      })
      .catch((err) => console.error('Failed loading screener dates', err));

    return () => { mounted = false; };
  }, [assetType, tickerList, screenerSelectedExpiry, screenerExpiries]);

  /* ── Keep activeExpiry valid in ticker analytics ── */
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
        screenerTab={screenerTab}
        assetType={assetType}
        tickerList={displayTickerList}
        selectedTicker={selectedTicker}
        onTickerChange={(t) => {
          setSelectedTicker(t);
          // In expiry mode: switching ticker navigates to that ticker's analytics.
          // In screener+charts mode: just update selectedTicker for the chart (no mode switch).
          // In screener+screener mode: switch to expiry mode (existing behaviour).
          if (mode === 'screener' && screenerTab === 'charts') {
            // stay in screener/charts — ticker update is enough
          } else if (mode === 'screener') {
            setMode('expiry');
          }
        }}
        expiries={
          mode === 'screener'
            ? screenerTab === 'charts'
              ? validChartExpiries          // full chain for "Add Expiry" dropdown
              : screenerExpiries
            : expiries
        }
        selectedExpiries={
          mode === 'screener'
            ? screenerTab === 'charts'
              ? chartSelectedExpiries
              : [screenerSelectedExpiry]
            : selectedExpiries
        }
        onExpiriesChange={
          mode === 'screener'
            ? screenerTab === 'charts'
              ? (arr) => {
                  const deduped = [...new Set(arr)];
                  // preserve master expiry order
                  const ordered = validChartExpiries.filter((e) =>
                    deduped.includes(e)
                  );
                  setChartSelectedExpiries(ordered.slice(0, 5));
                }
              : (arr) => {
                  setScreenerSelectedExpiry(arr[arr.length - 1] ?? screenerSelectedExpiry);
                }
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
        {/* ── Header + mode switcher ── */}
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

        {/* ── SCREENER MODE ── */}
        {mode === 'screener' && (
          <div className="space-y-4">
            {/* Screener sub-tabs */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScreenerTab('screener')}
                className={`px-4 py-2 rounded-xl border text-sm transition ${
                  screenerTab === 'screener'
                    ? 'border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726]'
                    : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
                }`}
              >
                Screener
              </button>
              <button
                onClick={() => setScreenerTab('charts')}
                className={`px-4 py-2 rounded-xl border text-sm transition ${
                  screenerTab === 'charts'
                    ? 'border-[#92D050]/30 bg-[#92D050]/10 text-[#92D050]'
                    : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
                }`}
              >
                Charts
              </button>
            </div>

            <RollupPanel
              assetType={assetType}
              allDates={allDates}
              screenerExpiries={screenerThreeExpiries}
              // Charts sub-tab
              chartSelectedExpiries={chartSelectedExpiries}
              allScreenerExpiries={screenerExpiries}
              chartTicker={selectedTicker}
              // Screener table
              activeScreenerExpiry={activeScreenerExpiry}
              onScreenerExpiryChange={setActiveScreenerExpiry}
              activeTab={screenerTab}
            />
          </div>
        )}

        {/* ── TICKER ANALYTICS MODE ── */}
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
                    allExpiries={expiries}
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
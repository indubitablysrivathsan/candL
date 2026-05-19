// frontend/src/pages/Options.jsx

import {
  useEffect,
  useMemo,
  useState
} from 'react';

import Sidebar from '../components/layout/Sidebar';

import MetricCard from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import DateSlider from '../components/shared/DateSlider';

import StrikeBarChart from '../components/charts/StrikeBarChart';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import PCRChart from '../components/charts/PCRChart';

import {
  getTickers,
  getExpiries,
  getDates,
  getSnapshot,
  getAnalytics,
  getChartScale,

  formatCurrency,
  formatNumber,

  calculateTotals,
  getMetricFields
} from '../api/client';

/* =========================================
   PER EXPIRY TAB COMPONENT
========================================= */

function ExpiryPanel({
  ticker,
  expiry,
  metric,
  startDate,
  endDate
}) {
  const [availableDates, setAvailableDates] =
    useState([]);

  const [selectedDate, setSelectedDate] =
    useState('');

  const [snapshotData, setSnapshotData] =
    useState(null);

  const [analyticsData, setAnalyticsData] =
    useState([]);

  const [loadingDates, setLoadingDates] =
    useState(true);

  const [loadingSnapshot, setLoadingSnapshot] =
    useState(false);

  const [loadingAnalytics, setLoadingAnalytics] =
    useState(false);

  const [yDomain, setYDomain] = useState(null);
  const [xScale,  setXScale]  = useState(null); // { x_min, x_max, strike_gap }

  const [error, setError] = useState('');

  const [innerTab, setInnerTab] =
    useState('chart');

  /* =====================================
      FETCH DATES
  ===================================== */

  useEffect(() => {
    let mounted = true;

    async function loadDates() {
      try {
        setLoadingDates(true);
        setError('');

        const response = await getDates(
          'options',
          ticker,
          expiry
        );

        if (!mounted) return;

        const dates = response?.dates || [];

        setAvailableDates(dates);

        if (dates.length > 0) {
          setSelectedDate(dates[dates.length - 1]);
        }
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load dates');
      } finally {
        if (mounted) setLoadingDates(false);
      }
    }

    loadDates();
    return () => { mounted = false; };
  }, [ticker, expiry]);

  /* =====================================
      FILTERED DATES
  ===================================== */

  const filteredDates = useMemo(() => {
    if (metric === 'ts') return availableDates;

    return availableDates.filter((date) => {
      if (startDate && date < startDate) return false;
      if (endDate   && date > endDate)   return false;
      return true;
    });
  }, [availableDates, startDate, endDate, metric]);

  /* =====================================
      AUTO CORRECT DATE
  ===================================== */

  useEffect(() => {
    if (!filteredDates.length) return;

    if (!selectedDate || !filteredDates.includes(selectedDate)) {
      setSelectedDate(filteredDates[filteredDates.length - 1]);
    }
  }, [filteredDates, selectedDate]);

  /* =====================================
      FETCH SNAPSHOT
  ===================================== */

  useEffect(() => {
    if (metric === 'ts' || !selectedDate) return;

    let mounted = true;

    async function loadSnapshot() {
      try {
        setLoadingSnapshot(true);
        setError('');

        const response = await getSnapshot(ticker, expiry, selectedDate);

        if (!mounted) return;
        setSnapshotData(response);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load snapshot');
      } finally {
        if (mounted) setLoadingSnapshot(false);
      }
    }

    loadSnapshot();
    return () => { mounted = false; };
  }, [ticker, expiry, selectedDate, metric]);

  /* =====================================
      FETCH CHART SCALE
  ===================================== */

  useEffect(() => {
    if (metric === 'ts' || !filteredDates.length) return;

    let mounted = true;

    async function loadChartScale() {
      try {
        const start = filteredDates[0];
        const end   = filteredDates[filteredDates.length - 1];
        const res   = await getChartScale(ticker, expiry, start, end, metric);

        if (!mounted) return;

        setYDomain([res.y_min, res.y_max]);
        setXScale({
          x_min:      res.x_min,
          x_max:      res.x_max,
          strike_gap: res.strike_gap,
        });
      } catch {
        // non-fatal — chart falls back to auto
        if (mounted) {
          setYDomain(null);
          setXScale(null);
        }
      }
    }

    loadChartScale();
    return () => { mounted = false; };
  }, [ticker, expiry, metric, filteredDates]);

  /* =====================================
      FETCH ANALYTICS
  ===================================== */

  useEffect(() => {
    if (metric !== 'ts') return;

    let mounted = true;

    async function loadAnalytics() {
      try {
        setLoadingAnalytics(true);
        setError('');

        const response = await getAnalytics(ticker, expiry);

        if (!mounted) return;
        setAnalyticsData(response?.rows || []);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load analytics');
      } finally {
        if (mounted) setLoadingAnalytics(false);
      }
    }

    loadAnalytics();
    return () => { mounted = false; };
  }, [ticker, expiry, metric]);

  /* =====================================
      TOTALS
  ===================================== */

  const totals = useMemo(() => {
    return calculateTotals(snapshotData, metric);
  }, [snapshotData, metric]);

  /* =====================================
      ATM STRIKE
  ===================================== */

  const atmStrike = useMemo(() => {
    if (
      !snapshotData?.strikes?.length ||
      snapshotData?.underlying == null
    ) {
      return null;
    }

    let closest = snapshotData.strikes[0];
    let minDiff = Math.abs(
      Number(snapshotData.strikes[0].strike) - Number(snapshotData.underlying)
    );

    snapshotData.strikes.forEach((strike) => {
      const diff = Math.abs(
        Number(strike.strike) - Number(snapshotData.underlying)
      );
      if (diff < minDiff) {
        closest = strike;
        minDiff = diff;
      }
    });

    return closest?.strike;
  }, [snapshotData]);

  /* =====================================
      TABLE DATA
  ===================================== */

  const tableRows = useMemo(() => {
    if (!snapshotData?.strikes?.length) return [];

    const fields = getMetricFields(metric);

    return snapshotData.strikes.map((row) => ({
      strike: row.strike,
      ce:     row[fields.ce],
      pe:     row[fields.pe]
    }));
  }, [snapshotData, metric]);

  /* =====================================
      ERROR
  ===================================== */

  if (error) {
    return (
      <div className="card p-6">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
          <h3 className="text-red-400 font-semibold">Error</h3>
          <p className="mt-2 text-sm text-red-200/80">{error}</p>
        </div>
      </div>
    );
  }

  /* =====================================
      LOADING
  ===================================== */

  if (loadingDates || loadingAnalytics) {
    return (
      <div className="card min-h-[400px] flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  /* =====================================
      EMPTY
  ===================================== */

  if (metric !== 'ts' && !snapshotData) {
    return (
      <div className="card p-8">
        <p className="text-white/60">No snapshot data available</p>
      </div>
    );
  }

  /* =====================================
      TIME SERIES VIEW
  ===================================== */

  if (metric === 'ts') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInnerTab('chart')}
            className={`
              px-4 py-2 rounded-xl border text-sm transition
              ${innerTab === 'chart'
                ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                : 'border-white/10 bg-[#151922] text-white/65'
              }
            `}
          >
            Price & Max Pain
          </button>

          <button
            onClick={() => setInnerTab('pcr')}
            className={`
              px-4 py-2 rounded-xl border text-sm transition
              ${innerTab === 'pcr'
                ? 'border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726]'
                : 'border-white/10 bg-[#151922] text-white/65'
              }
            `}
          >
            PCR
          </button>
        </div>

        {innerTab === 'chart'
          ? <TimeSeriesChart analyticsData={analyticsData} />
          : <PCRChart        analyticsData={analyticsData} />
        }
      </div>
    );
  }

  /* =====================================
      NORMAL VIEW
  ===================================== */

  return (
    <div className="space-y-5">
      {/* ================================
          METRIC CARDS
      ================================= */}
      <div className="grid grid-cols-1 xl:grid-cols-4 md:grid-cols-2 gap-4">
        <MetricCard
          title="Underlying"
          value={formatCurrency(snapshotData?.underlying, 2)}
          accent="#FFD700"
        />

        <MetricCard
          title="Max Pain"
          value={formatCurrency(snapshotData?.max_pain, 2)}
          accent="#FF69B4"
        />

        <MetricCard
          title="PCR"
          value={
            snapshotData?.pcr != null
              ? Number(snapshotData.pcr).toFixed(3)
              : '--'
          }
          accent="#FFA726"
        />

        <MetricCard
          title="CE | PE Total"
          value={`${formatNumber(totals.ceTotal)} | ${formatNumber(totals.peTotal)}`}
          accent="#00B0F0"
        />
      </div>

      {/* ================================
          INNER TABS
      ================================= */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setInnerTab('chart')}
          className={`
            px-4 py-2 rounded-xl border text-sm transition
            ${innerTab === 'chart'
              ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
              : 'border-white/10 bg-[#151922] text-white/65'
            }
          `}
        >
          Chart
        </button>

        <button
          onClick={() => setInnerTab('table')}
          className={`
            px-4 py-2 rounded-xl border text-sm transition
            ${innerTab === 'table'
              ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
              : 'border-white/10 bg-[#151922] text-white/65'
            }
          `}
        >
          Values Table
        </button>
      </div>

      {/* ================================
          CHART
      ================================= */}
      {innerTab === 'chart' && (
        <StrikeBarChart
          snapshotData={snapshotData}
          metric={metric}
          yDomain={yDomain}
          xScale={xScale}
        />
      )}

      {/* ================================
          DATE SLIDER
      ================================= */}
      <DateSlider
        dates={filteredDates}
        selectedDate={selectedDate}
        onChange={setSelectedDate}
      />

      {/* ================================
          TABLE
      ================================= */}
      {innerTab === 'table' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>CE</th>
                  <th>PE</th>
                </tr>
              </thead>

              <tbody>
                {tableRows.map((row) => {
                  const isATM = Number(row.strike) === Number(atmStrike);

                  return (
                    <tr
                      key={row.strike}
                      className={isATM ? 'bg-[#FFD700]/12' : ''}
                    >
                      <td className={isATM ? 'text-[#FFD700] font-semibold' : ''}>
                        {formatNumber(row.strike)}
                      </td>
                      <td>{formatNumber(row.ce)}</td>
                      <td>{formatNumber(row.pe)}</td>
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

// ─────────────────────────────────────────────────────────────────────────────

export default function Options() {
  const [tickerList, setTickerList]           = useState([]);
  const [selectedTicker, setSelectedTicker]   = useState('');
  const [expiries, setExpiries]               = useState([]);
  const [selectedExpiries, setSelectedExpiries] = useState([]);
  const [selectedMetric, setSelectedMetric]   = useState('oi');
  const [startDate, setStartDate]             = useState('');
  const [endDate, setEndDate]                 = useState('');
  const [activeExpiry, setActiveExpiry]       = useState('');
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');

  /* =====================================
      FETCH TICKERS
  ===================================== */

  useEffect(() => {
    let mounted = true;

    async function loadTickers() {
      try {
        setLoading(true);
        const response = await getTickers('options');
        if (!mounted) return;

        const tickers = response?.tickers || [];
        setTickerList(tickers);
        if (tickers.length > 0) setSelectedTicker(tickers[0]);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load tickers');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadTickers();
    return () => { mounted = false; };
  }, []);

  /* =====================================
      FETCH EXPIRIES
  ===================================== */

  useEffect(() => {
    if (!selectedTicker) return;

    let mounted = true;

    async function loadExpiries() {
      try {
        setError('');
        const response = await getExpiries('options', selectedTicker);
        if (!mounted) return;

        const expiryList = [...(response?.expiries || [])].reverse();
        setExpiries(expiryList);

        const defaults = expiryList.slice(0, 3);
        setSelectedExpiries(defaults);
        if (defaults.length > 0) setActiveExpiry(defaults[0]);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load expiries');
      }
    }

    loadExpiries();
    return () => { mounted = false; };
  }, [selectedTicker]);

  /* =====================================
      KEEP ACTIVE EXPIRY VALID
  ===================================== */

  useEffect(() => {
    if (!selectedExpiries.includes(activeExpiry)) {
      setActiveExpiry(selectedExpiries[0] || '');
    }
  }, [selectedExpiries, activeExpiry]);

  /* =====================================
      LOADING
  ===================================== */

  if (loading) {
    return (
      <div className="h-[calc(100vh-64px)] flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  /* =====================================
      ERROR
  ===================================== */

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
          <h2 className="text-red-400 text-lg font-semibold">
            Failed to load dashboard
          </h2>
          <p className="mt-3 text-sm text-red-100/80">{error}</p>
          <div className="mt-4 text-xs text-red-100/50">
            Ensure the FastAPI backend is running at:
            <br />
            http://127.0.0.1:8000
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex">
      {/* SIDEBAR */}
      <Sidebar
        tickerList={tickerList}
        selectedTicker={selectedTicker}
        onTickerChange={setSelectedTicker}
        expiries={expiries}
        selectedExpiries={selectedExpiries}
        onExpiriesChange={setSelectedExpiries}
        selectedMetric={selectedMetric}
        onMetricChange={setSelectedMetric}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      {/* MAIN */}
      <main className="flex-1 p-6 overflow-x-hidden">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">{selectedTicker}</h1>
          <p className="mt-1 text-sm text-white/45">NSE Derivatives Analytics</p>
        </div>

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
                metric={selectedMetric}
                startDate={startDate}
                endDate={endDate}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
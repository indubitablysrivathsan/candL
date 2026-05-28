// frontend/src/pages/Options.jsx

import { useEffect, useMemo, useState } from 'react';

import Sidebar from '../components/layout/Sidebar';
import MetricCard from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import DateSlider from '../components/shared/DateSlider';

import StrikeBarChart from '../components/charts/StrikeBarChart';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import PCRChart from '../components/charts/PCRChart';
import TickerAnalysisTable from '../components/charts/TickerAnalysisTable';
import { OptionsOIChart } from '../components/charts/OIChart';

import {
  getTickers,
  getExpiries,
  getDates,
  getSnapshot,
  getAnalytics,
  getDailyExpirySnapshot,
  getChartScale,
  formatCurrency,
  formatNumber,
  calculateTotals,
  getMetricFields,
  getOptionsCycleHistory,
  getOptionsMarketHistory,
  OPTIONS_COMBINED_TICKER 
} from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   EXPIRY PANEL
───────────────────────────────────────────────────────────────── */

function ExpiryPanel({ assetType, ticker, expiry, metric, startDate, endDate }) {
  const [availableDates, setAvailableDates]   = useState([]);
  const [selectedDate, setSelectedDate]       = useState('');
  const [snapshotData, setSnapshotData]       = useState(null);
  const [analyticsData, setAnalyticsData]     = useState([]);
  const [summaryRow, setSummaryRow]           = useState(null);
  const [loadingDates, setLoadingDates]       = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingSummary, setLoadingSummary]   = useState(false);
  const [yDomain, setYDomain]                 = useState(null);
  const [xScale, setXScale]                   = useState(null);
  const [error, setError]                     = useState('');
  const [innerTab, setInnerTab]               = useState('chart');

  /* ── Fetch dates ── */
  useEffect(() => {
    let mounted = true;
    setLoadingDates(true);
    setError('');

    getDates(assetType, ticker, expiry)
      .then((res) => {
        if (!mounted) return;
        const dates = res?.dates || [];
        setAvailableDates(dates);
        if (dates.length > 0) setSelectedDate(dates[dates.length - 1]);
      })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load dates'); })
      .finally(() => { if (mounted) setLoadingDates(false); });

    return () => { mounted = false; };
  }, [assetType, ticker, expiry]);

  /* ── Filtered dates ── */
  const filteredDates = useMemo(() => {
    if (metric === 'ts') return availableDates;
    return availableDates.filter((date) => {
      if (startDate && date < startDate) return false;
      if (endDate   && date > endDate)   return false;
      return true;
    });
  }, [availableDates, startDate, endDate, metric]);

  /* ── Auto-correct selected date ── */
  useEffect(() => {
    if (!filteredDates.length) return;
    if (!selectedDate || !filteredDates.includes(selectedDate)) {
      setSelectedDate(filteredDates[filteredDates.length - 1]);
    }
  }, [filteredDates, selectedDate]);

  /* ── Fetch snapshot (oi / oi_chng / vol) ── */
  useEffect(() => {
    if (metric === 'ts' || metric === 'daily_expiry_snapshot' || !selectedDate) return;
    let mounted = true;
    setLoadingSnapshot(true);
    setError('');

    getSnapshot(assetType, ticker, expiry, selectedDate)
      .then((res) => { if (mounted) setSnapshotData(res); })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load snapshot'); })
      .finally(() => { if (mounted) setLoadingSnapshot(false); });

    return () => { mounted = false; };
  }, [assetType, ticker, expiry, selectedDate, metric]);

  /* ── Fetch chart scale ── */
  useEffect(() => {
    if (metric === 'ts' || metric === 'daily_expiry_snapshot' || !filteredDates.length) return;
    let mounted = true;

    const start = filteredDates[0];
    const end   = filteredDates[filteredDates.length - 1];

    getChartScale(assetType, ticker, expiry, start, end, metric)
      .then((res) => {
        if (!mounted) return;
        setYDomain([res.y_min, res.y_max]);
        setXScale({ x_min: res.x_min, x_max: res.x_max, strike_gap: res.strike_gap });
      })
      .catch(() => { if (mounted) { setYDomain(null); setXScale(null); } });

    return () => { mounted = false; };
  }, [assetType, ticker, expiry, metric, filteredDates]);

  /* ── Fetch analytics (time series) ── */
  useEffect(() => {
    if (metric !== 'ts') return;
    let mounted = true;
    setLoadingAnalytics(true);
    setError('');

    getAnalytics(assetType, ticker, expiry)
      .then((res) => { if (mounted) setAnalyticsData(res?.rows || []); })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load analytics'); })
      .finally(() => { if (mounted) setLoadingAnalytics(false); });

    return () => { mounted = false; };
  }, [assetType, ticker, expiry, metric]);

  /* ── Fetch summary row (daily_expiry_snapshot) ── */
  useEffect(() => {
    if (metric !== 'daily_expiry_snapshot' || !selectedDate) return;
    let mounted = true;
    setLoadingSummary(true);
    setSummaryRow(null);
    setError('');

    getAnalytics(assetType, ticker, expiry, selectedDate, selectedDate)
      .then((res) => { if (mounted) setSummaryRow(res?.rows?.[0] ?? null); })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load summary'); })
      .finally(() => { if (mounted) setLoadingSummary(false); });

    return () => { mounted = false; };
  }, [assetType, ticker, expiry, selectedDate, metric]);

  /* ── Derived ── */
  const totals = useMemo(() => calculateTotals(snapshotData, metric), [snapshotData, metric]);

  const atmStrike = useMemo(() => {
    if (!snapshotData?.strikes?.length || snapshotData?.underlying == null) return null;
    let closest = snapshotData.strikes[0];
    let minDiff = Math.abs(Number(snapshotData.strikes[0].strike) - Number(snapshotData.underlying));
    snapshotData.strikes.forEach((s) => {
      const diff = Math.abs(Number(s.strike) - Number(snapshotData.underlying));
      if (diff < minDiff) { closest = s; minDiff = diff; }
    });
    return closest?.strike;
  }, [snapshotData]);

  const tableRows = useMemo(() => {
    if (!snapshotData?.strikes?.length) return [];
    const fields = getMetricFields(metric);
    return snapshotData.strikes.map((row) => ({ strike: row.strike, ce: row[fields.ce], pe: row[fields.pe] }));
  }, [snapshotData, metric]);

  /* ── Render guards ── */
  if (error) return (
    <div className="card p-6">
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
        <h3 className="text-red-400 font-semibold">Error</h3>
        <p className="mt-2 text-sm text-red-200/80">{error}</p>
      </div>
    </div>
  );

  if (loadingDates || loadingAnalytics) return (
    <div className="card min-h-[400px] flex items-center justify-center"><LoadingSpinner /></div>
  );

  if (metric !== 'ts' && metric !== 'daily_expiry_snapshot' && !snapshotData) return (
    <div className="card p-8"><p className="text-white/60">No snapshot data available</p></div>
  );

  /* ── Time series view ── */
  if (metric === 'ts') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInnerTab('chart')}
            className={`px-4 py-2 rounded-xl border text-sm transition ${
              innerTab === 'chart'
                ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                : 'border-white/10 bg-[#151922] text-white/65'
            }`}
          >
            Price & Max Pain
          </button>
          <button
            onClick={() => setInnerTab('pcr')}
            className={`px-4 py-2 rounded-xl border text-sm transition ${
              innerTab === 'pcr'
                ? 'border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726]'
                : 'border-white/10 bg-[#151922] text-white/65'
            }`}
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

  /* ── Daily expiry snapshot view ── */
  if (metric === 'daily_expiry_snapshot') {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 xl:grid-cols-4 md:grid-cols-2 gap-4">
          <MetricCard title="Underlying" value={formatCurrency(summaryRow?.underlying, 2)} accent="#FFD700" />
          <MetricCard title="Max Pain"   value={formatCurrency(summaryRow?.max_pain, 2)}   accent="#FF69B4" />
          <MetricCard
            title="PCR"
            value={summaryRow?.pcr != null ? Number(summaryRow.pcr).toFixed(3) : '--'}
            accent="#FFA726"
          />
          <MetricCard
            title="CE | PE Total"
            value={summaryRow?.ce != null && summaryRow?.pe != null
              ? `${formatNumber(summaryRow.ce)} | ${formatNumber(summaryRow.pe)}`
              : '--'}
            accent="#00B0F0"
          />
        </div>

        <DateSlider dates={filteredDates} selectedDate={selectedDate} onChange={setSelectedDate} />

        {loadingSummary ? (
          <div className="card min-h-[200px] flex items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div>
                <h3 className="text-sm font-semibold text-white">Daily Expiry Snapshot</h3>
                <p className="mt-0.5 text-xs text-white/45">{ticker} · {expiry} · {selectedDate}</p>
              </div>
              <button
                onClick={() => {
                  if (!summaryRow) return;
                  const csv = [
                    ['Ticker','Expiry','Trade Date','Underlying','Max Pain','PCR','CE','PE'].join(','),
                    [ticker, expiry, selectedDate, summaryRow.underlying ?? '', summaryRow.max_pain ?? '',
                     summaryRow.pcr ?? '', summaryRow.ce ?? '', summaryRow.pe ?? ''].join(','),
                  ].join('\n');
                  const a = Object.assign(document.createElement('a'), {
                    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
                    download: `${ticker}_${expiry}_${selectedDate}_daily_expiry_snapshot.csv`,
                  });
                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                }}
                className="px-4 py-2 rounded-xl border border-[#00B0F0]/25 bg-[#00B0F0]/10 text-[#00B0F0] text-sm transition hover:bg-[#00B0F0]/20"
              >
                Download CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead><tr><th>Field</th><th>Value</th></tr></thead>
                <tbody>
                  <tr><td>Underlying</td><td>{formatCurrency(summaryRow?.underlying, 2)}</td></tr>
                  <tr><td>Max Pain</td>  <td>{formatCurrency(summaryRow?.max_pain, 2)}</td></tr>
                  <tr><td>PCR</td>       <td>{summaryRow?.pcr != null ? Number(summaryRow.pcr).toFixed(3) : '--'}</td></tr>
                  <tr><td>CE Total</td>  <td>{formatNumber(summaryRow?.ce)}</td></tr>
                  <tr><td>PE Total</td>  <td>{formatNumber(summaryRow?.pe)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Normal view (oi / oi_chng / vol) ── */
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-4 md:grid-cols-2 gap-4">
        <MetricCard title="Underlying" value={formatCurrency(snapshotData?.underlying, 2)} accent="#FFD700" />
        <MetricCard title="Max Pain"   value={formatCurrency(snapshotData?.max_pain, 2)}   accent="#FF69B4" />
        <MetricCard
          title="PCR"
          value={snapshotData?.pcr != null ? Number(snapshotData.pcr).toFixed(3) : '--'}
          accent="#FFA726"
        />
        <MetricCard
          title="CE | PE Total"
          value={`${formatNumber(totals.ceTotal)} | ${formatNumber(totals.peTotal)}`}
          accent="#00B0F0"
        />
      </div>

      <div className="flex items-center gap-2">
        {['chart', 'table'].map((tab) => (
          <button
            key={tab}
            onClick={() => setInnerTab(tab)}
            className={`px-4 py-2 rounded-xl border text-sm transition capitalize ${
              innerTab === tab
                ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
                : 'border-white/10 bg-[#151922] text-white/65'
            }`}
          >
            {tab === 'chart' ? 'Chart' : 'Values Table'}
          </button>
        ))}
      </div>

      {innerTab === 'chart' && (
        <StrikeBarChart snapshotData={snapshotData} metric={metric} yDomain={yDomain} xScale={xScale} />
      )}

      <DateSlider dates={filteredDates} selectedDate={selectedDate} onChange={setSelectedDate} />

      {innerTab === 'table' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Strike</th><th>CE</th><th>PE</th></tr></thead>
              <tbody>
                {tableRows.map((row) => {
                  const isATM = Number(row.strike) === Number(atmStrike);
                  return (
                    <tr key={row.strike} className={isATM ? 'bg-[#FFD700]/12' : ''}>
                      <td className={isATM ? 'text-[#FFD700] font-semibold' : ''}>{formatNumber(row.strike)}</td>
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

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */

export default function Options({ assetType = 'stock_options' }) {
  const [tickerList, setTickerList]             = useState([]);
  const [selectedTicker, setSelectedTicker]     = useState('');
  const [expiries, setExpiries]                 = useState([]);
  const [selectedExpiries, setSelectedExpiries] = useState([]);
  const [selectedMetric, setSelectedMetric]     = useState('oi');
  const [startDate, setStartDate]               = useState('');
  const [endDate, setEndDate]                   = useState('');
  const [activeExpiry, setActiveExpiry]         = useState('');
  const [loading, setLoading]                   = useState(true);
  const [snapshotRows, setSnapshotRows]         = useState([]);
  const [loadingSnapshot, setLoadingSnapshot]   = useState(false);
  const [error, setError]                       = useState('');

  const [chartSelectedExpiries, setChartSelectedExpiries] = useState([]);

  const validChartExpiries = useMemo(() => {
    if (!expiries.length) return [];
    const today = new Date();
    const completed  = expiries.filter((e) => new Date(e) < today);
    const inProgress = expiries.find((e) => new Date(e) >= today);
    return inProgress ? [inProgress, ...completed] : completed;
  }, [expiries]);  

  useEffect(() => {
    if (!validChartExpiries.length) return;
    setChartSelectedExpiries(validChartExpiries.slice(0, 5));
  }, [validChartExpiries]);

  const isDailySnapshot = selectedMetric === 'daily_expiry_snapshot';

  const isTickerAnalysis = selectedMetric === 'ticker_analysis';

  const isOICharts = selectedMetric === 'oi_charts';

  // Reset when assetType changes
  useEffect(() => {
    setTickerList([]);
    setSelectedTicker('');
    setExpiries([]);
    setSelectedExpiries([]);
    setActiveExpiry('');
    setSelectedMetric('oi');
    setStartDate('');
    setEndDate('');
    setError('');
    setLoading(true);
  }, [assetType]);

  /* ── Fetch tickers ── */
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    getTickers(assetType)
      .then((res) => {
        if (!mounted) return;
        const tickers = res?.tickers || [];
        const withCombined = [...tickers, OPTIONS_COMBINED_TICKER];
        setTickerList(withCombined);
        if (tickers.length > 0) setSelectedTicker(tickers[0]);
      })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load tickers'); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [assetType]);

  /* ── Fetch expiries ── */
  useEffect(() => {
    if (!selectedTicker) return;
    let mounted = true;

    getExpiries(assetType, selectedTicker)
      .then((res) => {
        if (!mounted) return;
        const list = [...(res?.expiries || [])];
        setExpiries(list);
        const defaults = list.slice(0, 3);
        setSelectedExpiries(defaults);
        if (defaults.length > 0) setActiveExpiry(defaults[0]);
      })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load expiries'); });

    return () => { mounted = false; };
  }, [assetType, selectedTicker]);

  /* ── Fetch daily expiry snapshot ── */
  useEffect(() => {
    if (!isDailySnapshot || !selectedExpiries.length || (!startDate && !endDate)) return;
    let mounted = true;
    setLoadingSnapshot(true);

    getDailyExpirySnapshot(assetType, selectedExpiries[0], endDate || startDate)
      .then((res) => { if (mounted) setSnapshotRows(res?.rows || []); })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load daily snapshot'); })
      .finally(() => { if (mounted) setLoadingSnapshot(false); });

    return () => { mounted = false; };
  }, [assetType, isDailySnapshot, selectedExpiries, startDate, endDate]);

  /* ── Keep activeExpiry valid ── */
  useEffect(() => {
    if (!selectedExpiries.includes(activeExpiry)) {
      setActiveExpiry(selectedExpiries[0] || '');
    }
  }, [selectedExpiries, activeExpiry]);

  /* ── Force single expiry in snapshot mode ── */
  useEffect(() => {
    if (!isDailySnapshot || selectedExpiries.length <= 1) return;
    setSelectedExpiries([selectedExpiries[0]]);
    setActiveExpiry(selectedExpiries[0]);
  }, [isDailySnapshot, selectedExpiries]);

  if (loading) return (
    <div className="h-[calc(100vh-64px)] flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );

  if (error) return (
    <div className="p-6">
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
        <h2 className="text-red-400 text-lg font-semibold">Failed to load dashboard</h2>
        <p className="mt-3 text-sm text-red-100/80">{error}</p>
      </div>
    </div>
  );

  const label = assetType === 'index_options' ? 'Index Options' : 'Stock Options';

  return (
    <div className="flex min-h-screen">
      <Sidebar
        tickerList={tickerList}
        selectedTicker={selectedTicker}
        onTickerChange={setSelectedTicker}
        expiries={isOICharts ? validChartExpiries : expiries}
        selectedExpiries={isOICharts ? chartSelectedExpiries : selectedExpiries}
        onExpiriesChange={isOICharts
          ? (arr) => {
              const ordered = validChartExpiries.filter((e) => arr.includes(e));
              setChartSelectedExpiries(ordered.slice(0, 5));
            }
          : setSelectedExpiries
        }
        selectedMetric={selectedMetric}
        onMetricChange={setSelectedMetric}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        hideDateRange={isOICharts}
      />

      <main className="flex-1 p-6 overflow-x-hidden">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">{selectedTicker}</h1>
          <p className="mt-1 text-sm text-white/45">NSE {label} Analytics</p>
        </div>

        {selectedExpiries.length === 0 && !isOICharts && (
          <div className="card p-8"><p className="text-white/60">Select at least one expiry</p></div>
        )}

        {isDailySnapshot && (
          <div className="space-y-5">
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Daily Expiry Snapshot</h2>
                  <p className="mt-1 text-sm text-white/45">
                    Expiry: {selectedExpiries[0] || '--'} · Date: {startDate || '--'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (!snapshotRows.length) return;
                    const headers = ['Ticker','Underlying','Max Pain','PCR','CE','PE'];
                    const csv = [
                      headers.join(','),
                      ...snapshotRows.map((r) => [r.ticker, r.underlying, r.max_pain, r.pcr, r.ce, r.pe].join(',')),
                    ].join('\n');
                    const a = Object.assign(document.createElement('a'), {
                      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
                      download: `${selectedExpiries[0]}_${startDate}_daily_expiry_snapshot.csv`,
                    });
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  }}
                  className="px-4 py-2 rounded-xl border border-[#00B0F0]/25 bg-[#00B0F0]/10 text-[#00B0F0] text-sm transition hover:bg-[#00B0F0]/20"
                >
                  Download CSV
                </button>
              </div>
            </div>

            {loadingSnapshot ? (
              <div className="card min-h-[300px] flex items-center justify-center"><LoadingSpinner /></div>
            ) : (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table>
                    <thead>
                      <tr><th>Ticker</th><th>Underlying</th><th>Max Pain</th><th>PCR</th><th>CE</th><th>PE</th></tr>
                    </thead>
                    <tbody>
                      {snapshotRows.map((row) => (
                        <tr key={row.ticker}>
                          <td className="font-semibold text-[#00B0F0]">{row.ticker}</td>
                          <td>{formatCurrency(row.underlying, 2)}</td>
                          <td className="text-[#FF69B4]">{formatCurrency(row.max_pain, 2)}</td>
                          <td className={row.pcr >= 1 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                            {row.pcr != null ? Number(row.pcr).toFixed(3) : '--'}
                          </td>
                          <td>{formatNumber(row.ce)}</td>
                          <td>{formatNumber(row.pe)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!isDailySnapshot && !isTickerAnalysis && !isOICharts && selectedExpiries.length > 0 && (
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
              <ExpiryPanel
                key={`${assetType}-${selectedTicker}-${activeExpiry}`}
                assetType={assetType}
                ticker={selectedTicker}
                expiry={activeExpiry}
                metric={selectedMetric}
                startDate={startDate}
                endDate={endDate}
              />
            )}
          </>
        )}
        {isTickerAnalysis && selectedExpiries[0] && (
          <TickerAnalysisTable
            assetType={assetType}
            ticker={selectedTicker}
            selectedExpiry={selectedExpiries[0]}
            allExpiries={expiries}
          />
        )}
        {isOICharts && (
          <OptionsOIChart
            assetType={assetType}
            ticker={selectedTicker}
            allExpiries={expiries}
            selectedCycles={chartSelectedExpiries}
          />
        )}
      </main>
    </div>
  );
}
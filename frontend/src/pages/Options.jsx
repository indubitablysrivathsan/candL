// frontend/src/pages/Options.jsx

import { useEffect, useMemo, useRef, useState } from 'react';

import MetricCard from '../components/shared/MetricCard';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import DateSlider from '../components/shared/DateSlider';
import Divider from '../components/shared/Divider';
import TerminalBtn from '../components/shared/TerminalBtn';
import { PanelHeader } from '../components/shared/Panel';
import PortalDropdown from '../components/shared/PortalDropdown';
import ExpiryDropdown from '../components/shared/ExpiryDropdown';
import { TerminalTable, TerminalTr, TerminalTh, TerminalTd } from '../components/shared/DataTable';
import PageHeader from '../components/shared/PageHeader';

import StrikeBarChart from '../components/charts/StrikeBarChart';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import PCRChart from '../components/charts/PCRChart';
import TickerAnalysisTable from '../components/charts/TickerAnalysisTable';
import { OptionsOIChart } from '../components/charts/OIChart';
import { T } from '../theme';

import {
  getTickers,
  getExpiries,
  getDates,
  getSnapshot,
  getAnalytics,
  getDailyExpirySnapshot,
  getChartScale,
  stocks,
  formatCurrency,
  formatNumber,
  calculateTotals,
  getMetricFields,
  getOptionsCycleHistory,
  getOptionsMarketHistory,
  OPTIONS_COMBINED_TICKER,
} from '../api/client';

/* ─── shared inline style helpers ───────────────────────────── */
const panelStyle = {
  background: T.surface,
  border: `1px solid ${T.border}`,
};

const sectionLabel = (extra = {}) => ({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.textLo,
  ...extra,
});

const monoSm = {
  fontSize: 11,
  letterSpacing: '0.04em',
  color: T.textMid,
  fontFamily: 'inherit',
};

/* ─── tiny sub-components ────────────────────────────────────── */

/* ─── METRIC STRIP using MetricCard ─────────────────────────── */
function MetricStrip({ items }) {
  return (
    <div style={{
      display: 'flex',
      width: '100%',
      border: `1px solid ${T.border}`,
      overflow: 'hidden',
    }}>
      {items.map(({ title, value, subtitle, accent = T.amber }, i) => (
        <MetricCard
          key={title}
          title={title}
          value={value}
          subtitle={subtitle}
          accent={accent}
        />
      ))}
    </div>
  );
}

/* shared dropdown item style */
const dropItem = (active, disabled) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '7px 12px',
  fontSize: 11,
  fontFamily: 'inherit',
  letterSpacing: '0.05em',
  color: disabled ? T.textGhost : active ? T.amber : T.textHi,
  background: active ? T.amberDim : 'transparent',
  border: 'none',
  borderBottom: `1px solid ${T.border}`,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  borderRadius: 0,
  textTransform: 'uppercase',
  transition: 'background 0.1s',
});

/* ─── TICKER SEARCH DROPDOWN ─────────────────────────────────── */
function TickerSearch({ tickerList, selectedTicker, onChange, disabled }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() =>
    !search.trim() ? tickerList : tickerList.filter((t) => t.toLowerCase().includes(search.toLowerCase())),
  [search, tickerList]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={sectionLabel()}>Ticker</span>
      <div style={{ position: 'relative' }} ref={inputRef}>
        <input
          type="text"
          value={search}
          disabled={disabled}
          placeholder={selectedTicker || 'Search...'}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onChange={(e) => { if (!disabled) { setSearch(e.target.value); setOpen(true); } }}
          style={{
            width: '100%',
            background: T.bg,
            border: `1px solid ${open ? T.amber : T.border}`,
            padding: '5px 28px 5px 10px',
            minWidth: 200,
            fontSize: 12,
            fontFamily: 'inherit',
            color: T.textHi,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            outline: 'none',
            opacity: disabled ? 0.4 : 1,
            cursor: disabled ? 'not-allowed' : 'text',
            transition: 'border-color 0.15s',
            boxSizing: 'border-box',
            borderRadius: 0,
            height: 30,
          }}
        />
        <span style={{
          position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
          fontSize: 10, color: T.textLo, pointerEvents: 'none',
        }}>▾</span>
      </div>
      <PortalDropdown anchorRef={inputRef} open={open} minWidth={180}>
        {filtered.length === 0
          ? <div style={{ padding: '8px 12px', ...monoSm }}>No results</div>
          : filtered.map((ticker) => (
            <button
              key={ticker}
              onMouseDown={(e) => { e.preventDefault(); onChange(ticker); setSearch(''); setOpen(false); }}
              style={dropItem(ticker === selectedTicker, false)}
            >
              {ticker}
            </button>
          ))
        }
      </PortalDropdown>
    </div>
  );
}

/* ─── METRIC OPTIONS ─────────────────────────────────────────── */
const METRIC_OPTIONS = [
  { label: 'OI',        value: 'oi'                    },
  { label: 'OI Δ',      value: 'oi_chng'               },
  { label: 'Volume',    value: 'vol'                   },
  { label: 'T-Series',  value: 'ts'                    },
  { label: 'Dly Snap',  value: 'daily_expiry_snapshot' },
  { label: 'Tkr Anly',  value: 'ticker_analysis'       },
  { label: 'OI Chart',  value: 'oi_charts'             },
];

const rowStyle = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 0,
  borderBottom: `1px solid ${T.border}`,
  background: T.surface,
  flexShrink: 0,
};

const cellStyle = (extra = {}) => ({
  padding: '10px 16px',
  borderRight: `1px solid ${T.border}`,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 5,
  flexShrink: 0,
  ...extra,
});

/* ─── SELECTED EXPIRY CHIPS — only scrolls when chips overflow ─ */
function ExpiryChips({ activeExpiries, onRemove }) {
  const containerRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeExpiries]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        gap: 5,
        alignItems: 'center',
        overflowX: overflows ? 'auto' : 'visible',
        flexWrap: overflows ? 'nowrap' : 'wrap',
        minWidth: 0,
        paddingBottom: overflows ? 2 : 0,
      }}
    >
      {activeExpiries.map((exp) => (
        <div
          key={exp}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 8px',
            border: `1px solid ${T.amber}`,
            background: T.amberDim,
            fontSize: 10,
            color: T.amber,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            borderRadius: 0,
          }}
        >
          <span>{exp}</span>
          <button
            onMouseDown={(e) => { e.preventDefault(); onRemove(exp); }}
            style={{
              background: 'none',
              border: 'none',
              color: T.textLo,
              cursor: 'pointer',
              padding: 0,
              fontSize: 11,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >✕</button>
        </div>
      ))}
    </div>
  );
}

/* ─── CONTROL BAR ────────────────────────────────────────────── */
function ControlBar({
  tickerList, selectedTicker, onTickerChange,
  expiries, selectedExpiries, onExpiriesChange,
  selectedMetric, onMetricChange,
  startDate, endDate, onStartDateChange, onEndDateChange,
  isOICharts, validChartExpiries, chartSelectedExpiries, onChartExpiriesChange,
}) {
  const isDailySnapshot  = selectedMetric === 'daily_expiry_snapshot';
  const isTimeSeries     = selectedMetric === 'ts';
  const isTickerAnalysis = selectedMetric === 'ticker_analysis';
  const dateRangeDisabled = isTimeSeries || isTickerAnalysis;
  const disableEndDate    = isTimeSeries || isDailySnapshot;
  const singleSelect      = isDailySnapshot || isTickerAnalysis;

  const displayExpiries = isOICharts ? validChartExpiries : expiries;
  const activeExpiries  = isOICharts ? chartSelectedExpiries : selectedExpiries;

  const handleExpiryToggle = (exp) => {
    if (isOICharts) {
      if (chartSelectedExpiries.includes(exp)) {
        onChartExpiriesChange(chartSelectedExpiries.filter((e) => e !== exp));
      } else {
        const next = validChartExpiries
          .filter((e) => [...chartSelectedExpiries, exp].includes(e))
          .slice(0, 5);
        onChartExpiriesChange(next);
      }
    } else if (singleSelect) {
      onExpiriesChange([exp]);
    } else {
      if (selectedExpiries.includes(exp)) {
        onExpiriesChange(selectedExpiries.filter((e) => e !== exp));
      } else {
        onExpiriesChange([...selectedExpiries, exp]);
      }
    }
  };

  const dateInputStyle = {
    background: T.bg,
    border: `1px solid ${T.border}`,
    color: T.textHi,
    fontSize: 11,
    fontFamily: 'inherit',
    padding: '5px 8px',
    outline: 'none',
    letterSpacing: '0.03em',
    colorScheme: 'dark',
    width: 130,
    height: 30,
    borderRadius: 0,
    boxSizing: 'border-box',
  };

  return (
    <div style={{ background: T.surface, flexShrink: 0 }}>

      {/* ROW 1: Ticker + Metric */}
      <div style={rowStyle}>
        <div style={cellStyle({ minWidth: 180 })}>
          <TickerSearch
            tickerList={tickerList}
            selectedTicker={selectedTicker}
            onChange={onTickerChange}
            disabled={isDailySnapshot}
          />
        </div>

        <div style={cellStyle({ flex: 1 })}>
          <span style={sectionLabel({ marginBottom: 1 })}>Metric</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {METRIC_OPTIONS.map((opt) => (
              <TerminalBtn
                key={opt.value}
                active={selectedMetric === opt.value}
                onClick={() => onMetricChange(opt.value)}
              >
                {opt.label}
              </TerminalBtn>
            ))}
          </div>
        </div>
      </div>

      {/* ROW 2: Expiry + Chips + Date range */}
      <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>
        {/* Expiry dropdown */}
        <div style={cellStyle({ minWidth: 200 })}>
          <ExpiryDropdown
            expiries={displayExpiries}
            selectedExpiries={activeExpiries}
            onToggle={handleExpiryToggle}
            singleSelect={singleSelect}
            maxSelect={isOICharts ? 5 : undefined}
            label="Expiry"
          />
        </div>

        {/* Chips — only rendered (and only scrolls) when > 1 expiry selected */}
        {!singleSelect && activeExpiries.length > 1 && (
          <div style={{
            ...cellStyle({ flex: 1 }),
            flexDirection: 'row',
            alignItems: 'center',
            overflow: 'hidden',
          }}>
            <ExpiryChips activeExpiries={activeExpiries} onRemove={handleExpiryToggle} />
          </div>
        )}

        {/* Date range — push to right */}
        {!isOICharts && (
          <div style={{
            ...cellStyle({ marginLeft: 'auto', borderRight: 'none' }),
            opacity: dateRangeDisabled ? 0.30 : 1,
            pointerEvents: dateRangeDisabled ? 'none' : 'auto',
          }}>
            <span style={sectionLabel()}>{isDailySnapshot ? 'Date' : 'Date Range'}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="date"
                value={startDate || ''}
                onChange={(e) => onStartDateChange(e.target.value)}
                style={dateInputStyle}
              />
              {!disableEndDate && (
                <>
                  <span style={{ color: T.textLo, fontSize: 10 }}>→</span>
                  <input
                    type="date"
                    value={endDate || ''}
                    onChange={(e) => onEndDateChange(e.target.value)}
                    disabled={disableEndDate}
                    style={{ ...dateInputStyle, opacity: disableEndDate ? 0.4 : 1 }}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── EXPIRY PANEL ───────────────────────────────────────────── */
function ExpiryPanel({ assetType, ticker, expiry, metric, startDate, endDate }) {
  const [availableDates, setAvailableDates]     = useState([]);
  // selectedDate intentionally starts empty so it's always set fresh from filteredDates
  const [selectedDate, setSelectedDate]         = useState('');
  const [snapshotData, setSnapshotData]         = useState(null);
  const [analyticsData, setAnalyticsData]       = useState([]);
  const [summaryRow, setSummaryRow]             = useState(null);
  const [loadingDates, setLoadingDates]         = useState(true);
  const [loadingSnapshot, setLoadingSnapshot]   = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingSummary, setLoadingSummary]     = useState(false);
  const [yDomain, setYDomain]                   = useState(null);
  const [xScale, setXScale]                     = useState(null);
  const [error, setError]                       = useState('');
  const [innerTab, setInnerTab]                 = useState('chart');
  const [ohlcData, setOhlcData]                 = useState(null);

  /* ── fetch dates — reset selectedDate on key change ── */
  useEffect(() => {
    let mounted = true;
    setLoadingDates(true);
    setError('');
    setSelectedDate('');          // ← reset whenever ticker/expiry changes
    setAvailableDates([]);
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

  const filteredDates = useMemo(() => {
    if (metric === 'ts') return availableDates;
    return availableDates.filter((date) => {
      if (startDate && date < startDate) return false;
      if (endDate   && date > endDate)   return false;
      return true;
    });
  }, [availableDates, startDate, endDate, metric]);

  /* ── when date filter changes, clamp selectedDate into range ── */
  useEffect(() => {
    if (!filteredDates.length) return;
    // Only reset if current selectedDate is outside the filtered range
    if (!selectedDate || !filteredDates.includes(selectedDate)) {
      setSelectedDate(filteredDates[filteredDates.length - 1]);
    }
  }, [filteredDates]);   // intentionally exclude selectedDate to avoid loops

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

  useEffect(() => {
    if (metric === 'ts' || metric === 'daily_expiry_snapshot' || !filteredDates.length || !ticker) return;
    let mounted = true;
    const start = filteredDates[0];
    const end   = filteredDates[filteredDates.length - 1];
    stocks.ohlc(ticker, start, end)
      .then((rows) => {
        if (!mounted) return;
        const idx  = rows.findIndex((r) => r.trade_date === selectedDate);
        const row     = idx >= 0 ? rows[idx] : rows[rows.length - 1] ?? null;
        const prevRow = idx >= 0 ? rows[idx - 1] : null;
        setOhlcData({ ...row, prevClose: prevRow?.close });
      })
      .catch(() => { if (mounted) setOhlcData(null); });
    return () => { mounted = false; };
  }, [ticker, metric, filteredDates, selectedDate]);

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

  const totals   = useMemo(() => calculateTotals(snapshotData, metric), [snapshotData, metric]);
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

  /* ── render guards ── */
  if (error) return (
    <div style={{ ...panelStyle, padding: 16, borderLeft: `3px solid ${T.red}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: T.red, marginBottom: 6, textTransform: 'uppercase' }}>Error</div>
      <div style={{ fontSize: 11, color: T.textMid }}>{error}</div>
    </div>
  );

  if (loadingDates || loadingAnalytics) return (
    <div style={{ ...panelStyle, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <LoadingSpinner />
    </div>
  );

  if (metric !== 'ts' && metric !== 'daily_expiry_snapshot' && !snapshotData) return (
    <div style={{ ...panelStyle, padding: 24 }}>
      <span style={monoSm}>No snapshot data available</span>
    </div>
  );

  /* ── time series ── */
  if (metric === 'ts') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TimeSeriesChart analyticsData={analyticsData} />
        <PCRChart analyticsData={analyticsData} />
      </div>
    );
  }

  /* ── normal OI / VOL / OI_CHNG view ── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <MetricStrip items={[
        { title: 'Underlying',    value: formatCurrency(snapshotData?.underlying, 2),                                    accent: T.blue  },
        { title: 'Max Pain',      value: formatCurrency(snapshotData?.max_pain, 2),                                      accent: T.purple   },
        { title: 'PCR',           value: snapshotData?.pcr != null ? Number(snapshotData.pcr).toFixed(3) : '--',         accent: snapshotData?.pcr >= 1 ? T.green : T.red },
        { title: 'CE | PE Total', value: `${formatNumber(totals.ceTotal)} | ${formatNumber(totals.peTotal)}`,            accent: T.textHi },
      ]} />

      <div style={{ display: 'flex', gap: 4 }}>
        {[['chart', 'Chart'], ['table', 'Values']].map(([tab, lbl]) => (
          <TerminalBtn key={tab} active={innerTab === tab} onClick={() => setInnerTab(tab)}>{lbl}</TerminalBtn>
        ))}
      </div>

      {innerTab === 'chart' && (
        <StrikeBarChart snapshotData={snapshotData} metric={metric} yDomain={yDomain} xScale={xScale} ohlcData={ohlcData} />
      )}

      <DateSlider dates={filteredDates} selectedDate={selectedDate} onChange={setSelectedDate} />

      {innerTab === 'table' && (
        <div style={panelStyle}>
          <TerminalTable>
            <thead>
              <TerminalTr header>
                <TerminalTh>Strike</TerminalTh>
                <TerminalTh>CE</TerminalTh>
                <TerminalTh>PE</TerminalTh>
              </TerminalTr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const isATM = Number(row.strike) === Number(atmStrike);
                return (
                  <TerminalTr key={row.strike} atm={isATM}>
                    <TerminalTd accent={isATM ? T.amber : undefined} bold={isATM}>{formatNumber(row.strike)}</TerminalTd>
                    <TerminalTd>{formatNumber(row.ce)}</TerminalTd>
                    <TerminalTd>{formatNumber(row.pe)}</TerminalTd>
                  </TerminalTr>
                );
              })}
            </tbody>
          </TerminalTable>
        </div>
      )}
    </div>
  );
}

function downloadCsv(csv, filename) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function sortExpiries(expiries, tradeDate) {
  if (!tradeDate) return [...expiries];

  const ref = new Date(tradeDate);

  const upcoming = [];
  const past = [];

  expiries.forEach((e) => {
    const d = new Date(e);

    if (d >= ref) {
      upcoming.push(e);
    } else {
      past.push(e);
    }
  });

  upcoming.sort((a, b) => new Date(a) - new Date(b));
  past.sort((a, b) => new Date(b) - new Date(a));

  return [...upcoming, ...past];
}

/* ─── MAIN PAGE ──────────────────────────────────────────────── */
export default function Options({ assetType = 'stock_options' }) {
  const [tickerList, setTickerList]             = useState([]);
  const [selectedTicker, setSelectedTicker]     = useState('');
  const [expiries, setExpiries]                 = useState([]);
  const [selectedExpiries, setSelectedExpiries] = useState([]);
  const [selectedMetric, setSelectedMetric]     = useState('oi');
  const [dailySnapshotDate, setDailySnapshotDate] = useState('');
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
    setChartSelectedExpiries((prev) => prev.length > 0 ? prev : validChartExpiries.slice(0, 5));
  }, [validChartExpiries]);

  const isDailySnapshot  = selectedMetric === 'daily_expiry_snapshot';
  const isTickerAnalysis = selectedMetric === 'ticker_analysis';
  const isOICharts       = selectedMetric === 'oi_charts';

  const displayTickerList = useMemo(() =>
    isOICharts ? [...tickerList, OPTIONS_COMBINED_TICKER] : tickerList,
  [tickerList, isOICharts]);

  /* reset on assetType change */
  useEffect(() => {
    setTickerList([]); setSelectedTicker(''); setExpiries([]); setSelectedExpiries([]);
    setActiveExpiry(''); setSelectedMetric('oi'); setStartDate(''); setEndDate('');
    setError(''); setLoading(true);
  }, [assetType]);

  /* fetch tickers */
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
      .catch((err) => { console.error(err); if (!mounted) return; setTickerList([]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [assetType]);

  /* fetch expiries */
  useEffect(() => {
    if (!selectedTicker && !isDailySnapshot) return;
    if (selectedTicker === OPTIONS_COMBINED_TICKER) return;

    let mounted = true;

    getExpiries(
      assetType,
      isDailySnapshot ? null : selectedTicker
    )
      .then((res) => {
        if (!mounted) return;

        const list = sortExpiries(res?.expiries || [], dailySnapshotDate);

        setExpiries(list);

        if (isDailySnapshot) {
            setSelectedExpiries(list.length ? [list[0]] : []);
        } else {
            const defaults = list.slice(0, 3);
            setSelectedExpiries(defaults);
            setActiveExpiry(defaults[0] || "");
        }
      });

    return () => {
      mounted = false;
    };
  }, [assetType, selectedTicker, isDailySnapshot, dailySnapshotDate]);

  useEffect(() => {
    if (!isOICharts && selectedTicker === OPTIONS_COMBINED_TICKER)
      setSelectedTicker(tickerList[0] || '');
  }, [isOICharts, selectedTicker, tickerList]);

  /* daily expiry snapshot fetch */
  useEffect(() => {
    if (!isDailySnapshot || !selectedExpiries.length || !dailySnapshotDate) return;
    let mounted = true;
    setLoadingSnapshot(true);
    getDailyExpirySnapshot(assetType, selectedExpiries[0], dailySnapshotDate)
      .then((res) => { if (mounted) setSnapshotRows(res?.rows || []); })
      .catch((err) => { if (mounted) setError(err.message || 'Failed to load daily snapshot'); })
      .finally(() => { if (mounted) setLoadingSnapshot(false); });
    return () => { mounted = false; };
  }, [assetType, isDailySnapshot, selectedExpiries, dailySnapshotDate]);

  useEffect(() => {
    if (!selectedExpiries.includes(activeExpiry)) setActiveExpiry(selectedExpiries[0] || '');
  }, [selectedExpiries, activeExpiry]);

  useEffect(() => {
    if (!isDailySnapshot || selectedExpiries.length <= 1) return;
    setSelectedExpiries([selectedExpiries[0]]);
    setActiveExpiry(selectedExpiries[0]);
  }, [isDailySnapshot]);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
      <LoadingSpinner size="lg" />
    </div>
  );

  if (error) console.error(error);

  const pageLabel = assetType === 'index_options' ? 'Index Options' : 'Stock Options';

  return (
    <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace" }}>

      {/* ── control bar ── */}
      <ControlBar
        tickerList={displayTickerList}
        selectedTicker={selectedTicker}
        onTickerChange={setSelectedTicker}
        expiries={expiries}
        selectedExpiries={selectedExpiries}
        onExpiriesChange={setSelectedExpiries}
        selectedMetric={selectedMetric}
        onMetricChange={setSelectedMetric}
        startDate={isDailySnapshot ? dailySnapshotDate : startDate}
        endDate={endDate}
        onStartDateChange={
          isDailySnapshot
            ? setDailySnapshotDate
            : setStartDate
        }
        onEndDateChange={setEndDate}
        isOICharts={isOICharts}
        validChartExpiries={validChartExpiries}
        chartSelectedExpiries={chartSelectedExpiries}
        onChartExpiriesChange={setChartSelectedExpiries}
      />

      {/* ── page header ── */}
      <PageHeader
        title={selectedTicker || '—'}
        extra={[`NSE · ${pageLabel}`]}
        liveLabel="NSE"
      />

      {/* ── main content ── */}
      <main style={{ flex: 1, padding: '16px 20px', overflowX: 'hidden' }}>

        {selectedExpiries.length === 0 && !isOICharts && (
          <div style={{
            ...panelStyle,
            padding: '32px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderLeft: `3px solid ${T.amberDim}`,
          }}>
            <span style={{ fontSize: 18, opacity: 0.4 }}>◈</span>
            <span style={{ ...monoSm, color: T.textLo, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Select at least one expiry to continue
            </span>
          </div>
        )}

        {/* ── daily snapshot market-wide table ── */}
        {isDailySnapshot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={panelStyle}>
              <PanelHeader
                title="Daily Expiry Snapshot"
                subtitle={`${selectedExpiries[0] || '--'} · ${dailySnapshotDate || '--'}`}
                right={<TerminalBtn onClick={() => {
                  if (!snapshotRows.length) return;
                  const headers = ['Ticker', 'Underlying', 'Max Pain', 'PCR', 'CE', 'PE'];
                  const csv = [
                    headers.join(','),
                    ...snapshotRows.map((r) => [r.ticker, r.underlying_price, r.max_pain, r.pcr, r.ce, r.pe].join(',')),
                  ].join('\n');
                  downloadCsv(csv, `${selectedExpiries[0]}_${dailySnapshotDate}_daily_expiry_snapshot.csv`);
                }}>↓ CSV</TerminalBtn>}
              />
              {loadingSnapshot ? (
                <div style={{ minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LoadingSpinner />
                </div>
              ) : (
                <TerminalTable>
                  <thead>
                    <TerminalTr header>
                      <TerminalTh>Ticker</TerminalTh>
                      <TerminalTh>Underlying</TerminalTh>
                      <TerminalTh>Max Pain</TerminalTh>
                      <TerminalTh>PCR</TerminalTh>
                      <TerminalTh>CE</TerminalTh>
                      <TerminalTh>PE</TerminalTh>
                    </TerminalTr>
                  </thead>
                  <tbody>
                    {snapshotRows.map((row) => (
                      <TerminalTr key={row.ticker}>
                        <TerminalTd accent={T.amber} bold>{row.ticker}</TerminalTd>
                        <TerminalTd accent={T.textHi}>{formatCurrency(row.underlying_price, 2)}</TerminalTd>
                        <TerminalTd accent={T.pink}>{formatCurrency(row.max_pain, 2)}</TerminalTd>
                        <TerminalTd accent={row.pcr >= 1 ? T.green : T.red}>
                          {row.pcr != null ? Number(row.pcr).toFixed(3) : '--'}
                        </TerminalTd>
                        <TerminalTd>{formatNumber(row.ce)}</TerminalTd>
                        <TerminalTd>{formatNumber(row.pe)}</TerminalTd>
                      </TerminalTr>
                    ))}
                  </tbody>
                </TerminalTable>
              )}
            </div>
          </div>
        )}

        {/* ── normal / ts / oi views with expiry tabs ── */}
        {!isDailySnapshot && !isTickerAnalysis && !isOICharts && selectedExpiries.length > 0 && (
          <>
            {/* expiry tabs */}
            <div style={{
              display: 'flex',
              gap: 0,
              marginBottom: 14,
              borderBottom: `1px solid ${T.border}`,
              overflowX: 'auto',
            }}>
              {selectedExpiries.map((expiry) => (
                <button
                  key={expiry}
                  onClick={() => setActiveExpiry(expiry)}
                  style={{
                    padding: '8px 18px',
                    fontSize: 10,
                    letterSpacing: '0.09em',
                    fontWeight: activeExpiry === expiry ? 700 : 400,
                    color: activeExpiry === expiry ? T.amber : T.textMid,
                    background: activeExpiry === expiry ? T.amberDim : 'transparent',
                    border: 'none',
                    borderBottom: activeExpiry === expiry ? `2px solid ${T.amber}` : '2px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    textTransform: 'uppercase',
                    transition: 'color 0.15s, background 0.15s',
                    marginBottom: -1,
                    borderRadius: 0,
                  }}
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
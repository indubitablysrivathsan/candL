// frontend/src/pages/Futures.jsx

import { useEffect, useMemo, useRef, useState } from 'react';

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
  getMarketDates,
  formatCurrency,
  formatNumber,
  QUADRANT_META,
  FUTURES_COMBINED_TICKER,
} from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   DESIGN TOKENS  (matches Options.jsx terminal aesthetic)
───────────────────────────────────────────────────────────────── */
const T = {
  bg:        '#06080c',
  surface:   '#0b0f16',
  surfaceHi: '#111720',
  border:    'rgba(255,255,255,0.07)',
  borderHi:  'rgba(255,255,255,0.14)',
  amber:     '#F0A500',
  amberDim:  'rgba(240,165,0,0.12)',
  green:     '#00C896',
  red:       '#E05252',
  blue:      '#4A9EFF',
  textHi:    'rgba(255,255,255,0.90)',
  textMid:   'rgba(255,255,255,0.50)',
  textLo:    'rgba(255,255,255,0.25)',
  textGhost: 'rgba(255,255,255,0.12)',
};

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

const normalizeExpiry = (expiry) => (expiry ? expiry.split('T')[0] : expiry);

/* ─────────────────────────────────────────────────────────────────
   SHARED STYLE HELPERS
───────────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────────
   TINY SHARED COMPONENTS
───────────────────────────────────────────────────────────────── */
function Divider() {
  return <div style={{ height: 1, background: T.border }} />;
}

function TerminalBtn({ active, children, onClick, disabled, color, style = {} }) {
  const accent     = color || T.amber;
  const accentDim  = color ? `${color}20` : T.amberDim;
  const base = {
    padding: '4px 11px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    border: `1px solid ${active ? accent : T.border}`,
    background: active ? accentDim : 'transparent',
    color: active ? accent : T.textMid,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'color 0.15s, border-color 0.15s, background 0.15s',
    whiteSpace: 'nowrap',
    borderRadius: 0,
    fontFamily: 'inherit',
    ...style,
  };
  return <button style={base} onClick={onClick} disabled={disabled}>{children}</button>;
}

function TerminalTable({ children }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, letterSpacing: '0.03em', fontFamily: 'inherit' }}>
      {children}
    </table>
  );
}
function TerminalTr({ children, header }) {
  return (
    <tr style={{
      borderBottom: `1px solid ${T.border}`,
      background: header ? 'rgba(255,255,255,0.025)' : 'transparent',
    }}>
      {children}
    </tr>
  );
}
function TerminalTh({ children }) {
  return (
    <th style={{
      padding: '7px 14px',
      textAlign: 'left',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: T.textLo,
    }}>
      {children}
    </th>
  );
}
function TerminalTd({ children, accent, bold }) {
  return (
    <td style={{ padding: '6px 14px', color: accent || T.textMid, fontWeight: bold ? 600 : 400 }}>
      {children}
    </td>
  );
}

function PanelHeader({ title, meta, onExport }) {
  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: `1px solid ${T.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.textHi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {title}
        </span>
        {meta && <span style={monoSm}>{meta}</span>}
      </div>
      {onExport && (
        <TerminalBtn onClick={onExport}>↓ CSV</TerminalBtn>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   ANALYTICS PANEL
───────────────────────────────────────────────────────────────── */
function AnalyticsPanel({ assetType, ticker, expiry, allExpiries }) {
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [activeTab, setActiveTab] = useState('table');

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

  const cycleData = useMemo(() => {
    if (!data.length) return data;
    if (assetType === 'index_futures') return data;
    const current = new Date(expiry);
    const sortedExpiryChain = [...allExpiries].sort((a, b) => new Date(a) - new Date(b));
    const idx = sortedExpiryChain.indexOf(expiry);
    const prevExpiry = idx > 0 ? new Date(sortedExpiryChain[idx - 1]) : null;
    if (!prevExpiry) return data;
    return data.filter((r) => {
      const td = new Date(r.trade_date);
      return td > prevExpiry && td <= current;
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
    <div style={{ ...panelStyle, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <LoadingSpinner />
    </div>
  );
  if (error) return (
    <div style={{ ...panelStyle, padding: 16, borderLeft: `3px solid ${T.red}` }}>
      <div style={{ ...sectionLabel(), color: T.red, marginBottom: 6 }}>Error</div>
      <div style={monoSm}>{error}</div>
    </div>
  );
  if (!data.length) return (
    <div style={{ ...panelStyle, padding: 24 }}>
      <span style={{ ...monoSm, color: T.textLo, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        No analytics data available.
      </span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Metric cards — reuse existing MetricCard component */}
      <div style={{ display: 'flex', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
        <MetricCard
          title="Max OI (cycle)"
          value={stats ? (<>{formatNumber(stats.maxOI.open_int)}<br />{formatDate(stats.maxOI.trade_date)}</>) : '--'}
          accent="#92D050"
        />
        <MetricCard
          title="Min OI (cycle)"
          value={stats ? (<>{formatNumber(stats.minOI.open_int)}<br />{formatDate(stats.minOI.trade_date)}</>) : '--'}
          accent={T.red}
        />
        <MetricCard
          title="Max Close (cycle)"
          value={stats ? (<>{formatCurrency(stats.maxClose.close, 2)}<br />{formatDate(stats.maxClose.trade_date)}</>) : '--'}
          accent={T.blue}
        />
        <MetricCard
          title="Min Close (cycle)"
          value={stats ? (<>{formatCurrency(stats.minClose.close, 2)}<br />{formatDate(stats.minClose.trade_date)}</>) : '--'}
          accent={T.amber}
        />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4 }}>
        <TerminalBtn active={activeTab === 'table'} onClick={() => setActiveTab('table')}>
          Rolling Table
        </TerminalBtn>
        <TerminalBtn active={activeTab === 'chart'} onClick={() => setActiveTab('chart')} color="#92D050">
          OI Chart
        </TerminalBtn>
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
        <div style={panelStyle}>
          <PanelHeader
            title={`Rolling Analytics — ${ticker} / ${expiry}`}
            onExport={() => {
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
          />
          <div style={{ overflowX: 'auto' }}>
            <TerminalTable>
              <thead>
                <TerminalTr header>
                  <TerminalTh>Date</TerminalTh><TerminalTh>Close</TerminalTh>
                  <TerminalTh>Chng Price</TerminalTh><TerminalTh>Chng %</TerminalTh>
                  <TerminalTh>OI</TerminalTh><TerminalTh>Chng OI</TerminalTh>
                  <TerminalTh>Chng OI %</TerminalTh><TerminalTh>Basis</TerminalTh>
                  <TerminalTh>CoC %</TerminalTh><TerminalTh>Vol/OI</TerminalTh>
                  <TerminalTh>DTE</TerminalTh><TerminalTh>Signal</TerminalTh>
                </TerminalTr>
              </thead>
              <tbody>
                {[...data].reverse().map((row) => {
                  const meta = QUADRANT_META[row.quadrant] ?? QUADRANT_META.long_buildup;
                  return (
                    <TerminalTr key={row.trade_date}>
                      <TerminalTd accent={T.textLo}>{row.trade_date}</TerminalTd>
                      <TerminalTd accent={T.textHi}>{formatCurrency(row.close, 2)}</TerminalTd>
                      <TerminalTd accent={row.chng_in_price >= 0 ? T.green : T.red}>
                        {row.chng_in_price >= 0 ? '+' : ''}{formatNumber(row.chng_in_price, 2)}
                      </TerminalTd>
                      <TerminalTd accent={row.chng_price_per >= 0 ? T.green : T.red}>
                        {formatPercent(row.chng_price_per)}
                      </TerminalTd>
                      <TerminalTd accent={row.open_int >= 0 ? T.green : T.red}>
                        {formatNumber(row.open_int)}
                      </TerminalTd>
                      <TerminalTd accent={row.chng_in_oi >= 0 ? T.green : T.red}>
                        {row.chng_in_oi >= 0 ? '+' : ''}{formatNumber(row.chng_in_oi)}
                      </TerminalTd>
                      <TerminalTd accent={row.chng_oi_per >= 0 ? T.green : T.red}>
                        {formatPercent(row.chng_oi_per)}
                      </TerminalTd>
                      <TerminalTd accent={row.basis >= 0 ? T.green : T.red}>
                        {formatNumber(row.basis, 2)}
                      </TerminalTd>
                      <TerminalTd>{row.cost_of_carry != null ? `${(Number(row.cost_of_carry) * 100).toFixed(2)}%` : '--'}</TerminalTd>
                      <TerminalTd>{row.volume_oi_ratio != null ? Number(row.volume_oi_ratio).toFixed(3) : '--'}</TerminalTd>
                      <TerminalTd accent={T.textLo}>{row.days_to_expiry ?? '--'}</TerminalTd>
                      <TerminalTd>
                        <span style={{
                          padding: '2px 7px',
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.10em',
                          textTransform: 'uppercase',
                          color: meta.color,
                          background: `${meta.color}18`,
                          border: `1px solid ${meta.color}30`,
                        }}>
                          {meta.label ?? row.quadrant}
                        </span>
                      </TerminalTd>
                    </TerminalTr>
                  );
                })}
              </tbody>
            </TerminalTable>
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
  marketDates,
  screenerExpiries,
  chartSelectedExpiries,
  allScreenerExpiries,
  chartTicker,
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

  useEffect(() => {
    if (allDates.length > 0) {
      const last = allDates[allDates.length - 1];
      setSelectedDate(last);
      setPendingDate(last);
    }
  }, [allDates]);

  useEffect(() => {
    if (!pendingDate) return;
    const timer = setTimeout(() => setSelectedDate(pendingDate), 120);
    return () => clearTimeout(timer);
  }, [pendingDate]);

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
      map[q].sort((a, b) => Math.abs(b.chng_oi_per ?? 0) - Math.abs(a.chng_oi_per ?? 0));
    });
    return map;
  }, [data, activeScreenerExpiry]);

  const activeRows = grouped[activeQuadrant] ?? [];
  const meta       = QUADRANT_META[activeQuadrant] ?? QUADRANT_META.long_buildup;

  if (activeTab === 'charts') {
    return (
      <ScreenerOIChart
        assetType={assetType}
        ticker={chartTicker}
        allExpiries={allScreenerExpiries}
        selectedCycles={chartSelectedExpiries}
        allDates={marketDates}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Expiry tabs */}
      {screenerExpiries.length > 0 && (
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
          {screenerExpiries.map((expiry) => (
            <TerminalBtn
              key={expiry}
              active={activeScreenerExpiry === expiry}
              onClick={() => onScreenerExpiryChange(expiry)}
              color={T.amber}
            >
              {expiry}
            </TerminalBtn>
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
      <div style={{ display: 'flex', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
        {QUADRANTS.map((q) => {
          const m = QUADRANT_META[q];
          const isActive = activeQuadrant === q;
          return (
            <button
              key={q}
              onClick={() => setActiveQuadrant(q)}
              style={{
                flex: 1,
                padding: '12px 16px',
                textAlign: 'left',
                background: isActive ? `${m.color}10` : T.surface,
                border: 'none',
                borderRight: `1px solid ${T.border}`,
                borderBottom: isActive ? `2px solid ${m.color}` : `2px solid transparent`,
                cursor: 'pointer',
                transition: 'background 0.15s',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{grouped[q]?.length ?? 0}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textHi, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>{m.label}</div>
              <div style={{ fontSize: 9, color: T.textLo, letterSpacing: '0.06em', marginTop: 2 }}>{m.desc}</div>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ ...panelStyle, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingSpinner />
        </div>
      ) : error ? (
        <div style={{ ...panelStyle, padding: 16, borderLeft: `3px solid ${T.red}` }}>
          <div style={{ ...sectionLabel(), color: T.red, marginBottom: 6 }}>Error</div>
          <div style={monoSm}>{error}</div>
        </div>
      ) : (
        <div style={panelStyle}>
          <div style={{
            padding: '10px 16px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textHi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{meta.label}</span>
            <span style={monoSm}>{meta.desc}</span>
            <span style={{ marginLeft: 'auto', ...monoSm, color: T.textLo }}>{activeRows.length} contracts</span>
          </div>

          {activeRows.length === 0 ? (
            <div style={{ padding: '24px 16px' }}>
              <span style={{ ...monoSm, color: T.textLo, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                No contracts in this quadrant for {selectedDate}{activeScreenerExpiry ? ` / ${activeScreenerExpiry}` : ''}.
              </span>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <TerminalTable>
                <thead>
                  <TerminalTr header>
                    <TerminalTh>#</TerminalTh>
                    <TerminalTh>Ticker</TerminalTh><TerminalTh>Expiry</TerminalTh>
                    <TerminalTh>Close</TerminalTh><TerminalTh>Chng Price</TerminalTh>
                    <TerminalTh>Chng %</TerminalTh><TerminalTh>OI</TerminalTh>
                    <TerminalTh>Combined OI</TerminalTh><TerminalTh>Chng OI</TerminalTh>
                    <TerminalTh>Chng OI %</TerminalTh><TerminalTh>Basis</TerminalTh>
                    <TerminalTh>CoC %</TerminalTh><TerminalTh>Vol/OI</TerminalTh>
                    <TerminalTh>DTE</TerminalTh>
                  </TerminalTr>
                </thead>
                <tbody>
                  {activeRows.map((row, idx) => (
                    <TerminalTr key={`${row.ticker}-${row.expiry}`}>
                      <TerminalTd accent={T.textGhost}>{idx + 1}</TerminalTd>
                      <TerminalTd accent={T.amber} bold>{row.ticker}</TerminalTd>
                      <TerminalTd accent={T.textLo}>{row.expiry}</TerminalTd>
                      <TerminalTd accent={T.textHi}>{formatCurrency(row.close, 2)}</TerminalTd>
                      <TerminalTd accent={row.chng_in_price >= 0 ? T.green : T.red}>
                        {row.chng_in_price >= 0 ? '+' : ''}{formatNumber(row.chng_in_price, 2)}
                      </TerminalTd>
                      <TerminalTd accent={row.chng_price_per >= 0 ? T.green : T.red}>
                        {formatPercent(row.chng_price_per)}
                      </TerminalTd>
                      <TerminalTd accent={row.open_int >= 0 ? T.green : T.red}>
                        {formatNumber(row.open_int)}
                      </TerminalTd>
                      <TerminalTd accent={combinedOIMap[row.ticker] >= 0 ? T.green : T.red}>
                        {combinedOIMap[row.ticker] != null ? formatNumber(combinedOIMap[row.ticker]) : '--'}
                      </TerminalTd>
                      <TerminalTd accent={row.chng_in_oi >= 0 ? T.green : T.red}>
                        {row.chng_in_oi >= 0 ? '+' : ''}{formatNumber(row.chng_in_oi)}
                      </TerminalTd>
                      <TerminalTd accent={row.chng_oi_per >= 0 ? T.green : T.red}>
                        {formatPercent(row.chng_oi_per)}
                      </TerminalTd>
                      <TerminalTd accent={row.basis >= 0 ? T.green : T.red}>
                        {formatNumber(row.basis, 2)}
                      </TerminalTd>
                      <TerminalTd>{row.cost_of_carry != null ? `${(Number(row.cost_of_carry) * 100).toFixed(2)}%` : '--'}</TerminalTd>
                      <TerminalTd>{row.volume_oi_ratio != null ? Number(row.volume_oi_ratio).toFixed(3) : '--'}</TerminalTd>
                      <TerminalTd accent={T.textLo}>{row.days_to_expiry ?? '--'}</TerminalTd>
                    </TerminalTr>
                  ))}
                </tbody>
              </TerminalTable>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExpiryDropdown({ expiries, selectedExpiries, onToggle, singleSelect, maxSelect, label: labelText }) {
  const [open, setOpen] = useState(false);
  const wrapRef    = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const triggerLabel = useMemo(() => {
    if (selectedExpiries.length === 0) return 'Select expiry…';
    if (selectedExpiries.length === 1) return selectedExpiries[0];
    return `${selectedExpiries.length} selected`;
  }, [selectedExpiries]);

  const isAtMax = maxSelect && selectedExpiries.length >= maxSelect;

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={sectionLabel()}>
        {labelText}
        {maxSelect ? <span style={{ color: T.textGhost, marginLeft: 5 }}>max {maxSelect}</span> : ''}
      </span>
      <div ref={triggerRef}>
        <button onClick={() => setOpen((v) => !v)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '5px 10px', minWidth: 200, height: 30, background: T.bg,
          border: `1px solid ${open ? T.amber : T.border}`, color: selectedExpiries.length ? T.textHi : T.textMid,
          fontSize: 11, fontFamily: 'inherit', letterSpacing: '0.06em', textTransform: 'uppercase',
          cursor: 'pointer', transition: 'border-color 0.15s', whiteSpace: 'nowrap', borderRadius: 0,
        }}>
          <span>{triggerLabel}</span>
          <span style={{ fontSize: 10, color: T.textLo }}>▾</span>
        </button>
      </div>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 9999, marginTop: 34,
          minWidth: 200, maxHeight: 300, overflowY: 'auto',
          background: '#0b0f16', border: `1px solid ${T.borderHi}`,
          boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        }}>
          {expiries.map((exp) => {
            const active   = selectedExpiries.includes(exp);
            const disabled = !active && !!isAtMax;
            return (
              <button key={exp} onMouseDown={(e) => { e.preventDefault(); if (!disabled) { onToggle(exp); if (singleSelect) setOpen(false); } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                  padding: '7px 12px', fontSize: 11, fontFamily: 'inherit', letterSpacing: '0.05em',
                  color: disabled ? T.textGhost : active ? T.amber : T.textHi,
                  background: active ? T.amberDim : 'transparent', border: 'none',
                  borderBottom: `1px solid ${T.border}`, cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.4 : 1, textTransform: 'uppercase', borderRadius: 0,
                }}>
                <span style={{
                  width: 11, height: 11, flexShrink: 0, borderRadius: 0,
                  border: `1px solid ${active ? T.amber : T.border}`, background: active ? T.amber : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {active && <span style={{ fontSize: 9, color: '#000', fontWeight: 800 }}>✓</span>}
                </span>
                {exp}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────── */
export default function Futures({ assetType = 'stock_futures' }) {
  const [tickerList, setTickerList]             = useState([]);
  const [selectedTicker, setSelectedTicker]     = useState('');
  const [allExpiries, setAllExpiries]           = useState([]);
  const [selectedExpiries, setSelectedExpiries] = useState([]);
  const [activeExpiry, setActiveExpiry]         = useState('');
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState('');
  const [mode, setMode]                         = useState('screener');
  const [marketDates, setMarketDates]           = useState([]);
  const [allDates, setAllDates]                 = useState([]);
  const [screenerSelectedExpiry, setScreenerSelectedExpiry] = useState('');
  const [activeScreenerExpiry, setActiveScreenerExpiry]     = useState('');
  const [chartSelectedExpiries, setChartSelectedExpiries]   = useState([]);
  const [screenerTab, setScreenerTab]           = useState('screener');

  const validChartExpiries = useMemo(() => {
    if (!allExpiries.length) return [];
    const today = new Date();
    const completed  = allExpiries.filter((e) => new Date(e) < today);
    const inProgress = allExpiries.find((e) => new Date(e) >= today);
    return inProgress ? [inProgress, ...completed] : completed;
  }, [allExpiries]);

  const relevantMarketDates = useMemo(() => {
    if (!chartSelectedExpiries.length || !allExpiries.length || !marketDates.length) return [];
    const indices = chartSelectedExpiries.map((c) => allExpiries.indexOf(c));
    const minIdx = Math.min(...indices);
    const earliestPrevExpiry = minIdx > 0 ? allExpiries[minIdx - 1] : null;
    const latestCycle = chartSelectedExpiries.reduce((a, b) => new Date(a) > new Date(b) ? a : b);
    return marketDates.filter((d) =>
      (!earliestPrevExpiry || d > earliestPrevExpiry) && d <= latestCycle
    );
  }, [marketDates, chartSelectedExpiries, allExpiries]);

  const chartTicker = useMemo(() => {
    return selectedTicker || tickerList[0] || '';
  }, [screenerTab, selectedTicker, tickerList]);

  const displayTickerList = useMemo(() =>
    (mode === 'screener' && screenerTab === 'charts')
      ? [...tickerList, FUTURES_COMBINED_TICKER]
      : tickerList,
  [tickerList, mode, screenerTab]);

  const screenerThreeExpiries = useMemo(() => {
    if (!screenerSelectedExpiry || !allExpiries.length) return [];
    const idx = allExpiries.indexOf(screenerSelectedExpiry);
    if (idx === -1) return [screenerSelectedExpiry];
    return allExpiries.slice(idx, idx + 3);
  }, [allExpiries, screenerSelectedExpiry]);

  useEffect(() => {
    if (!validChartExpiries.length) return;
    setChartSelectedExpiries(validChartExpiries.slice(0, 5));
  }, [validChartExpiries]);

  useEffect(() => {
    if (screenerThreeExpiries.length > 0 && !screenerThreeExpiries.includes(activeScreenerExpiry)) {
      setActiveScreenerExpiry(screenerThreeExpiries[0]);
    }
  }, [screenerThreeExpiries, activeScreenerExpiry]);

  useEffect(() => {
    setTickerList([]);
    setSelectedTicker('');
    setAllExpiries([]);
    setSelectedExpiries([]);
    setActiveExpiry('');
    setAllDates([]);
    setMarketDates([]);
    setScreenerSelectedExpiry('');
    setActiveScreenerExpiry('');
    setChartSelectedExpiries([]);
    setMode('screener');
    setScreenerTab('screener');
    setError('');
    setLoading(true);
  }, [assetType]);

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

  useEffect(() => {
    if (!tickerList.length) return;
    let mounted = true;
    getExpiries(assetType)
      .then((res) => {
        if (!mounted) return;
        const list = res?.expiries || [];
        setAllExpiries(list);
        if (list.length > 0) {
          setScreenerSelectedExpiry(list[0]);
          const defaults = list.slice(0, 3);
          setSelectedExpiries(defaults);
          if (defaults.length > 0) setActiveExpiry(defaults[0]);
        }
      })
      .catch((err) => console.error('Failed loading expiries', err));
    return () => { mounted = false; };
  }, [assetType, tickerList]);

  useEffect(() => {
    let mounted = true;
    getMarketDates(assetType)
      .then((res) => {
        if (!mounted) return;
        const dates = (res?.dates || []).sort();
        setMarketDates(dates);
      })
      .catch((err) => console.error('Failed loading market dates', err));
    return () => { mounted = false; };
  }, [assetType]);

  useEffect(() => {
    if (!tickerList.length || !screenerSelectedExpiry) return;
    let mounted = true;
    getDates(assetType, screenerSelectedExpiry)
      .then((res) => {
        if (!mounted) return;
        const sorted = [...(res?.dates || [])].sort((a, b) => new Date(a) - new Date(b));
        const sortedExpiryChain = [...allExpiries].sort((a, b) => new Date(a) - new Date(b));
        if (assetType === 'index_futures') {
          setAllDates(sorted);
        } else {
          const idx        = sortedExpiryChain.indexOf(screenerSelectedExpiry);
          const prevExpiry = idx > 0 ? sortedExpiryChain[idx - 1] : null;
          const cycleStart = prevExpiry ? sorted.find((d) => d > prevExpiry) : sorted[0];
          const cycleDates = cycleStart ? sorted.filter((d) => d >= cycleStart) : sorted;
          setAllDates(cycleDates);
        }
      })
      .catch((err) => console.error('Failed loading screener dates', err));
    return () => { mounted = false; };
  }, [assetType, tickerList, screenerSelectedExpiry, allExpiries]);

  useEffect(() => {
    if (selectedExpiries.length > 0 && !selectedExpiries.includes(activeExpiry)) {
      setActiveExpiry(selectedExpiries[0]);
    }
  }, [selectedExpiries, activeExpiry]);

  useEffect(() => {
    if (
      !(mode === 'screener' && screenerTab === 'charts') &&
      selectedTicker === FUTURES_COMBINED_TICKER
    ) {
      setSelectedTicker(tickerList[0] || '');
    }
  }, [mode, screenerTab, selectedTicker, tickerList]);

  if (loading && tickerList.length === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) console.error(error);

  const label = assetType === 'index_futures' ? 'Index Futures' : 'Stock Futures';

  return (
    <div style={{
      background: T.bg,
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace",
    }}>

      {/* ── CONTROL BAR ── */}
      <div style={{ background: T.surface, flexShrink: 0 }}>

        {/* ROW 1: Ticker + Mode */}
        <div style={rowStyle}>
          {/* Ticker */}
          <div style={cellStyle({ minWidth: 200 })}>
            <span style={sectionLabel()}>Ticker</span>
            <div style={{ position: 'relative' }}>
              <select
                value={selectedTicker}
                onChange={(e) => setSelectedTicker(e.target.value)}
                style={{
                  width: '100%', background: T.bg, border: `1px solid ${T.border}`,
                  color: T.textHi, fontSize: 12, fontFamily: 'inherit', padding: '4px 28px 4px 10px', minWidth: 200,
                  outline: 'none', letterSpacing: '0.06em', textTransform: 'uppercase',
                  height: 30, borderRadius: 0, cursor: 'pointer', appearance: 'none',
                  boxSizing: 'border-box',
                }}
              >
                {(mode === 'screener' && screenerTab === 'charts' ? displayTickerList : tickerList).map((t) => (
                  <option key={t} value={t} style={{ background: T.surface }}>{t}</option>
                ))}
              </select>
              <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: T.textLo, pointerEvents: 'none' }}>▾</span>
            </div>
          </div>

          {/* Mode (where Metric lives in Options) */}
          <div style={cellStyle({ flex: 1 })}>
            <span style={sectionLabel({ marginBottom: 1 })}>Mode</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <TerminalBtn active={mode === 'screener'} color={T.amber} onClick={() => setMode('screener')}>
                Market Screener
              </TerminalBtn>
              <TerminalBtn active={mode === 'expiry'} color={T.blue} onClick={() => setMode('expiry')}>
                Ticker Analytics
              </TerminalBtn>
            </div>
          </div>
        </div>

        {/* ROW 2: Expiry dropdown + chips + sub-tabs */}
        <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>

          {/* Expiry dropdown */}
          <div style={cellStyle({ minWidth: 200 })}>
            <ExpiryDropdown
              expiries={
                mode === 'screener'
                  ? screenerTab === 'charts' ? validChartExpiries : allExpiries.slice(0, 6)
                  : allExpiries
              }
              selectedExpiries={
                mode === 'screener'
                  ? screenerTab === 'charts' ? chartSelectedExpiries : [screenerSelectedExpiry]
                  : selectedExpiries
              }
              onToggle={(exp) => {
                if (mode === 'expiry') {
                  setSelectedExpiries((prev) =>
                    prev.includes(exp) ? prev.filter((e) => e !== exp) : [...prev, exp]
                  );
                } else if (screenerTab === 'charts') {
                  setChartSelectedExpiries((prev) => {
                    if (prev.includes(exp)) return prev.filter((e) => e !== exp);
                    const next = validChartExpiries.filter((e) => [...prev, exp].includes(e)).slice(0, 5);
                    return next;
                  });
                } else {
                  setScreenerSelectedExpiry(exp);
                }
              }}
              singleSelect={mode === 'screener' && screenerTab !== 'charts'}
              maxSelect={mode === 'screener' && screenerTab === 'charts' ? 5 : undefined}
              label="Expiry"
            />
          </div>

          {/* Chips for multi-select */}
          {(mode === 'expiry' && selectedExpiries.length > 1) ||
           (mode === 'screener' && screenerTab === 'charts' && chartSelectedExpiries.length > 1) ? (
            <div style={{ ...cellStyle({ flex: 1 }), flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {(mode === 'expiry' ? selectedExpiries : chartSelectedExpiries).map((exp) => (
                  <div key={exp} style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
                    border: `1px solid ${T.amber}`, background: T.amberDim,
                    fontSize: 10, color: T.amber, letterSpacing: '0.07em',
                    textTransform: 'uppercase', whiteSpace: 'nowrap', borderRadius: 0,
                  }}>
                    <span>{exp}</span>
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (mode === 'expiry') setSelectedExpiries((p) => p.filter((e) => e !== exp));
                        else setChartSelectedExpiries((p) => p.filter((e) => e !== exp));
                      }}
                      style={{ background: 'none', border: 'none', color: T.textLo, cursor: 'pointer', padding: 0, fontSize: 11 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Sub-tabs (screener) pushed right */}
          {mode === 'screener' && (
            <div style={{ ...cellStyle({ marginLeft: 'auto', borderRight: 'none' }), flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TerminalBtn active={screenerTab === 'screener'} color={T.amber} onClick={() => setScreenerTab('screener')}>Screener</TerminalBtn>
              <TerminalBtn active={screenerTab === 'charts'} color="#92D050" onClick={() => setScreenerTab('charts')}>Charts</TerminalBtn>
            </div>
          )}
        </div>

        {/* Expiry tab row — analytics mode only */}
        {mode === 'expiry' && selectedExpiries.length > 0 && (
          <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${T.border}`, overflowX: 'auto', background: T.surface }}>
            {selectedExpiries.map((expiry) => (
              <button
                key={expiry}
                onClick={() => setActiveExpiry(expiry)}
                style={{
                  padding: '8px 18px', fontSize: 10, letterSpacing: '0.09em',
                  fontWeight: activeExpiry === expiry ? 700 : 400,
                  color: activeExpiry === expiry ? T.blue : T.textMid,
                  background: activeExpiry === expiry ? `${T.blue}15` : 'transparent',
                  border: 'none', borderBottom: activeExpiry === expiry ? `2px solid ${T.blue}` : '2px solid transparent',
                  cursor: 'pointer', whiteSpace: 'nowrap', textTransform: 'uppercase',
                  transition: 'color 0.15s', marginBottom: -2, borderRadius: 0, fontFamily: 'inherit',
                }}
              >
                {expiry}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── PAGE HEADER ── */}
      <div style={{
        padding: '8px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: T.surface,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 16,
          fontWeight: 700,
          color: T.textHi,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {mode === 'screener' ? label : (selectedTicker || '—')}
        </span>
        <span style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          color: T.textLo,
          textTransform: 'uppercase',
          borderLeft: `1px solid ${T.border}`,
          paddingLeft: 16,
        }}>
          NSE · {label}
        </span>
        <span style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          color: T.textLo,
          textTransform: 'uppercase',
        }}>
          {mode === 'screener'
            ? 'Market-wide OI + Price signal'
            : 'Single ticker analytics'}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: T.green,
            boxShadow: `0 0 6px ${T.green}`,
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 9, letterSpacing: '0.12em', color: T.textLo, textTransform: 'uppercase' }}>NSE</span>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <main style={{ flex: 1, padding: '16px 20px', overflowX: 'hidden' }}>

        {/* SCREENER MODE */}
        {mode === 'screener' && (
          <RollupPanel
            assetType={assetType}
            allDates={allDates}
            marketDates={relevantMarketDates}
            screenerExpiries={screenerThreeExpiries}
            chartSelectedExpiries={chartSelectedExpiries}
            allScreenerExpiries={allExpiries}
            chartTicker={chartTicker}
            activeScreenerExpiry={activeScreenerExpiry}
            onScreenerExpiryChange={setActiveScreenerExpiry}
            activeTab={screenerTab}
          />
        )}

        {/* TICKER ANALYTICS MODE */}
        {mode === 'expiry' && (
          <>
            {selectedExpiries.length === 0 && (
              <div style={{
                ...panelStyle,
                padding: '32px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                borderLeft: `3px solid ${T.amberDim}`,
              }}>
                <span style={{ fontSize: 18, opacity: 0.4, color: T.textLo }}>◈</span>
                <span style={{ ...monoSm, color: T.textLo, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Select at least one expiry to continue
                </span>
              </div>
            )}
            {selectedExpiries.length > 0 && activeExpiry && (
              <AnalyticsPanel
                key={`${assetType}-${selectedTicker}-${activeExpiry}`}
                assetType={assetType}
                ticker={selectedTicker}
                expiry={activeExpiry}
                allExpiries={allExpiries}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
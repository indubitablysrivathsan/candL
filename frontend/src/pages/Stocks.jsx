// frontend/src/pages/Stocks.jsx
// Institutional terminal aesthetic — inline styles, matches Futures/Options/Market/etc.

import { useState, useEffect, useCallback, useMemo } from 'react';

import MetricCard        from '../components/shared/MetricCard';
import LoadingSpinner    from '../components/shared/LoadingSpinner';
import TermSelect        from '../components/shared/TermSelect';
import TabBar            from '../components/shared/TabBar';
import PageHeader        from '../components/shared/PageHeader';
import CandlestickChart  from '../components/charts/CandlestickChart';
import { T, mono } from '../theme';
import { fmtInt, pctColor } from '../utils/formatters';
import { stocks, formatCurrency } from '../api/client';

/* ─────────────────────────────────────────────────────────────────
   SHARED STYLE HELPERS
───────────────────────────────────────────────────────────────── */

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

const sectionLabel = (extra = {}) => ({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.textLo,
  ...extra,
});

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

const filterInputStyle = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.textHi,
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '5px 10px',
  outline: 'none',
  letterSpacing: '0.04em',
  height: 30,
  borderRadius: 0,
  boxSizing: 'border-box',
  width: 180,
};

const panelStyle = { background: T.surface, border: `1px solid ${T.border}` };

const thStyle = {
  ...mono,
  padding: '7px 10px',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.textMid,
  background: T.surfaceHi,
  borderBottom: `1px solid ${T.borderHi}`,
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  ...mono,
  padding: '6px 10px',
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

function PanelLoading() {
  return (
    <div style={{ ...panelStyle, minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <LoadingSpinner />
    </div>
  );
}

function PanelEmpty({ children }) {
  return (
    <div style={{
      ...panelStyle, padding: '40px 14px', textAlign: 'center',
      fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: T.textMid, ...mono,
    }}>
      {children}
    </div>
  );
}

const pctFmt = (v, dec = 2) =>
  v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });

/* ─────────────────────────────────────────────────────────────────
   METRIC STRIP
───────────────────────────────────────────────────────────────── */

function MetricStrip({ items }) {
  return (
    <div style={{ display: 'flex', width: '100%', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
      {items.map(({ title, value, subtitle, accent = T.amber }) => (
        <MetricCard key={title} title={title} value={value} subtitle={subtitle} accent={accent} />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   OHLCV + DELIVERY VIEW
   Candles, Volume, and Delivery % now render inside a single
   CandlestickChart instance as stacked, x-axis-synced panes — no
   separate chart-tab submenu needed since they're all one chart.
───────────────────────────────────────────────────────────────── */
const chartCache = new Map();

function OHLCView({ tickers, dates }) {
  const [ticker,    setTicker]    = useState(tickers[0] ?? '');
  const [startDate, setStartDate] = useState(dates.at(-60) ?? '');
  const [endDate,   setEndDate]   = useState(dates.at(-1)  ?? '');
  const [data,      setData]      = useState([]);
  const [rollData,  setRollData]  = useState([]);
  const [loading,   setLoading]   = useState(false);

  // ── Persistent overlay state — survives ticker/date changes ──────
  const [showCandles,  setShowCandles]  = useState(true);
  const [showAvg,      setShowAvg]      = useState(false);
  const [indicators,   setIndicators]   = useState([]); // [{id, type, params, color}]

  // Volume and Delivery % are always-on panes on this page — fixed, not
  // toggleable, since they're the three canonical views for a ticker here.

  const load = useCallback(async () => {
    if (!ticker || !startDate || !endDate) return;

    const key = `${ticker}_${startDate}_${endDate}`;

    if (chartCache.has(key)) {
        const cached = chartCache.get(key);
        setData(cached.data);
        setRollData(cached.roll);
        return;
    }

    setLoading(true);
    try {
      const [d, rolling] = await Promise.all([
          stocks.ohlc(ticker, startDate, endDate),
          stocks.rolling(ticker, startDate, endDate),
      ]);
      chartCache.set(key, {
          data: d,
          roll: rolling,
      });
      setData(d);
      setRollData(rolling);
    } catch (e) { console.error(e); }
    finally {
      setLoading(false);
    }
  }, [ticker, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const latest = rollData.at(-1);

  // `data` (from stocks.ohlc) only has OHLC/avg fields. Volume and
  // delivery_pct live in `rollData` (from stocks.rolling), keyed by the
  // same trade_date. Merge them so CandlestickChart's Volume/Delivery
  // panes actually have something to plot.
  const chartData = useMemo(() => {
    if (!data.length) return data;
    const rollMap = {};
    rollData.forEach((r) => { rollMap[r.trade_date] = r; });
    return data.map((row) => {
      const roll = rollMap[row.trade_date];
      return roll
        ? { ...row, volume: roll.volume, delivery_pct: roll.delivery_pct }
        : row;
    });
  }, [data, rollData]);

  const metrics = latest ? [
    { title: 'Last Traded Price',  value: formatCurrency(latest.close, 2),
      accent: T.amber },
    { title: 'Day Change %',       value: `${latest.daily_return > 0 ? '+' : ''}${pctFmt(latest.daily_return)}%`,
      accent: latest.daily_return >= 0 ? T.green : T.red },
    { title: 'Volume',             value: fmtInt(latest.volume),
      accent: T.blue },
    { title: 'Delivery %',         value: latest.delivery_pct != null ? `${pctFmt(latest.delivery_pct)}%` : '—',
      accent: latest.delivery_pct > 60 ? T.green : latest.delivery_pct > 40 ? T.amber : T.textLo },
    { title: 'Turnover (Cr)',      value: latest.turnover != null ? `₹${pctFmt(latest.turnover, 0)}` : '—',
      accent: T.textHi },
    { title: 'Relative Volume',    value: pctFmt(latest.rel_volume),
      accent: latest.rel_volume > 2 ? T.amber : T.textHi },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Control bar */}
      <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>
          {/* Ticker */}
          <div style={cellStyle({ minWidth: 220 })}>
            <span style={sectionLabel()}>Ticker</span>
            <TermSelect value={ticker || tickers[0]} onChange={setTicker} style={{ minWidth: 190 }}>
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </TermSelect>
          </div>
          {/* Date range */}
          <div style={cellStyle({})}>
            <span style={sectionLabel()}>Date Range</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={dateInputStyle} />
              <span style={{ color: T.textLo, fontSize: 10 }}>→</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={dateInputStyle} />
            </div>
          </div>
          {/* Load + status */}
          <div style={{ ...cellStyle({ borderRight: 'none', marginLeft: 'auto' }), flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <button
              onClick={load}
              disabled={!ticker || loading}
              style={{
                padding: '4px 18px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                border: `1px solid ${T.amber}`,
                background: T.amberDim,
                color: T.amber,
                cursor: (!ticker || loading) ? 'not-allowed' : 'pointer',
                opacity: (!ticker || loading) ? 0.4 : 1,
                transition: 'background 0.15s',
                borderRadius: 0,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? 'Loading…' : 'Load'}
            </button>
            {data.length > 0 && (
              <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.10em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {data.length} sessions
              </span>
            )}
          </div>
      </div>

      {/* Metric strip */}
      {metrics.length > 0 && (
        <div style={{ marginTop: 1 }}>
          <MetricStrip items={metrics} />
        </div>
      )}

      {/* Chart panel */}
      {loading && <PanelLoading />}

      {!loading && data.length > 0 && (
        <div style={{ border: `1px solid ${T.border}`, borderTop: 'none' }}>
          {/* Black header bar: ticker context left */}
          <div style={{
            background: T.bg,
            borderBottom: `1px solid ${T.borderHi}`,
            display: 'flex',
            alignItems: 'stretch',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: T.textHi }}>{ticker}</span>
              <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.12em', textTransform: 'uppercase' }}>NSE · EQ</span>
            </div>
          </div>

          {/* Chart body — Candles, Volume, Delivery % all in one synced chart */}
          <div style={{ background: T.surface, padding: '14px 14px 10px' }}>
            <CandlestickChart
              data={chartData}
              formatCurrency={formatCurrency}
              showCandles={showCandles}
              onShowCandlesChange={setShowCandles}
              showAvg={showAvg}
              onShowAvgChange={setShowAvg}
              showVolume
              showDelivery
              indicators={indicators}
              onIndicatorsChange={setIndicators}
            />
          </div>
        </div>
      )}

      {!loading && data.length === 0 && ticker && (
        <PanelEmpty>No data for selected range</PanelEmpty>
      )}
      {!ticker && (
        <PanelEmpty>Select ticker to load chart data</PanelEmpty>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   SCREENER VIEW
───────────────────────────────────────────────────────────────── */

function ScreenerView({ dates }) {
  const [tradeDate, setTradeDate] = useState(dates.at(-1) ?? '');
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [sortKey,   setSortKey]   = useState('pct_change');
  const [sortDir,   setSortDir]   = useState(-1);
  const [filter,    setFilter]    = useState('');

  const load = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try {
      const d = await stocks.snapshot(tradeDate, 500);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(-1); }
  };

  const displayed = useMemo(() =>
    [...data]
      .filter((r) => !filter || r.ticker.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => {
        const av = a[sortKey] ?? -Infinity;
        const bv = b[sortKey] ?? -Infinity;
        return (av - bv) * sortDir;
      })
      .slice(0, 150),
  [data, filter, sortKey, sortDir]);

  const cols = [
    { key: 'ticker',       label: 'Ticker',     align: 'left',
      render: (v) => <span style={{ color: T.amber, fontWeight: 600 }}>{v}</span> },
    { key: 'close',        label: 'LTP',        align: 'right',
      render: (v) => <span style={{ color: T.textHi }}>{formatCurrency(v, 2)}</span> },
    { key: 'pct_change',   label: 'Chg %',      align: 'right',
      render: (v) => <span style={{ color: pctColor(v) }}>{v > 0 ? '+' : ''}{pctFmt(v)}%</span> },
    { key: 'volume',       label: 'Volume',     align: 'right',
      render: (v) => fmtInt(v) },
    { key: 'turnover',     label: 'TO (Cr)',    align: 'right',
      render: (v) => pctFmt(v, 1) },
    { key: 'delivery_pct', label: 'Del %',      align: 'right',
      render: (v) => v != null
        ? <span style={{ color: v > 60 ? T.green : v > 40 ? T.amber : T.textHi }}>{pctFmt(v)}%</span>
        : '—' },
    { key: 'trade_count',  label: 'Trades',     align: 'right',
      render: (v) => fmtInt(v) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>
          {/* Date */}
          <div style={cellStyle({ minWidth: 200 })}>
            <span style={sectionLabel()}>Date</span>
            <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} style={dateInputStyle} />
          </div>
          {/* Filter */}
          <div style={cellStyle({})}>
            <span style={sectionLabel()}>Filter Ticker</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search…"
              style={filterInputStyle}
            />
          </div>
          {/* Row count */}
          <div style={{ ...cellStyle({ borderRight: 'none', marginLeft: 'auto' }), flexDirection: 'row', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {displayed.length} instruments
            </span>
          </div>
      </div>

      {loading ? <PanelLoading /> : (
        <div style={{ ...panelStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, letterSpacing: '0.02em' }}>
            <thead>
              <tr>
                {cols.map(({ key, label, align }) => (
                  <th key={key} onClick={() => handleSort(key)} style={{ ...thStyle, textAlign: align }}>
                    {label}{sortKey === key ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((row, i) => (
                <tr key={row.ticker + i} style={{ background: row.delivery_pct > 70 ? 'rgba(240,165,0,0.05)' : 'transparent' }}>
                  {cols.map(({ key, align, render }) => (
                    <td key={key} style={{ ...tdStyle, textAlign: align }}>
                      {render(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DELIVERY LEADERS VIEW
───────────────────────────────────────────────────────────────── */

function DeliveryView({ dates }) {
  const [tradeDate, setTradeDate] = useState(dates.at(-1) ?? '');
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(false);

  const load = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try {
      const d = await stocks.deliveryLeaders(tradeDate, 50);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ ...rowStyle, borderBottom: `2px solid ${T.border}` }}>
          {/* Date */}
          <div style={cellStyle({ minWidth: 200 })}>
            <span style={sectionLabel()}>Date</span>
            <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} style={dateInputStyle} />
          </div>
          {/* Context label */}
          <div style={{ ...cellStyle({ borderRight: 'none', flex: 1 }), flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 9, color: T.textMid, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
              Top 50 by delivery % · Institutional conviction signal
            </span>
          </div>
      </div>

      {loading ? <PanelLoading /> : (
        <div style={{ ...panelStyle, overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '32px 120px 1fr 80px 110px 80px',
            padding: '6px 14px',
            background: T.surfaceHi,
            borderBottom: `1px solid ${T.borderHi}`,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: T.textHi,
          }}>
            <span>#</span>
            <span>Ticker</span>
            <span>Name</span>
            <span style={{ textAlign: 'right' }}>Chg %</span>
            <span style={{ textAlign: 'right' }}>LTP</span>
            <span style={{ textAlign: 'right' }}>Del %</span>
          </div>

          {data.map((row, i) => {
            const barPct = Math.min(Math.max(row.delivery_pct ?? 0, 2), 100);
            const barColor = row.delivery_pct > 70 ? T.green : row.delivery_pct > 50 ? T.amber : T.blue;
            return (
              <div key={row.ticker} style={{
                position: 'relative', overflow: 'hidden', background: T.surface,
                borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center',
              }}>
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, left: 0,
                  width: `${barPct}%`, backgroundColor: barColor, opacity: 0.07, pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'relative', display: 'grid', width: '100%', padding: '7px 14px',
                  gridTemplateColumns: '32px 120px 1fr 80px 110px 80px',
                }}>
                  <span style={{ fontSize: 9, color: T.textMid, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                  <span style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>{row.ticker}</span>
                  <span style={{ fontSize: 9, color: T.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.instrument_name}
                  </span>
                  <span style={{ fontSize: 11, color: pctColor(row.pct_change), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.pct_change > 0 ? '+' : ''}{pctFmt(row.pct_change)}%
                  </span>
                  <span style={{ fontSize: 11, color: T.textHi, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(row.close, 2)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: barColor, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {pctFmt(row.delivery_pct)}%
                  </span>
                </div>
              </div>
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

const VIEWS = [
  { key: 'ohlc',     label: 'OHLCV + Delivery' },
  { key: 'screener', label: 'Screener' },
  { key: 'delivery', label: 'Delivery Leaders' },
];

export default function Stocks() {
  const [tickers, setTickers] = useState([]);
  const [dates,   setDates]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState('ohlc');

  useEffect(() => {
    (async () => {
      try {
        const [t, d] = await Promise.all([stocks.tickers(), stocks.dates()]);
        setTickers(t);
        setDates(d);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', ...mono }}>
      <LoadingSpinner size="lg" />
    </div>
  );

  return (
    <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', ...mono }}>
      {/* ── PAGE HEADER ── */}
      <PageHeader
        title="EQ Stocks"
        extra={['NSE · Cash Market', `${tickers.length} tickers · ${dates.length} sessions`, dates.at(-1) ?? '—']}
      />

      {/* ── VIEW TAB ROW ── */}
      <TabBar tabs={VIEWS} active={view} onChange={setView} />

      {/* ── CONTENT ── */}
      <main style={{ flex: 1, padding: '16px 20px', overflowX: 'hidden' }}>
        {view === 'ohlc'     && <OHLCView     tickers={tickers} dates={dates} />}
        {view === 'screener' && <ScreenerView dates={dates} />}
        {view === 'delivery' && <DeliveryView dates={dates} />}
      </main>
    </div>
  );
}

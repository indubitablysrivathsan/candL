// frontend/src/pages/Market.jsx
// ── Institutional Terminal Aesthetic ──────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
  LineChart, Line,
} from 'recharts';

import MetricCard        from '../components/shared/MetricCard';
import LoadingSpinner    from '../components/shared/LoadingSpinner';
import CandlestickChart  from '../components/charts/CandlestickChart';
import DailyChangeChart  from '../components/charts/DailyChangeChart';
import Divider           from '../components/shared/Divider';
import TerminalBtn       from '../components/shared/TerminalBtn';
import Panel, { PanelHeader } from '../components/shared/Panel';
import DateRangeRow, { RangePresets } from '../components/shared/DateRangeRow';
import TermSelect        from '../components/shared/TermSelect';
import ChartTooltip      from '../components/shared/ChartTooltip';
import { DataTable }     from '../components/shared/DataTable';
import SubTabStrip       from '../components/shared/SubTabStrip';
import PageHeader        from '../components/shared/PageHeader';
import TabBar            from '../components/shared/TabBar';
import { T, mono, labelStyle, chartAxisProps, gridProps } from '../theme';
import { fmt, fmtInt, fmtK, pctColor, pctSign } from '../utils/formatters';
import { defaultRange } from '../utils/dateRange';
import { participant, fii, volatility, market } from '../api/client';

// ── FIXED: uses MetricCard as specified ──────────────────────────
function MetricStrip({ items }) {
  return (
    <div style={{
      display: 'flex',
      width: '100%',
      border: `1px solid ${T.border}`,
      borderTop: 'none',
      overflow: 'hidden',
    }}>
      {items.map(({ title, value, subtitle, accent = T.amber }) => (
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

function SectionLabel({ children, style = {} }) {
  return (
    <div style={{ ...labelStyle({ color: T.amber }), marginBottom: 8, paddingTop: 2, ...style }}>
      {children}
    </div>
  );
}

function TerminalLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
      <span style={{ ...mono, fontSize: 10, color: T.textLo, letterSpacing: '0.14em' }}>LOADING DATA…</span>
    </div>
  );
}

function Empty({ msg = 'No data for selected range.' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
      <span style={{ ...mono, fontSize: 10, color: T.textLo, letterSpacing: '0.10em' }}>{msg.toUpperCase()}</span>
    </div>
  );
}

/* ─── TABLE ──────────────────────────────────────────────────── */
const thStyle = {
  ...mono,
  padding: '6px 10px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.textLo,
  borderBottom: `1px solid ${T.borderHi}`,
  whiteSpace: 'nowrap',
  background: T.surfaceHi,
};

/* ═══════════════════════════════════════════════════════════════
   INDICES
═══════════════════════════════════════════════════════════════ */
function IndexSnapshot({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);

  // ── FIX: initialise to latest date as soon as marketDates arrives ──
  useEffect(() => {
    if (marketDates.length && !tradeDate) {
      setTradeDate(marketDates.at(-1));
    }
  }, [marketDates]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.indexSnapshot(tradeDate).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const advances = data.filter(d => d.pct_change > 0).length;
  const declines = data.filter(d => d.pct_change < 0).length;

  // ── date input style (matching IndexHistory) ───────────────────
  const inputStyle = {
    ...mono, fontSize: 10, padding: '4px 8px',
    background: T.surfaceHi, border: `1px solid ${T.border}`,
    color: T.textMid, outline: 'none', borderRadius: 0, letterSpacing: '0.04em',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.length > 0 && (
        <MetricStrip items={[
          { title: 'Session Date', value: tradeDate, accent: T.textMid },
          { title: 'Indices',      value: data.length, accent: T.textHi },
          { title: 'Advancing',    value: advances, accent: T.green },
          { title: 'Declining',    value: declines, accent: T.red },
        ]} />
      )}

      {/* ── CHANGED: dropdown → date input ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span style={labelStyle()}>Session</span>
        <input type="date" value={tradeDate}  min={marketDates[0] ?? ''}  max={marketDates.at(-1) ?? ''}   onChange={e => setTradeDate(e.target.value)}   style={inputStyle} />
      </div>

      {loading ? <TerminalLoading /> : (
        <div style={{ overflowX: 'auto', border: `1px solid ${T.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Index','Close','Prev Close','Change','Change %'].map((h, i) => (
                  <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((idx, i) => {
                const col = pctColor(idx.pct_change);
                return (
                  <tr key={idx.index_name} style={{ background: i % 2 === 0 ? T.surface : 'transparent' }}>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: T.textHi, borderBottom: `1px solid ${T.border}`, textAlign: 'left' }}>
                      {idx.index_name}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 600, color: col, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {fmt(idx.close, 2)}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, color: T.textMid, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {fmt(idx.prev_close ?? (idx.close - idx.gain_loss), 2)}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 600, color: col, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {pctSign(idx.gain_loss)}{fmt(idx.gain_loss, 1)}
                    </td>
                    <td style={{ ...mono, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: col, borderBottom: `1px solid ${T.border}`, textAlign: 'right' }}>
                      {pctSign(idx.pct_change)}{fmt(idx.pct_change)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IndexHistory({ marketDates }) {
  const [indexNames, setIndexNames] = useState([]);
  const [selected, setSelected]     = useState('');
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [showCandles,  setShowCandles]  = useState(true);
  const [showAvg,      setShowAvg]      = useState(false);
  const [indicators,   setIndicators]   = useState([]); // [{id, type, params, color}]

  // Load index names once
  useEffect(() => {
    market.indexNames()
      .then(n => { setIndexNames(n); if (n.length) setSelected(n[0]); })
      .catch(console.error);
  }, []);

  // Set dates once marketDates arrives
  useEffect(() => {
    if (!marketDates.length) return;
    const r = defaultRange(marketDates, 6);
    setStartDate(r.start);
    setEndDate(r.end);
  }, [marketDates]);

  // Only fire when ALL THREE are ready — no more race
  useEffect(() => {
      if (!selected || !startDate || !endDate) return;
      let cancelled = false;
      setLoading(true);
      market.indexHistory(selected, startDate, endDate)
        .then(d  => { if (!cancelled) setData(d); })
        .catch(() => { if (!cancelled) setData([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [selected, startDate, endDate]);

  const last  = data.at(-1);
  const first = data[0];

  // formatCurrency passed to CandlestickChart
  const formatCurrency = (v, dec = 2) => fmt(v, dec);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {last && (
        <MetricStrip items={[
          { title: 'Index',   value: selected,           accent: T.textMid },
          { title: 'Latest',  value: fmt(last.close, 0), accent: T.textHi },
          { title: 'Period Δ',
            value: first
              ? `${pctSign(((last.close - first.close) / first.close) * 100)}${(((last.close - first.close) / first.close) * 100).toFixed(1)}%`
              : '—',
            accent: last.close >= (first?.close ?? last.close) ? T.green : T.red,
          },
          { title: 'Sessions', value: data.length, accent: T.textMid },
        ]} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={labelStyle()}>Index</span>
          <TermSelect value={selected} onChange={setSelected}>
            {indexNames.map(n => <option key={n} value={n}>{n}</option>)}
          </TermSelect>
        </div>
        <Divider vertical style={{ height: 20 }} />
        <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
      </div>

      {loading ? <TerminalLoading /> : data.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* ── CHANGED: CandlestickChart for OHLC ── */}
          <CandlestickChart
            data={data}
            showCandles={true}
            showAvg={false}
            formatCurrency={formatCurrency}
            onShowCandlesChange={setShowCandles}
            onShowAvgChange={setShowAvg}
            indicators={indicators}
            onIndicatorsChange={setIndicators}
          />

          {/* ── CHANGED: DailyChangeChart asset for pct change ── */}
          <DailyChangeChart
            data={data}
            height={160}
            title={`Daily Change % — ${selected}`}
          />
        </div>
      ) : <Empty />}
    </div>
  );
}

function IndicesSection({ marketDates }) {
  const [sub, setSub] = useState('snapshot');
  return (
    <Panel title="Indices" subtitle="NSE index OHLC · all index types">
      <SubTabStrip
        tabs={[{ key: 'snapshot', label: 'Snapshot' }, { key: 'history', label: 'History' }]}
        active={sub} onChange={setSub}
      />
      {sub === 'snapshot' && <IndexSnapshot marketDates={marketDates} />}
      {sub === 'history'  && <IndexHistory  marketDates={marketDates} />}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BREADTH
═══════════════════════════════════════════════════════════════ */
function BreadthSection({ marketDates }) {
  const [sub, setSub]         = useState('history');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd]     = useState('');
  const [data, setData]       = useState([]);
  const [snap, setSnap]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const r = defaultRange(marketDates, 3); setStart(r.start); setEnd(r.end);
  }, [marketDates]);

  const loadHistory = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try { setData(await market.breadth(startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate]);

  const loadSnap = useCallback(async () => {
    if (!marketDates.length) return;
    setLoading(true);
    try { setSnap(await market.breadthSnapshot(marketDates.at(-1))); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [marketDates]);

  useEffect(() => { if (sub === 'history')  loadHistory(); }, [sub, loadHistory]);
  useEffect(() => { if (sub === 'snapshot') loadSnap();    }, [sub, loadSnap]);

  return (
    <Panel title="Market Breadth" subtitle="Advances · declines · unchanged · price-band hits">
      <SubTabStrip
        tabs={[{ key: 'history', label: 'History' }, { key: 'snapshot', label: 'Snapshot' }]}
        active={sub} onChange={setSub}
      />

      {sub === 'snapshot' && (
        loading ? <TerminalLoading /> : snap ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <MetricStrip items={[
              { title: 'Advances',        value: fmtInt(snap.advances),        accent: T.green },
              { title: 'Declines',        value: fmtInt(snap.declines),        accent: T.red },
              { title: 'Unchanged',       value: fmtInt(snap.unchanged),       accent: T.textMid },
              { title: 'Price Band Hits', value: fmtInt(snap.price_band_hits), accent: T.amber },
              {
                title: 'A/D Ratio',
                value: snap.advances != null && snap.declines != null
                  ? ((snap.advances / (snap.advances + snap.declines)) || 0).toFixed(3) : '—',
                accent: snap.advances > snap.declines ? T.green : T.red,
              },
            ]} />
          </div>
        ) : <Empty msg="No breadth data." />
      )}

      {sub === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '4px 0' }}>
            <DateRangeRow allDates={marketDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
          </div>
          {loading ? <TerminalLoading /> : data.length > 0 ? (
            <>
              <SectionLabel>Advances vs Declines</SectionLabel>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis {...chartAxisProps} width={46} />
                  <Tooltip content={<ChartTooltip valueFormatter={v => fmtInt(v)} />} />
                  <Legend formatter={v => <span style={{ ...mono, fontSize: 9, color: T.textMid }}>{v}</span>} />
                  <Bar dataKey="advances" name="Advances" stackId="a" fill={T.green} opacity={0.8} radius={0} />
                  <Bar dataKey="declines" name="Declines" stackId="a" fill={T.red}   opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>

              <SectionLabel style={{ marginTop: 6 }}>AD Ratio</SectionLabel>
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis {...chartAxisProps} tickFormatter={v => fmt(v, 2)} width={40} domain={[0, 1]} />
                  <ReferenceLine y={0.5} stroke={T.borderHi} strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip valueFormatter={v => fmt(v, 3)} />} />
                  <Line dataKey="ad_ratio" name="AD Ratio" stroke={T.blue} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : <Empty />}
        </div>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TOP STOCKS
═══════════════════════════════════════════════════════════════ */
function TopByValue({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => { if (marketDates.length) setTradeDate(marketDates.at(-1)); }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.topStocks(tradeDate, { series: 'EQ', limit: 25 })
      .then(setData).catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const columns = [
    { key: '_rank',      label: '#',          align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r._rank}</span> },
    { key: 'ticker',     label: 'Symbol',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: T.textHi }}>{r.ticker}</span> },
    { key: 'series',     label: 'Series',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r.series}</span> },
    { key: 'close',      label: 'Close',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: T.textHi }}>{fmt(r.close, 2)}</span> },
    { key: 'prev_close', label: 'Prev',       align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>{fmt(r.prev_close, 2)}</span> },
    { key: 'pct_change', label: 'Chg %',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: pctColor(r.pct_change) }}>
        {pctSign(r.pct_change)}{fmt(r.pct_change)}%
      </span> },
    { key: 'turnover',   label: 'Value (Cr)', align: 'right',
      render: r => (<span style={{ ...mono, fontSize: 11, color: T.amber }}>{fmt(r.turnover / 100, 1)}</span>) },
    { key: 'volume',     label: 'Volume',     align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>{fmtInt(r.volume)}</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={labelStyle()}>Session</span>
        <TermSelect value={tradeDate} onChange={setTradeDate}>
          {[...marketDates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
        </TermSelect>
      </div>
      {loading ? <TerminalLoading /> : data.length > 0
        ? <DataTable columns={columns} rows={data.map((r, i) => ({ ...r, _rank: i + 1 }))} rowKey="ticker" maxHeight={520} />
        : <Empty />}
    </div>
  );
}

function GainersLosers({ marketDates }) {
  const [tradeDate, setTradeDate] = useState('');
  const [gainers, setGainers]     = useState([]);
  const [losers, setLosers]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [side, setSide]           = useState('gainers');

  useEffect(() => { if (marketDates.length) setTradeDate(marketDates.at(-1)); }, [marketDates]);

  useEffect(() => {
    if (!tradeDate) return;
    setLoading(true);
    market.topGainersLosers(tradeDate, { series: 'EQ', limit: 15, minTurnover: 100 })
      .then(res => { setGainers(res.gainers || []); setLosers(res.losers || []); })
      .catch(console.error).finally(() => setLoading(false));
  }, [tradeDate]);

  const columns = [
    { key: '_rank',      label: '#',          align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r._rank}</span> },
    { key: 'ticker',     label: 'Symbol',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: T.textHi }}>{r.ticker}</span> },
    { key: 'prev_close', label: 'Prev',       align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>{fmt(r.prev_close, 2)}</span> },
    { key: 'close',      label: 'Close',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: T.textHi }}>{fmt(r.close, 2)}</span> },
    { key: 'pct_change', label: 'Chg %',      align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: pctColor(r.pct_change) }}>
        {pctSign(r.pct_change)}{fmt(r.pct_change)}%
      </span> },
    { key: 'turnover',   label: 'Value (Cr)', align: 'right',
      render: r => (<span style={{ ...mono, fontSize: 11, color: T.amber }}>{fmt(r.turnover / 100, 1)}</span>) },
  ];

  const rows = (side === 'gainers' ? gainers : losers).map((r, i) => ({ ...r, _rank: i + 1 }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={labelStyle()}>Session</span>
          <TermSelect value={tradeDate} onChange={setTradeDate}>
            {[...marketDates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
          </TermSelect>
        </div>
        <div style={{ display: 'flex', border: `1px solid ${T.border}` }}>
          <TerminalBtn active={side === 'gainers'} color={T.green}
            onClick={() => setSide('gainers')}
            style={{ borderWidth: 0, borderRight: `1px solid ${T.border}` }}>
            ▲ Gainers
          </TerminalBtn>
          <TerminalBtn active={side === 'losers'} color={T.red}
            onClick={() => setSide('losers')}
            style={{ borderWidth: 0 }}>
            ▼ Losers
          </TerminalBtn>
        </div>
      </div>
      {loading ? <TerminalLoading /> : rows.length > 0
        ? <DataTable columns={columns} rows={rows} rowKey="ticker" maxHeight={520} />
        : <Empty msg={`No ${side} data.`} />}
    </div>
  );
}

function TopStocksSection({ marketDates }) {
  const [sub, setSub] = useState('value');
  return (
    <Panel title="Top Stocks" subtitle="Daily ranked lists from NSE market activity">
      <SubTabStrip
        tabs={[{ key: 'value', label: 'Top 25 by Value' }, { key: 'movers', label: 'Gainers / Losers' }]}
        active={sub} onChange={setSub}
      />
      {sub === 'value'  && <TopByValue    marketDates={marketDates} />}
      {sub === 'movers' && <GainersLosers marketDates={marketDates} />}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FII STATS
═══════════════════════════════════════════════════════════════ */
function FIIStats({ allDates }) {
  const [instList, setInstList]     = useState([]);
  const [instFilter, setInstFilter] = useState('INDEX FUTURES');
  const [startDate, setStart]       = useState('');
  const [endDate, setEnd]           = useState('');
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    fii.instruments().then(setInstList).catch(console.error);
    const r = defaultRange(allDates, 3); setStart(r.start); setEnd(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate || !instFilter) return;
    setLoading(true);
    try { setData(await fii.stats(startDate, endDate, [instFilter])); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, instFilter]);

  useEffect(() => { load(); }, [load]);

  const last = data.at(-1);
  const cumNet = data.reduce((acc, r) => acc + (r.net_contracts ?? 0), 0);

  return (
    <Panel title="FII Derivatives Statistics" subtitle="Buy · sell · net contracts · OI from NSE FII stats file">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {last && (
          <MetricStrip items={[
            { title: 'Instrument',   value: instFilter, accent: T.textMid },
            { title: 'Latest Net',   value: last.net_contracts != null ? (last.net_contracts >= 0 ? '+' : '') + fmtInt(last.net_contracts) : '—',
              accent: last.net_contracts >= 0 ? T.green : T.red },
            { title: 'Latest OI',    value: last.oi_contracts != null ? fmtK(last.oi_contracts) : '—', accent: T.blue },
            { title: 'Period Cum Net', value: (cumNet >= 0 ? '+' : '') + fmtInt(cumNet), accent: cumNet >= 0 ? T.green : T.red },
          ]} />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0' }}>
          <span style={labelStyle()}>Instrument</span>
          <TermSelect value={instFilter} onChange={setInstFilter}>
            {instList.map(i => <option key={i} value={i}>{i}</option>)}
          </TermSelect>
          <Divider vertical style={{ height: 20 }} />
          <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
        </div>

        {loading ? <TerminalLoading /> : data.length > 0 ? (
          <>
            <SectionLabel>Net Contracts (Buy − Sell)</SectionLabel>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis {...chartAxisProps} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} width={46} />
                <ReferenceLine y={0} stroke={T.borderHi} strokeDasharray="3 3" />
                <Tooltip content={<ChartTooltip valueFormatter={v => fmtInt(v)} />} />
                <Bar dataKey="net_contracts" name="Net Contracts" radius={0}>
                  {data.map((row, i) => <Cell key={i} fill={(row.net_contracts ?? 0) >= 0 ? T.green : T.red} opacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <SectionLabel style={{ marginTop: 6 }}>Open Interest (Contracts)</SectionLabel>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis {...chartAxisProps} tickFormatter={v => `${(v / 1e5).toFixed(1)}L`} width={46} />
                <Tooltip content={<ChartTooltip valueFormatter={v => fmtInt(v)} />} />
                <Line dataKey="oi_contracts" name="OI" stroke={T.blue} dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : <Empty />}
      </div>
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VOLATILITY
═══════════════════════════════════════════════════════════════ */
function VolatilitySection() {
  const [tickers, setTickers]   = useState([]);
  const [volDates, setVolDates] = useState([]);
  const [tradeDate, setDate]    = useState('');
  const [ticker, setTicker]     = useState('');
  const [snapData, setSnapData] = useState([]);
  const [seriesData, setSeries] = useState([]);
  const [sub, setSub]           = useState('snapshot');
  const [loading, setLoading]   = useState(false);
  const [startDate, setStart]   = useState('');
  const [endDate, setEnd]       = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [t, d] = await Promise.all([volatility.tickers(), volatility.dates()]);
        setTickers(t); setVolDates(d); setDate(d.at(-1) ?? '');
        const r = defaultRange(d, 6); setStart(r.start); setEnd(r.end);
      } catch (e) { console.error(e); }
    })();
  }, []);

  const loadSnap = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try { setSnapData(await volatility.snapshot(tradeDate, 60)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate]);

  const loadSeries = useCallback(async () => {
    if (!ticker || !startDate || !endDate) return;
    setLoading(true);
    try { setSeries(await volatility.series(ticker, startDate, endDate)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [ticker, startDate, endDate]);

  useEffect(() => { if (sub === 'snapshot') loadSnap();  }, [sub, loadSnap]);
  useEffect(() => { if (sub === 'series')   loadSeries(); }, [sub, loadSeries]);

  const volColor = (v) =>
    v == null   ? T.textLo
    : v > 0.6   ? T.red
    : v > 0.35  ? T.amber
    : T.green;

  const snapCols = [
    { key: '_i',     label: '#',          align: 'left',
      render: r => <span style={{ ...mono, fontSize: 9, color: T.textLo }}>{r._i}</span> },
    { key: 'ticker', label: 'Ticker',     align: 'left',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: T.textHi }}>{r.ticker}</span> },
    { key: 'applicable_annual_vol', label: 'Ann. Vol', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: volColor(r.applicable_annual_vol) }}>
        {r.applicable_annual_vol != null ? `${(r.applicable_annual_vol * 100).toFixed(1)}%` : '—'}
      </span> },
    { key: 'underlying_annual_vol', label: 'Underlying', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>
        {r.underlying_annual_vol != null ? `${(r.underlying_annual_vol * 100).toFixed(1)}%` : '—'}
      </span> },
    { key: 'futures_annual_vol', label: 'Futures', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textMid }}>
        {r.futures_annual_vol != null ? `${(r.futures_annual_vol * 100).toFixed(1)}%` : '—'}
      </span> },
    { key: 'applicable_daily_vol', label: 'Daily Vol', align: 'right',
      render: r => <span style={{ ...mono, fontSize: 11, color: T.textLo }}>
        {r.applicable_daily_vol != null ? `${(r.applicable_daily_vol * 100).toFixed(2)}%` : '—'}
      </span> },
  ];

  return (
    <Panel title="FO Volatility (EWMA)" subtitle="Underlying and futures EWMA daily + annualised volatility from NSE FOVOLT files">
      <SubTabStrip
        tabs={[{ key: 'snapshot', label: 'Cross-Section' }, { key: 'series', label: 'Time Series' }]}
        active={sub} onChange={setSub}
      />

      {sub === 'snapshot' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={labelStyle()}>Date</span>
            <TermSelect value={tradeDate} onChange={setDate}>
              {[...volDates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
            </TermSelect>
          </div>
          {loading ? <TerminalLoading /> : (
            <DataTable columns={snapCols} rows={snapData.map((r, i) => ({ ...r, _i: i + 1 }))} rowKey="ticker" maxHeight={500} />
          )}
        </div>
      )}

      {sub === 'series' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0' }}>
            <span style={labelStyle()}>Ticker</span>
            <TermSelect value={ticker} onChange={setTicker}>
              <option value="">— Select —</option>
              {tickers.map(t => <option key={t} value={t}>{t}</option>)}
            </TermSelect>
            <Divider vertical style={{ height: 20 }} />
            <DateRangeRow allDates={volDates} startDate={startDate} endDate={endDate} onStart={setStart} onEnd={setEnd} />
          </div>

          {loading ? <TerminalLoading /> : seriesData.length > 0 ? (
            <>
              {ticker && (
                <MetricStrip items={[
                  { title: 'Ticker', value: ticker, accent: T.textMid },
                  { title: 'Latest Ann. Vol',
                    value: seriesData.at(-1)?.applicable_annual_vol != null
                      ? `${(seriesData.at(-1).applicable_annual_vol * 100).toFixed(1)}%` : '—',
                    accent: volColor(seriesData.at(-1)?.applicable_annual_vol) },
                  { title: 'Sessions', value: seriesData.length, accent: T.textMid },
                ]} />
              )}
              <SectionLabel>Annualised Volatility — {ticker}</SectionLabel>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={seriesData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="trade_date" {...chartAxisProps} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis {...chartAxisProps} tickFormatter={v => `${(v * 100).toFixed(0)}%`} width={40} />
                  <Tooltip content={<ChartTooltip valueFormatter={v => `${(v * 100).toFixed(1)}%`} />} />
                  <Legend formatter={v => <span style={{ ...mono, fontSize: 9, color: T.textMid }}>{v}</span>} />
                  <Line dataKey="applicable_annual_vol" name="Applicable" stroke={T.blue}  dot={false} strokeWidth={2} />
                  <Line dataKey="underlying_annual_vol" name="Underlying" stroke={T.green} dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
                  <Line dataKey="futures_annual_vol"    name="Futures"    stroke={T.amber} dot={false} strokeWidth={1.2} strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : <Empty msg="Select a ticker and date range." />}
        </div>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
const TOP_TABS = [
  { key: 'indices',    label: 'Indices'    },
  { key: 'breadth',   label: 'Breadth'    },
  { key: 'top_stocks', label: 'Top Stocks' },
  { key: 'fii_stats',  label: 'FII Stats'  },
  { key: 'volatility', label: 'Volatility' },
];

export default function Market() {
  const [allDates, setAllDates]    = useState([]);
  const [marketDates, setMktDates] = useState([]);
  const [loading, setLoading]      = useState(true);
  const [activeSection, setActive] = useState('indices');

  useEffect(() => {
    (async () => {
      try {
        const [pd, md] = await Promise.all([participant.dates(), market.dates()]);
        setAllDates(pd); setMktDates(md);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
      <LoadingSpinner size="lg" />
    </div>
  );

  return (
    <div style={{ background: T.bg, minHeight: '100vh', ...mono }}>
      {/* ── Page Header ── */}
      <PageHeader
        title="Market & Institutional Flow"
        subtitle="Indices · Breadth · Stocks · FII · Volatility"
      />
      <TabBar tabs={TOP_TABS} active={activeSection} onChange={setActive} />

      {/* ── Content ── */}
      <div style={{ padding: '16px 20px' }}>
        {activeSection === 'indices'     && <IndicesSection    marketDates={marketDates} />}
        {activeSection === 'breadth'     && <BreadthSection    marketDates={marketDates} />}
        {activeSection === 'top_stocks'  && <TopStocksSection  marketDates={marketDates} />}
        {activeSection === 'fii_stats'   && <FIIStats          allDates={allDates} />}
        {activeSection === 'volatility'  && <VolatilitySection />}
      </div>
    </div>
  );
}
// frontend/src/pages/Participants.jsx
// ── Institutional Terminal Aesthetic ──────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

import LoadingSpinner from '../components/shared/LoadingSpinner';
import DateSlider     from '../components/shared/DateSlider';
import Divider        from '../components/shared/Divider';
import TerminalBtn    from '../components/shared/TerminalBtn';
import Panel, { PanelHeader } from '../components/shared/Panel';
import DateRangeRow, { RangePresets } from '../components/shared/DateRangeRow';
import ChartTooltip   from '../components/shared/ChartTooltip';
import PageHeader     from '../components/shared/PageHeader';
import TabBar         from '../components/shared/TabBar';
import { T, mono, labelStyle, PARTICIPANT_COLORS, PARTICIPANTS, chartAxisProps, gridProps } from '../theme';
import { fmtK, signed } from '../utils/formatters';
import { defaultRange } from '../utils/dateRange';
import { downloadCSV } from '../utils/csv';
import { participant } from '../api/client';

const toAssetClass = (ac) => ac === 'EQUITY' ? 'STOCK' : ac;

const ASSET_CLASSES = ['INDEX', 'STOCK'];

/* ─── SHARED STYLE HELPERS ───────────────────────────────────── */
const label = labelStyle;

const dataVal = (color = T.textHi, size = 14) => ({
  ...mono,
  fontSize: size,
  fontWeight: 600,
  color,
  letterSpacing: '0.04em',
});

/* ─── SHARED COMPONENTS ──────────────────────────────────────── */

function CSVBtn({ rows, filename }) {
  return (
    <TerminalBtn onClick={() => downloadCSV(rows, filename)} disabled={!rows?.length}>
      ↓ Export CSV
    </TerminalBtn>
  );
}

function AssetToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${T.border}` }}>
      {ASSET_CLASSES.map((ac) => (
        <TerminalBtn key={ac} active={value === ac} onClick={() => onChange(toAssetClass(ac))}
          style={{ borderWidth: 0, borderRight: ac === 'INDEX' ? `1px solid ${T.border}` : 0 }}>
          {ac}
        </TerminalBtn>
      ))}
    </div>
  );
}

function ParticipantToggles({ activeLines, onToggle }) {
  return (
    <div style={{ display: 'flex', gap: 0, border: `1px solid ${T.border}` }}>
      {PARTICIPANTS.map((p, i) => {
        const c = PARTICIPANT_COLORS[p];
        const active = activeLines.has(p);
        return (
          <button key={p} onClick={() => onToggle(p)} style={{
            ...mono,
            padding: '4px 12px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            background: active ? `${c}18` : 'transparent',
            border: 'none',
            borderRight: i < PARTICIPANTS.length - 1 ? `1px solid ${T.border}` : 'none',
            borderBottom: active ? `2px solid ${c}` : '2px solid transparent',
            color: active ? c : T.textLo,
            cursor: 'pointer',
            transition: 'all 0.12s',
          }}>
            {p}
          </button>
        );
      })}
    </div>
  );
}

function NetVal({ value, dim }) {
  if (value == null) return (
    <td style={{ ...mono, textAlign: 'right', padding: '5px 10px', fontSize: 11, color: T.textGhost }}>—</td>
  );
  const color = dim ? T.textMid : value >= 0 ? T.green : T.red;
  return (
    <td style={{ ...mono, textAlign: 'right', padding: '5px 10px', fontSize: 11, fontWeight: 600, color }}>
      {dim ? fmtK(value) : signed(value)}
    </td>
  );
}

/* ─── METRIC STRIP ───────────────────────────────────────────── */
function MetricStrip({ items }) {
  return (
    <div style={{
      display: 'flex',
      border: `1px solid ${T.border}`,
      overflow: 'hidden',
    }}>
      {items.map(({ title, value, sub, accent = T.amber }, i) => (
        <div key={title} style={{
          flex: 1,
          padding: '10px 14px',
          borderRight: i < items.length - 1 ? `1px solid ${T.border}` : 'none',
          background: T.surface,
          minWidth: 0,
        }}>
          <div style={label({ marginBottom: 5 })}>{title}</div>
          <div style={dataVal(accent)}>{value}</div>
          {sub && <div style={{ ...mono, fontSize: 9, color: T.textLo, marginTop: 3 }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ─── TABLE HELPERS ──────────────────────────────────────────── */
const thStyle = {
  ...mono,
  textAlign: 'right',
  padding: '6px 10px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.textLo,
  borderBottom: `1px solid ${T.borderHi}`,
  whiteSpace: 'nowrap',
};

const tdStyle = (right = true) => ({
  ...mono,
  textAlign: right ? 'right' : 'left',
  padding: '5px 10px',
  fontSize: 11,
  color: T.textMid,
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: 'nowrap',
});

/* ─── LOADING ────────────────────────────────────────────────── */
function TerminalLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
      <span style={{ ...mono, fontSize: 10, color: T.textLo, letterSpacing: '0.14em' }}>
        LOADING DATA…
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: LATEST SNAPSHOT
═══════════════════════════════════════════════════════════════ */
function LatestSnapshot({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await participant.latest(toAssetClass(assetClass));
      setData(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); setData([]); }
    setLoading(false);
  }, [assetClass]);

  useEffect(() => { load(); }, [load]);

  const byParticipant = useMemo(() => {
    const map = {};
    data.forEach(r => {
      const pt = r.participant_type, side = r.option_side;
      if (!map[pt]) map[pt] = {};
      const key = side === 'NA' ? 'fut' : side === 'CE' ? 'ce' : 'pe';
      if (r.direction === 'long')  map[pt][`${key}_long`]  = (map[pt][`${key}_long`]  ?? 0) + r.contracts;
      if (r.direction === 'short') map[pt][`${key}_short`] = (map[pt][`${key}_short`] ?? 0) + r.contracts;
    });
    Object.values(map).forEach(d => {
      d.fut_net = (d.fut_long ?? 0) - (d.fut_short ?? 0);
      d.ce_net  = (d.ce_long  ?? 0) - (d.ce_short  ?? 0);
      d.pe_net  = (d.pe_long  ?? 0) - (d.pe_short  ?? 0);
    });
    return map;
  }, [data]);

  const csvRows = useMemo(() => PARTICIPANTS.map(p => {
    const d = byParticipant[p] ?? {};
    return { participant: p, fut_long: d.fut_long ?? '', fut_short: d.fut_short ?? '', fut_net: d.fut_net ?? '',
      ce_long: d.ce_long ?? '', ce_short: d.ce_short ?? '', ce_net: d.ce_net ?? '',
      pe_long: d.pe_long ?? '', pe_short: d.pe_short ?? '', pe_net: d.pe_net ?? '' };
  }), [byParticipant]);

  // Summary strip
  const snapDate = allDates.at(-1) ?? '—';
  const fiiNet = byParticipant['FII']?.fut_net;
  const diiNet = byParticipant['DII']?.fut_net;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Metric strip */}
      <MetricStrip items={[
        { title: 'Snapshot Date', value: snapDate, accent: T.textMid },
        { title: 'Asset Class',   value: assetClass, accent: T.amber },
        { title: 'FII Fut Net',   value: fiiNet != null ? signed(fiiNet) : '—', accent: fiiNet == null ? T.textMid : fiiNet >= 0 ? T.green : T.red },
        { title: 'DII Fut Net',   value: diiNet != null ? signed(diiNet) : '—', accent: diiNet == null ? T.textMid : diiNet >= 0 ? T.green : T.red },
      ]} />

      <Panel
        title="Latest Participant Positioning"
        subtitle="Most recent session · net long/short across futures, calls, puts"
        right={<>
          <AssetToggle value={assetClass} onChange={setAssetClass} />
          <CSVBtn rows={csvRows} filename={`participant_latest_${assetClass}.csv`} />
        </>}
      >
        {loading ? <TerminalLoading /> : (
          <>
            {/* Participant summary cards — horizontal strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, marginBottom: 10, background: T.border }}>
              {PARTICIPANTS.map(p => {
                const d = byParticipant[p] ?? {};
                const c = PARTICIPANT_COLORS[p];
                return (
                  <div key={p} style={{ background: T.surface, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
                      <div style={{ width: 6, height: 6, background: c, flexShrink: 0 }} />
                      <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: c, letterSpacing: '0.10em' }}>{p}</span>
                    </div>
                    {[
                      { k: 'Fut Net',   v: d.fut_net,   signed: true },
                      { k: 'Fut Long',  v: d.fut_long,  signed: false },
                      { k: 'Fut Short', v: d.fut_short, signed: false },
                      null,
                      { k: 'CE Net',    v: d.ce_net,    signed: true },
                      { k: 'PE Net',    v: d.pe_net,    signed: true },
                    ].map((item, i) => item === null
                      ? <div key={i} style={{ height: 1, background: T.border, margin: '5px 0' }} />
                      : (
                        <div key={item.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={label()}>{item.k}</span>
                          <span style={{
                            ...mono, fontSize: 11, fontWeight: item.signed ? 600 : 400,
                            color: item.signed
                              ? (item.v == null ? T.textGhost : item.v >= 0 ? T.green : T.red)
                              : T.textMid,
                          }}>
                            {item.signed ? (item.v != null ? signed(item.v) : '—') : fmtK(item.v)}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>

            {/* Data grid table */}
            <div style={{ overflowX: 'auto', border: `1px solid ${T.border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: T.surfaceHi }}>
                    {['Participant','Fut Long','Fut Short','Fut Net','CE Net','PE Net'].map((h, i) => (
                      <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PARTICIPANTS.map(p => {
                    const d = byParticipant[p] ?? {};
                    return (
                      <tr key={p} style={{ background: T.surface }}>
                        <td style={{ ...tdStyle(false), color: PARTICIPANT_COLORS[p], fontWeight: 700 }}>{p}</td>
                        <NetVal value={d.fut_long}  dim />
                        <NetVal value={d.fut_short} dim />
                        <NetVal value={d.fut_net} />
                        <NetVal value={d.ce_net} />
                        <NetVal value={d.pe_net} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: NET OI CHART
═══════════════════════════════════════════════════════════════ */
function NetOIChart({ allDates }) {
  const [assetClass,  setAssetClass]  = useState('INDEX');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [rawData,     setRawData]     = useState([]);
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [activeLines, setActiveLines] = useState(new Set(PARTICIPANTS));

  useEffect(() => {
    const r = defaultRange(allDates, 6); setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await participant.netOI(startDate, endDate, assetClass);
      setRawData(raw);
      const byDate = {};
      for (const r of raw) {
        if (!byDate[r.trade_date]) byDate[r.trade_date] = { trade_date: r.trade_date };
        byDate[r.trade_date][`${r.participant_type}_${r.option_side}`] = r.net_contracts;
      }
      setData(Object.values(byDate).sort((a, b) => a.trade_date.localeCompare(b.trade_date)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, assetClass]);

  useEffect(() => { load(); }, [load]);

  const toggleLine = (p) => setActiveLines(prev => {
    const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next;
  });

  const csvRows = useMemo(() => data.map(row => {
    const out = { trade_date: row.trade_date };
    PARTICIPANTS.forEach(p => { out[`${p}_futures_net`] = row[`${p}_NA`] ?? ''; });
    return out;
  }), [data]);

  return (
    <Panel
      title="Net Open Interest — Futures"
      subtitle="Long minus short · positive = net long · FII is primary directional signal"
      right={<>
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <CSVBtn rows={csvRows} filename={`participant_net_oi_${assetClass}.csv`} />
      </>}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate}
          onStart={setStartDate} onEnd={setEndDate} />
        <Divider vertical style={{ height: 20 }} />
        <ParticipantToggles activeLines={activeLines} onToggle={toggleLine} />
      </div>
      {loading ? <TerminalLoading /> : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="trade_date" {...chartAxisProps}
              tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
            <YAxis {...chartAxisProps} tickFormatter={fmtK} width={58} />
            <ReferenceLine y={0} stroke={T.borderHi} strokeDasharray="3 3" />
            <Tooltip content={<ChartTooltip />} />
            {PARTICIPANTS.map(p => activeLines.has(p) && (
              <Line key={p} dataKey={`${p}_NA`} name={p} stroke={PARTICIPANT_COLORS[p]}
                dot={false} strokeWidth={p === 'FII' ? 2 : 1.5} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: NET VOLUME CHART
═══════════════════════════════════════════════════════════════ */
function NetVolChart({ allDates }) {
  const [assetClass,  setAssetClass]  = useState('INDEX');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [activeLines, setActiveLines] = useState(new Set(PARTICIPANTS));

  useEffect(() => {
    const r = defaultRange(allDates, 3); setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await participant.netVol(startDate, endDate, assetClass);
      const byDate = {};
      for (const r of raw) {
        if (!byDate[r.trade_date]) byDate[r.trade_date] = { trade_date: r.trade_date };
        byDate[r.trade_date][`${r.participant_type}_${r.option_side}`] = r.net_contracts;
      }
      setData(Object.values(byDate).sort((a, b) => a.trade_date.localeCompare(b.trade_date)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, assetClass]);

  useEffect(() => { load(); }, [load]);

  const toggleLine = (p) => setActiveLines(prev => {
    const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next;
  });

  const csvRows = useMemo(() => data.map(row => {
    const out = { trade_date: row.trade_date };
    PARTICIPANTS.forEach(p => { out[`${p}_futures_net_vol`] = row[`${p}_NA`] ?? ''; });
    return out;
  }), [data]);

  return (
    <Panel
      title="Net Volume — Futures"
      subtitle="Buy minus sell volume per session · positive = net buyer"
      right={<>
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <CSVBtn rows={csvRows} filename={`participant_net_vol_${assetClass}.csv`} />
      </>}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate}
          onStart={setStartDate} onEnd={setEndDate} />
        <Divider vertical style={{ height: 20 }} />
        <ParticipantToggles activeLines={activeLines} onToggle={toggleLine} />
      </div>
      {loading ? <TerminalLoading /> : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="trade_date" {...chartAxisProps}
              tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
            <YAxis {...chartAxisProps} tickFormatter={fmtK} width={58} />
            <ReferenceLine y={0} stroke={T.borderHi} strokeDasharray="3 3" />
            <Tooltip content={<ChartTooltip />} />
            {PARTICIPANTS.map(p => activeLines.has(p) && (
              <Bar key={p} dataKey={`${p}_NA`} name={p} fill={PARTICIPANT_COLORS[p]}
                opacity={0.80} radius={0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: OPTIONS POSITIONING
═══════════════════════════════════════════════════════════════ */
function OptionsPositioning({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [activeP,    setActiveP]    = useState('FII');
  const [startDate,  setStartDate]  = useState('');
  const [endDate,    setEndDate]    = useState('');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    const r = defaultRange(allDates, 3); setStartDate(r.start); setEndDate(r.end);
  }, [allDates]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const raw = await participant.netOI(startDate, endDate, assetClass);
      const byDate = {};
      for (const r of raw) {
        if (r.participant_type !== activeP) continue;
        if (!byDate[r.trade_date]) byDate[r.trade_date] = { trade_date: r.trade_date };
        if (r.option_side === 'CE') byDate[r.trade_date].ce = r.net_contracts;
        if (r.option_side === 'PE') byDate[r.trade_date].pe = r.net_contracts;
      }
      setData(Object.values(byDate).sort((a, b) => a.trade_date.localeCompare(b.trade_date)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate, assetClass, activeP]);

  useEffect(() => { load(); }, [load]);

  const csvRows = useMemo(() => data.map(r => ({
    trade_date: r.trade_date, participant: activeP, ce_net: r.ce ?? '', pe_net: r.pe ?? '',
  })), [data, activeP]);

  const color = PARTICIPANT_COLORS[activeP];

  return (
    <Panel
      title="Options Net OI by Participant"
      subtitle="CE net long = bullish · PE net long = hedge / bearish"
      right={<CSVBtn rows={csvRows} filename={`options_net_oi_${activeP}_${assetClass}.csv`} />}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <Divider vertical style={{ height: 20 }} />
        {/* Participant selector */}
        <div style={{ display: 'flex', border: `1px solid ${T.border}` }}>
          {PARTICIPANTS.map((p, i) => {
            const c = PARTICIPANT_COLORS[p];
            const active = activeP === p;
            return (
              <button key={p} onClick={() => setActiveP(p)} style={{
                ...mono,
                padding: '4px 12px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                background: active ? `${c}18` : 'transparent',
                border: 'none',
                borderRight: i < PARTICIPANTS.length - 1 ? `1px solid ${T.border}` : 'none',
                borderBottom: active ? `2px solid ${c}` : '2px solid transparent',
                color: active ? c : T.textLo,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}>{p}</button>
            );
          })}
        </div>
        <Divider vertical style={{ height: 20 }} />
        <DateRangeRow allDates={allDates} startDate={startDate} endDate={endDate}
          onStart={setStartDate} onEnd={setEndDate} />
      </div>
      {loading ? <TerminalLoading /> : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="trade_date" {...chartAxisProps}
              tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
            <YAxis {...chartAxisProps} tickFormatter={fmtK} width={58} />
            <ReferenceLine y={0} stroke={T.borderHi} strokeDasharray="3 3" />
            <Tooltip content={<ChartTooltip />} />
            <Line dataKey="ce" name={`${activeP} CE`} stroke={color}   dot={false} strokeWidth={2} />
            <Line dataKey="pe" name={`${activeP} PE`} stroke={T.pink}  dot={false} strokeWidth={2} strokeDasharray="5 3" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: DAILY TABLE
═══════════════════════════════════════════════════════════════ */
function DailyTable({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [tradeDate,  setTradeDate]  = useState('');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => { if (allDates.length) setTradeDate(allDates.at(-1)); }, [allDates]);

  const load = useCallback(async () => {
    if (!tradeDate) return;
    setLoading(true);
    try {
      const raw = await participant.netOI(tradeDate, tradeDate, assetClass);
      setData(raw);
    } catch (e) { console.error(e); setData([]); }
    setLoading(false);
  }, [tradeDate, assetClass]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = {};
    data.forEach(r => {
      if (!map[r.participant_type]) map[r.participant_type] = {};
      map[r.participant_type][r.option_side] = r;
    });
    return map;
  }, [data]);

  const sides = ['NA', 'CE', 'PE'];
  const sideLabel = { NA: 'Futures', CE: 'Calls', PE: 'Puts' };

  const csvRows = useMemo(() => PARTICIPANTS.flatMap(p =>
    sides.map(side => {
      const row = grouped[p]?.[side];
      return { participant: p, instrument: sideLabel[side],
        long: row?.long_contracts ?? '', short: row?.short_contracts ?? '', net: row?.net_contracts ?? '' };
    })
  ), [grouped]);

  return (
    <Panel
      title="Single Session Positions"
      subtitle="Full long / short / net breakdown by participant and instrument"
      right={<>
        <AssetToggle value={assetClass} onChange={setAssetClass} />
        <CSVBtn rows={csvRows} filename={`positions_${tradeDate}_${assetClass}.csv`} />
      </>}
    >
      <div style={{ marginBottom: 12 }}>
        <DateSlider dates={allDates} selectedDate={tradeDate} onChange={setTradeDate} />
      </div>
      {loading ? <TerminalLoading /> : (
        <div style={{ overflowX: 'auto', border: `1px solid ${T.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.surfaceHi }}>
                {['Participant','Instrument','Long','Short','Net'].map((h, i) => (
                  <th key={h} style={{ ...thStyle, textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PARTICIPANTS.flatMap(p =>
                sides.map((side, si) => {
                  const row = grouped[p]?.[side];
                  return (
                    <tr key={`${p}-${side}`}
                      style={{ background: si === 0 ? `${PARTICIPANT_COLORS[p]}06` : T.surface }}>
                      {si === 0
                        ? <td rowSpan={3} style={{ ...tdStyle(false), color: PARTICIPANT_COLORS[p], fontWeight: 700, verticalAlign: 'middle', borderRight: `1px solid ${T.border}` }}>{p}</td>
                        : null}
                      <td style={{ ...tdStyle(false), color: T.textLo }}>{sideLabel[side]}</td>
                      <NetVal value={row?.long_contracts}  dim />
                      <NetVal value={row?.short_contracts} dim />
                      <NetVal value={row?.net_contracts} />
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: ANALYSIS TABLE
═══════════════════════════════════════════════════════════════ */
function flowType(delta) {
  if (delta == null || delta === 0) return null;
  if (delta > 0) return delta > 50000 ? 'fresh_long'  : 'cover';
  else           return Math.abs(delta) > 50000 ? 'fresh_short' : 'unwind';
}

const FLOW_META = {
  fresh_long:  { label: 'FRESH LONG',  bg: 'rgba(0,200,150,0.12)',  border: '#00C896', text: '#00C896' },
  cover:       { label: 'SHORT COVER', bg: 'rgba(0,200,150,0.06)',  border: 'rgba(0,200,150,0.35)', text: 'rgba(0,200,150,0.7)' },
  fresh_short: { label: 'FRESH SHORT', bg: 'rgba(224,82,82,0.12)',  border: '#E05252', text: '#E05252' },
  unwind:      { label: 'LONG UNWIND', bg: 'rgba(224,82,82,0.06)',  border: 'rgba(224,82,82,0.35)', text: 'rgba(224,82,82,0.7)' },
};

function FlowBadge({ delta }) {
  const type = flowType(delta);
  if (!type) return <span style={{ ...mono, color: T.textGhost, fontSize: 9 }}>—</span>;
  const m = FLOW_META[type];
  return (
    <span style={{
      ...mono,
      display: 'inline-block',
      padding: '2px 7px',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.12em',
      border: `1px solid ${m.border}`,
      background: m.bg,
      color: m.text,
    }}>
      {m.label}
    </span>
  );
}

function AnalysisTable({ allDates }) {
  const [assetClass, setAssetClass] = useState('INDEX');
  const [tradeDate,  setTradeDate]  = useState('');
  const [oiData,     setOiData]     = useState([]);
  const [volData,    setVolData]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [segment,    setSegment]    = useState('FUT');

  useEffect(() => { if (allDates.length) setTradeDate(allDates.at(-1)); }, [allDates]);

  const load = useCallback(async () => {
    if (!tradeDate || !allDates.length) return;
    setLoading(true);
    try {
      const idx = allDates.indexOf(tradeDate);
      const prevDay = idx > 0 ? allDates[idx - 1] : tradeDate;
      const [oi, vol] = await Promise.all([
        participant.netOI(prevDay, tradeDate, assetClass),
        participant.netVol(tradeDate, tradeDate, assetClass),
      ]);
      setOiData(oi); setVolData(vol);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tradeDate, assetClass, allDates]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const byDatePtSide = {};
    for (const r of oiData) byDatePtSide[`${r.trade_date}|${r.participant_type}|${r.option_side}`] = r;
    const volByPtSide = {};
    for (const r of volData) volByPtSide[`${r.participant_type}|${r.option_side}`] = r;
    const idx = allDates.indexOf(tradeDate);
    const prevDay = idx > 0 ? allDates[idx - 1] : null;

    return PARTICIPANTS.map(p => {
      const get = (date, side) => byDatePtSide[`${date}|${p}|${side}`];
      const todayFut = get(tradeDate, 'NA'), prevFut  = prevDay ? get(prevDay, 'NA') : null;
      const todayCE  = get(tradeDate, 'CE'), prevCE   = prevDay ? get(prevDay, 'CE') : null;
      const todayPE  = get(tradeDate, 'PE'), prevPE   = prevDay ? get(prevDay, 'PE') : null;
      const volFut = volByPtSide[`${p}|NA`], volCE = volByPtSide[`${p}|CE`], volPE = volByPtSide[`${p}|PE`];

      const futNetDelta = todayFut && prevFut ? (todayFut.net_contracts ?? 0) - (prevFut.net_contracts ?? 0) : null;
      const ceNetDelta  = todayCE  && prevCE  ? (todayCE.net_contracts  ?? 0) - (prevCE.net_contracts  ?? 0) : null;
      const peNetDelta  = todayPE  && prevPE  ? (todayPE.net_contracts  ?? 0) - (prevPE.net_contracts  ?? 0) : null;

      return {
        participant: p,
        futLong: todayFut?.long_contracts, futShort: todayFut?.short_contracts, futNet: todayFut?.net_contracts, futNetDelta,
        ceLong:  todayCE?.long_contracts,  ceShort:  todayCE?.short_contracts,  ceNet:  todayCE?.net_contracts,  ceNetDelta,
        peLong:  todayPE?.long_contracts,  peShort:  todayPE?.short_contracts,  peNet:  todayPE?.net_contracts,  peNetDelta,
        totalLong:  (todayFut?.long_contracts  ?? 0) + (todayCE?.long_contracts  ?? 0) + (todayPE?.long_contracts  ?? 0),
        totalShort: (todayFut?.short_contracts ?? 0) + (todayCE?.short_contracts ?? 0) + (todayPE?.short_contracts ?? 0),
        volFutNet: volFut?.net_contracts, volCENet: volCE?.net_contracts, volPENet: volPE?.net_contracts,
      };
    });
  }, [oiData, volData, tradeDate, allDates]);

  const csvRows = useMemo(() => rows.map(r => ({
    participant: r.participant, trade_date: tradeDate, asset_class: assetClass,
    fut_long: r.futLong ?? '', fut_short: r.futShort ?? '', fut_net: r.futNet ?? '', fut_net_change: r.futNetDelta ?? '',
    ce_long: r.ceLong ?? '',   ce_short: r.ceShort ?? '',   ce_net: r.ceNet ?? '',   ce_net_change: r.ceNetDelta ?? '',
    pe_long: r.peLong ?? '',   pe_short: r.peShort ?? '',   pe_net: r.peNet ?? '',   pe_net_change: r.peNetDelta ?? '',
    total_long: r.totalLong ?? '', total_short: r.totalShort ?? '',
    vol_fut_net: r.volFutNet ?? '', vol_ce_net: r.volCENet ?? '', vol_pe_net: r.volPENet ?? '',
  })), [rows, tradeDate, assetClass]);

  const segs = [{ key: 'FUT', label: 'Futures' }, { key: 'CE', label: 'Calls' }, { key: 'PE', label: 'Puts' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Panel
        title="Participant Flow Analysis"
        subtitle="Daily flow classification · mirrors NSE IDX/STK Analysis format"
        right={<>
          <AssetToggle value={assetClass} onChange={setAssetClass} />
          <div style={{ display: 'flex', border: `1px solid ${T.border}` }}>
            {segs.map((s, i) => (
              <TerminalBtn key={s.key} active={segment === s.key} onClick={() => setSegment(s.key)}
                style={{ borderWidth: 0, borderRight: i < 2 ? `1px solid ${T.border}` : 0 }}>
                {s.label}
              </TerminalBtn>
            ))}
          </div>
          <CSVBtn rows={csvRows} filename={`participant_analysis_${tradeDate}_${assetClass}.csv`} />
        </>}
      >
        <div style={{ marginBottom: 12 }}>
          <DateSlider dates={allDates} selectedDate={tradeDate} onChange={setTradeDate} />
        </div>

        {loading ? <TerminalLoading /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* ── Main analysis grid ── */}
            <div style={{ overflowX: 'auto', border: `1px solid ${T.border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: T.surfaceHi }}>
                    {['Participant','Long','Short','Net OI','Δ Net','Flow Type','Net Vol','Total Long','Total Short','Total Net']
                      .map((h, i) => <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const c = PARTICIPANT_COLORS[r.participant];
                    const long   = segment === 'FUT' ? r.futLong     : segment === 'CE' ? r.ceLong    : r.peLong;
                    const short  = segment === 'FUT' ? r.futShort    : segment === 'CE' ? r.ceShort   : r.peShort;
                    const net    = segment === 'FUT' ? r.futNet      : segment === 'CE' ? r.ceNet     : r.peNet;
                    const delta  = segment === 'FUT' ? r.futNetDelta : segment === 'CE' ? r.ceNetDelta: r.peNetDelta;
                    const volNet = segment === 'FUT' ? r.volFutNet   : segment === 'CE' ? r.volCENet  : r.volPENet;
                    const totalNet = (r.totalLong ?? 0) - (r.totalShort ?? 0);
                    return (
                      <tr key={r.participant} style={{ background: T.surface, borderLeft: `2px solid ${c}` }}>
                        <td style={{ ...tdStyle(false), color: c, fontWeight: 700 }}>{r.participant}</td>
                        <NetVal value={long}  dim />
                        <NetVal value={short} dim />
                        <NetVal value={net} />
                        <td style={{ ...mono, textAlign: 'right', padding: '5px 10px', fontSize: 11, fontWeight: 600,
                          color: delta == null ? T.textGhost : delta >= 0 ? T.green : T.red,
                          borderBottom: `1px solid ${T.border}` }}>
                          {delta != null ? signed(delta) : '—'}
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 10px', borderBottom: `1px solid ${T.border}` }}>
                          <FlowBadge delta={delta} />
                        </td>
                        <NetVal value={volNet} />
                        <NetVal value={r.totalLong}  dim />
                        <NetVal value={r.totalShort} dim />
                        <NetVal value={totalNet} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── OI all-segments summary ── */}
            <div>
              <div style={{ ...label({ color: T.amber }), marginBottom: 6, paddingTop: 4 }}>
                Open Interest Snapshot — All Segments
              </div>
              <div style={{ overflowX: 'auto', border: `1px solid ${T.border}` }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: T.surfaceHi }}>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Participant</th>
                      {[
                        { label: '── Futures ──', color: T.blue,   span: 3 },
                        { label: '── Calls ──',   color: T.green,  span: 3 },
                        { label: '── Puts ──',    color: T.pink,   span: 3 },
                        { label: 'Total',         color: T.textLo, span: 2 },
                      ].map(({ label: l, color: col, span }) => (
                        <th key={l} colSpan={span} style={{ ...thStyle, color: col, textAlign: 'center' }}>{l}</th>
                      ))}
                    </tr>
                    <tr style={{ background: T.surfaceHi }}>
                      <th />
                      {['Long','Short','Net','Long','Short','Net','Long','Short','Net','Long','Short'].map((h, i) => (
                        <th key={i} style={{ ...thStyle, color: T.textGhost, fontWeight: 500, borderTop: `1px solid ${T.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.participant} style={{ background: T.surface }}>
                        <td style={{ ...tdStyle(false), color: PARTICIPANT_COLORS[r.participant], fontWeight: 700 }}>{r.participant}</td>
                        <NetVal value={r.futLong}  dim /><NetVal value={r.futShort} dim /><NetVal value={r.futNet} />
                        <NetVal value={r.ceLong}   dim /><NetVal value={r.ceShort}  dim /><NetVal value={r.ceNet} />
                        <NetVal value={r.peLong}   dim /><NetVal value={r.peShort}  dim /><NetVal value={r.peNet} />
                        <NetVal value={r.totalLong} dim /><NetVal value={r.totalShort} dim />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Volume summary ── */}
            <div>
              <div style={{ ...label({ color: T.amber }), marginBottom: 6, paddingTop: 4 }}>
                Net Volume — Current Session Trading Activity
              </div>
              <div style={{ overflowX: 'auto', border: `1px solid ${T.border}` }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: T.surfaceHi }}>
                      {['Participant','Fut Net Vol','CE Net Vol','PE Net Vol'].map((h, i) => (
                        <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.participant} style={{ background: T.surface }}>
                        <td style={{ ...tdStyle(false), color: PARTICIPANT_COLORS[r.participant], fontWeight: 700 }}>{r.participant}</td>
                        <NetVal value={r.volFutNet} />
                        <NetVal value={r.volCENet} />
                        <NetVal value={r.volPENet} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Flow legend */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4 }}>
              {Object.entries(FLOW_META).map(([, m]) => (
                <span key={m.label} style={{
                  ...mono, display: 'inline-block', padding: '2px 8px', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.10em', border: `1px solid ${m.border}`, background: m.bg, color: m.text,
                }}>
                  {m.label}
                </span>
              ))}
              <span style={{ ...mono, fontSize: 9, color: T.textLo, marginLeft: 4 }}>
                THRESHOLD ±50K CONTRACTS
              </span>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
export default function Participants() {
  const [allDates, setAllDates] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [section,  setSection]  = useState('overview');

  useEffect(() => {
    participant.dates().then(setAllDates).catch(console.error).finally(() => setLoading(false));
  }, []);

  const sections = [
    { key: 'overview', label: 'Overview'    },
    { key: 'net_oi',   label: 'Net OI'      },
    { key: 'net_vol',  label: 'Net Volume'  },
    { key: 'options',  label: 'Options'     },
    { key: 'table',    label: 'Daily Table' },
    { key: 'analysis', label: 'Analysis'    },
  ];

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
      <LoadingSpinner size="lg" />
    </div>
  );

  return (
    <div style={{ background: T.bg, minHeight: '100vh', ...mono }}>
      {/* ── Page Header ── */}
      <PageHeader
        title="Participant Activity"
        subtitle="FII · DII · Client · Pro — net positioning across futures and options"
      />
      <TabBar tabs={sections} active={section} onChange={setSection} />

      {/* ── Content ── */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {section === 'overview'  && <LatestSnapshot     allDates={allDates} />}
        {section === 'net_oi'    && <NetOIChart         allDates={allDates} />}
        {section === 'net_vol'   && <NetVolChart        allDates={allDates} />}
        {section === 'options'   && <OptionsPositioning allDates={allDates} />}
        {section === 'table'     && <DailyTable         allDates={allDates} />}
        {section === 'analysis'  && <AnalysisTable      allDates={allDates} />}
      </div>
    </div>
  );
}
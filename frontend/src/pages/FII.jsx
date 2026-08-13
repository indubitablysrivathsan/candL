import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import DateSlider     from "../components/shared/DateSlider";
import TerminalBtn    from "../components/shared/TerminalBtn";
import { PanelHeader as SectionHeader } from "../components/shared/Panel";
import ChartTooltip   from "../components/shared/ChartTooltip";
import TabBar         from "../components/shared/TabBar";
import PageHeader      from "../components/shared/PageHeader";
import { T, mono, labelStyle, PARTICIPANTS } from "../theme";
import { fmt, fmtK, fmtCr, sign, netCol, subtractDays } from "../utils/formatters";
import { downloadCSV } from "../utils/csv";
import { fii, participant } from "../api/client";

// participant accent colours — FII page-specific palette (differs from
// Participants.jsx's PARTICIPANT_COLORS; kept local intentionally).
const P_COLOR = { FII: '#4A9EFF', DII: '#F0A500', Client: '#00C896', Pro: '#B39DDB' };

// ─── Shared style helpers ─────────────────────────────────────────────────────
const label11 = labelStyle();
const val14   = { fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', fontFamily: mono.fontFamily };

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────
const OVERVIEW_GROUPS = [
  { label: 'Index Futures',  instruments: ['INDEX FUTURES','NIFTY FUTURES','BANKNIFTY FUTURES'] },
  { label: 'Index Options',  instruments: ['INDEX OPTIONS','NIFTY OPTIONS','BANKNIFTY OPTIONS']  },
  { label: 'Stock Futures',  instruments: ['STOCK FUTURES']  },
  { label: 'Stock Options',  instruments: ['STOCK OPTIONS']  },
];

function OverviewTab({ latestDate }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [asset, setAsset]     = useState('INDEX');

  useEffect(() => {
    if (!latestDate) return;
    setLoading(true);
    fii.stats(latestDate, latestDate)
      .then(setRows).catch(()=>setRows([])).finally(()=>setLoading(false));
  }, [latestDate]);

  if (loading) return <div style={{ minHeight: 200, display:'flex', alignItems:'center', justifyContent:'center' }}><LoadingSpinner /></div>;

  const aggregate = (instruments) =>
    rows.filter(r=>instruments.includes(r.instrument))
        .reduce((acc,r) => ({
          net_contracts:  (acc.net_contracts ??0) + (r.net_contracts ??0),
          net_amount_cr:  (acc.net_amount_cr ??0) + (r.net_amount_cr ??0),
          buy_contracts:  (acc.buy_contracts ??0) + (r.buy_contracts ??0),
          sell_contracts: (acc.sell_contracts??0) + (r.sell_contracts??0),
          oi_contracts:   (acc.oi_contracts  ??0) + (r.oi_contracts  ??0),
          oi_amount_cr:   (acc.oi_amount_cr  ??0) + (r.oi_amount_cr  ??0),
        }), {});

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', border:`1px solid ${T.border}` }}>
        {OVERVIEW_GROUPS.map(({label, instruments},i) => {
          const d = aggregate(instruments);
          return (
            <div key={label} style={{ padding:'14px 16px', borderRight: i<3?`1px solid ${T.border}`:'none', background: T.surface }}>
              <div style={{ ...label11, marginBottom:10 }}>{label}</div>
              <div style={{ fontSize:22, fontWeight:700, color: netCol(d.net_contracts), ...mono }}>
                {sign(d.net_contracts)}{fmtK(d.net_contracts)}
              </div>
              <div style={{ ...label11, marginTop:2, marginBottom:10 }}>Net Lots</div>
              <div style={{ fontSize:13, fontWeight:600, color: netCol(d.net_amount_cr), ...mono }}>
                {sign(d.net_amount_cr)}{fmtCr(d.net_amount_cr)}
              </div>
              <div style={{ ...label11, marginTop:2, marginBottom:10 }}>Net Value</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', paddingTop:10, borderTop:`1px solid ${T.border}`, gap:4 }}>
                {[['Bought', d.buy_contracts],['Sold', d.sell_contracts],['OI', d.oi_contracts]].map(([lbl,val])=>(
                  <div key={lbl}>
                    <div style={label11}>{lbl}</div>
                    <div style={{ fontSize:11, color: T.textMid, ...mono, marginTop:2 }}>{fmtK(val)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* All instruments table */}
      <div style={{ background: T.surface, border:`1px solid ${T.border}` }}>
        <SectionHeader
          title="All Instruments"
          subtitle={`Full FII activity snapshot · ${latestDate}`}
          right={<TerminalBtn onClick={()=>downloadCSV(rows,`fii_overview_${latestDate}.csv`,[
            {key:'instrument',label:'Instrument'},{key:'buy_contracts',label:'Bought (Lots)'},
            {key:'buy_amount_cr',label:'Buy Value (₹ Cr)'},{key:'sell_contracts',label:'Sold (Lots)'},
            {key:'sell_amount_cr',label:'Sell Value (₹ Cr)'},{key:'oi_contracts',label:'OI (Lots)'},
            {key:'oi_amount_cr',label:'OI Value (₹ Cr)'},{key:'net_contracts',label:'Net Lots'},
            {key:'net_amount_cr',label:'Net Value (₹ Cr)'},
          ])}>↓ Export CSV</TerminalBtn>}
        />
        <InstrumentTable rows={rows} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NET OI TAB  (participant positioning — mirrors screenshot layout)
// ─────────────────────────────────────────────────────────────────────────────
function NetOITab({ latestDate }) {
  const [raw, setRaw]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(90);
  const [asset, setAsset]     = useState('INDEX');
  const [visible, setVisible] = useState(['FII','DII','Client','Pro']);

  useEffect(() => {
    if (!latestDate) return;
    setLoading(true);
    const start = subtractDays(latestDate, days);
    participant.netOI(start, latestDate, asset)
      .then(setRaw).catch(()=>setRaw([])).finally(()=>setLoading(false));
  }, [latestDate, days, asset]);

  const chartData = useMemo(() => {
    const map = {};
    raw.forEach(r => {
      if (r.option_side !== 'NA') return; // futures only for net OI line
      const d = r.trade_date;
      if (!map[d]) map[d] = { date: d.slice(5) };
      map[d][r.participant_type] = r.net_contracts;
    });
    return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date));
  }, [raw]);

  const toggle = k => setVisible(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ background: T.surface, border:`1px solid ${T.border}` }}>
        <SectionHeader
          title="Net OI — Futures Positioning"
          subtitle="Net long − short contracts by participant"
          right={
            <div style={{ display:'flex', gap:6 }}>
              {[30,90,180,365].map(d=>(
                <TerminalBtn key={d} active={days===d} color={T.blue} onClick={()=>setDays(d)} small>
                  {d===30?'1M':d===90?'3M':d===180?'6M':'1Y'}
                </TerminalBtn>
              ))}
              <div style={{ width:1, background: T.border, margin:'0 4px' }} />
              {['INDEX','STOCK'].map(a=>(
                <TerminalBtn key={a} active={asset===a} color={T.amber} onClick={()=>setAsset(a)} small>{a}</TerminalBtn>
              ))}
            </div>
          }
        />
        <div style={{ padding:16 }}>
          <div style={{ display:'flex', gap:6, marginBottom:14 }}>
            {PARTICIPANTS.map(p=>(
              <button key={p} onClick={()=>toggle(p)} style={{
                display:'flex', alignItems:'center', gap:6, padding:'4px 10px',
                border:`1px solid ${visible.includes(p)?P_COLOR[p]:T.border}`,
                background: visible.includes(p)?`${P_COLOR[p]}15`:'transparent',
                color: visible.includes(p)?P_COLOR[p]:T.textLo,
                fontSize:10, cursor:'pointer', borderRadius:0, ...mono,
                letterSpacing:'0.08em', textTransform:'uppercase',
              }}>
                <span style={{ width:6,height:6,borderRadius:'50%',background:P_COLOR[p],opacity:visible.includes(p)?1:0.3 }} />
                {p}
              </button>
            ))}
          </div>
          {loading ? <div style={{ height:260,display:'flex',alignItems:'center',justifyContent:'center' }}><LoadingSpinner /></div> : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{top:4,right:4,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                  interval={Math.max(1,Math.floor(chartData.length/9))} />
                <YAxis tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                  tickFormatter={fmtK} width={60} />
                <Tooltip content={<ChartTooltip valueFormatter={v=>`${fmtK(v)} lots`} />} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
                <Legend wrapperStyle={{fontSize:10,color:T.textLo,paddingTop:8,...mono}} iconType="circle" iconSize={7} />
                {PARTICIPANTS.map(p=>visible.includes(p)&&(
                  <Line key={p} type="monotone" dataKey={p} name={p}
                    stroke={P_COLOR[p]} dot={false} strokeWidth={1.5} connectNulls />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NET VOLUME TAB
// ─────────────────────────────────────────────────────────────────────────────
function NetVolumeTab({ latestDate }) {
  const [raw, setRaw]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(90);
  const [asset, setAsset]     = useState('INDEX');
  const [metric, setMetric]   = useState('lots');

  useEffect(() => {
    if (!latestDate) return;
    setLoading(true);
    const start = subtractDays(latestDate, days);
    fii.indexFlow(start, latestDate)
      .then(setRaw).catch(()=>setRaw([])).finally(()=>setLoading(false));
  }, [latestDate, days]);

  const chartData = useMemo(()=>{
    const filtered = raw.filter(r=>r.instrument==='INDEX FUTURES');
    return filtered.map(r=>({ date:r.trade_date.slice(5), value: metric==='lots'?r.net_contracts:r.net_amount_cr }));
  },[raw,metric]);

  return (
    <div style={{ background: T.surface, border:`1px solid ${T.border}` }}>
      <SectionHeader
        title="Net Volume — Index Flow"
        subtitle="FII net trading activity in index futures"
        right={
          <div style={{ display:'flex', gap:6 }}>
            {[30,90,180,365].map(d=>(
              <TerminalBtn key={d} active={days===d} color={T.blue} onClick={()=>setDays(d)} small>
                {d===30?'1M':d===90?'3M':d===180?'6M':'1Y'}
              </TerminalBtn>
            ))}
            <div style={{ width:1, background:T.border, margin:'0 4px' }} />
            {[{label:'Net Lots',value:'lots'},{label:'Net Value',value:'value'}].map(o=>(
              <TerminalBtn key={o.value} active={metric===o.value} color={T.amber} onClick={()=>setMetric(o.value)} small>{o.label}</TerminalBtn>
            ))}
          </div>
        }
      />
      <div style={{ padding:16 }}>
        {loading ? <div style={{ height:280,display:'flex',alignItems:'center',justifyContent:'center' }}><LoadingSpinner /></div> : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{top:4,right:4,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                interval={Math.max(1,Math.floor(chartData.length/9))} />
              <YAxis tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                tickFormatter={metric==='value'?v=>`₹${fmtK(v)}`:fmtK} width={68} />
              <Tooltip content={<ChartTooltip valueFormatter={metric==='value'?fmtCr:v=>`${fmtK(v)} lots`} />} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
              <Bar dataKey="value" name={metric==='lots'?'Net Lots':'Net Value'} radius={[2,2,0,0]}
                fill={T.blue}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS TAB  (CE/PE OI positioning by participant)
// ─────────────────────────────────────────────────────────────────────────────
function OptionsTab({ latestDate }) {
  const [raw, setRaw]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(90);
  const [asset, setAsset]     = useState('INDEX');
  const [side, setSide]       = useState('CE');

  useEffect(()=>{
    if (!latestDate) return;
    setLoading(true);
    const start = subtractDays(latestDate, days);
    participant.netOI(start, latestDate, asset)
      .then(setRaw).catch(()=>setRaw([])).finally(()=>setLoading(false));
  },[latestDate,days,asset]);

  const chartData = useMemo(()=>{
    const filtered = raw.filter(r=>r.option_side===side);
    const map={};
    filtered.forEach(r=>{
      const d=r.trade_date;
      if(!map[d])map[d]={date:d.slice(5)};
      map[d][r.participant_type]=r.net_contracts;
    });
    return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date));
  },[raw,side]);

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}` }}>
      <SectionHeader
        title="Options OI Positioning"
        subtitle="Net long − short contracts by participant across calls and puts"
        right={
          <div style={{ display:'flex', gap:6 }}>
            {[30,90,180,365].map(d=>(
              <TerminalBtn key={d} active={days===d} color={T.blue} onClick={()=>setDays(d)} small>
                {d===30?'1M':d===90?'3M':d===180?'6M':'1Y'}
              </TerminalBtn>
            ))}
            <div style={{ width:1,background:T.border,margin:'0 4px' }} />
            {['INDEX','STOCK'].map(a=>(
              <TerminalBtn key={a} active={asset===a} color={T.amber} onClick={()=>setAsset(a)} small>{a}</TerminalBtn>
            ))}
            <div style={{ width:1,background:T.border,margin:'0 4px' }} />
            {['CE','PE'].map(s=>(
              <TerminalBtn key={s} active={side===s} color={s==='CE'?T.green:T.red} onClick={()=>setSide(s)} small>{s}</TerminalBtn>
            ))}
          </div>
        }
      />
      <div style={{ padding:16 }}>
        {loading ? <div style={{ height:280,display:'flex',alignItems:'center',justifyContent:'center' }}><LoadingSpinner /></div> : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{top:4,right:4,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                interval={Math.max(1,Math.floor(chartData.length/9))} />
              <YAxis tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                tickFormatter={fmtK} width={60} />
              <Tooltip content={<ChartTooltip valueFormatter={v=>`${fmtK(v)} lots`} />} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
              <Legend wrapperStyle={{fontSize:10,color:T.textLo,paddingTop:8,...mono}} iconType="circle" iconSize={7} />
              {PARTICIPANTS.map(p=>(
                <Line key={p} type="monotone" dataKey={p} name={p}
                  stroke={P_COLOR[p]} dot={false} strokeWidth={1.5} connectNulls />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY TABLE TAB
// ─────────────────────────────────────────────────────────────────────────────
function DailyTableTab({ dates }) {
  const [selectedDate, setSelectedDate] = useState(dates?.[dates.length-1]??null);
  const [rows, setRows]                 = useState([]);
  const [loading, setLoading]           = useState(false);

  useEffect(()=>{
    if(!selectedDate)return;
    setLoading(true);
    fii.summary(selectedDate)
      .then(setRows).catch(()=>setRows([])).finally(()=>setLoading(false));
  },[selectedDate]);

  const CSV_COLS=[
    {key:'instrument',label:'Instrument'},{key:'buy_contracts',label:'Bought (Lots)'},
    {key:'buy_amount_cr',label:'Buy Value (₹ Cr)'},{key:'sell_contracts',label:'Sold (Lots)'},
    {key:'sell_amount_cr',label:'Sell Value (₹ Cr)'},{key:'oi_contracts',label:'OI (Lots)'},
    {key:'oi_amount_cr',label:'OI Value (₹ Cr)'},{key:'net_contracts',label:'Net Lots'},
    {key:'net_amount_cr',label:'Net Value (₹ Cr)'},
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {dates?.length>0 && <DateSlider dates={dates} selectedDate={selectedDate} onChange={setSelectedDate} />}
      <div style={{ background:T.surface, border:`1px solid ${T.border}` }}>
        <SectionHeader
          title="Instrument Breakdown"
          subtitle={`NSE FII Statistics — all F&O instruments · ${selectedDate??''}`}
          right={<TerminalBtn onClick={()=>downloadCSV(rows,`fii_breakdown_${selectedDate}.csv`,CSV_COLS)}>↓ Export CSV</TerminalBtn>}
        />
        {loading
          ? <div style={{ minHeight:160,display:'flex',alignItems:'center',justifyContent:'center' }}><LoadingSpinner /></div>
          : <InstrumentTable rows={rows} />
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS TAB  — mirrors screenshot 2 layout exactly
// Three stacked panels: Flow Classification | OI Snapshot | Net Volume
// ─────────────────────────────────────────────────────────────────────────────
const FLOW_TYPES = {
  FRESH_LONG:   { label:'Fresh Long',   bg:'rgba(0,200,150,0.15)',  color:T.green, border:`1px solid ${T.green}` },
  SHORT_COVER:  { label:'Short Cover',  bg:'rgba(74,158,255,0.15)', color:T.blue,  border:`1px solid ${T.blue}`  },
  FRESH_SHORT:  { label:'Fresh Short',  bg:'rgba(224,82,82,0.15)',  color:T.red,   border:`1px solid ${T.red}`   },
  LONG_UNWIND:  { label:'Long Unwind',  bg:'rgba(224,82,82,0.1)',   color:T.red,   border:`1px solid ${T.red}30` },
};

function flowType(net_oi, delta_net) {
  if (delta_net == null || net_oi == null) return null;
  if (delta_net > 0 && net_oi > 0)  return 'FRESH_LONG';
  if (delta_net > 0 && net_oi <= 0) return 'SHORT_COVER';
  if (delta_net < 0 && net_oi < 0)  return 'FRESH_SHORT';
  if (delta_net < 0 && net_oi >= 0) return 'LONG_UNWIND';
  return null;
}

function FlowBadge({ type }) {
  if (!type) return <span style={{ color:T.textGhost, fontSize:10 }}>—</span>;
  const s = FLOW_TYPES[type];
  return (
    <span style={{ padding:'2px 8px', fontSize:9, fontWeight:700, letterSpacing:'0.12em',
      textTransform:'uppercase', background:s.bg, color:s.color, border:s.border, ...mono }}>
      {s.label}
    </span>
  );
}

function AnalysisTab({ dates }) {
  const [selectedDate, setSelectedDate] = useState(dates?.[dates.length-1]??null);
  const [raw, setRaw]                   = useState([]);
  const [loading, setLoading]           = useState(false);
  const [asset, setAsset]               = useState('INDEX');
  const [segment, setSegment]           = useState('FUTURES');

  useEffect(()=>{
    if(!selectedDate)return;
    setLoading(true);
    // Fetch OI for latest + prev day for delta
    const prev = subtractDays(selectedDate, 5); // grab enough history for delta
    participant.netOI(prev, selectedDate, asset)
      .then(setRaw).catch(()=>setRaw([])).finally(()=>setLoading(false));
  },[selectedDate, asset]);

  // Build per-participant stats for selected date
  const stats = useMemo(()=>{
    const today = raw.filter(r=>r.trade_date===selectedDate);
    const prevDates = [...new Set(raw.map(r=>r.trade_date))].filter(d=>d<selectedDate).sort();
    const prevDate  = prevDates[prevDates.length-1];
    const prev      = prevDate ? raw.filter(r=>r.trade_date===prevDate) : [];

    return PARTICIPANTS.map(p=>{
      const fut  = today.find(r=>r.participant_type===p && r.option_side==='NA');
      const ce   = today.find(r=>r.participant_type===p && r.option_side==='CE');
      const pe   = today.find(r=>r.participant_type===p && r.option_side==='PE');
      const pfut = prev.find(r=>r.participant_type===p && r.option_side==='NA');

      const net_oi   = fut?.net_contracts??null;
      const prev_net = pfut?.net_contracts??null;
      const delta    = (net_oi!=null&&prev_net!=null) ? net_oi-prev_net : null;
      const type     = flowType(net_oi, delta);

      return {
        participant: p,
        fut_long:  fut?.long_contracts??null,
        fut_short: fut?.short_contracts??null,
        net_oi,
        delta_net: delta,
        flow_type: type,
        net_vol:   fut?.net_volume??null,
        ce_long:   ce?.long_contracts??null,
        ce_short:  ce?.short_contracts??null,
        ce_net:    ce?.net_contracts??null,
        pe_long:   pe?.long_contracts??null,
        pe_short:  pe?.short_contracts??null,
        pe_net:    pe?.net_contracts??null,
        total_long:  (fut?.long_contracts??0)+(ce?.long_contracts??0)+(pe?.long_contracts??0),
        total_short: (fut?.short_contracts??0)+(ce?.short_contracts??0)+(pe?.short_contracts??0),
        total_net:   (net_oi??0)+(ce?.net_contracts??0)+(pe?.net_contracts??0),
        ce_net_vol:  ce?.net_volume??null,
        pe_net_vol:  pe?.net_volume??null,
        fut_net_vol: fut?.net_volume??null,
      };
    });
  },[raw, selectedDate]);

  const thStyle = { padding:'6px 12px', ...label11, textAlign:'right', whiteSpace:'nowrap' };
  const thL     = { ...thStyle, textAlign:'left' };
  const td      = (v,col) => ({ padding:'7px 12px', fontSize:11, textAlign:'right', color:col||T.textMid, ...mono, fontWeight: col?600:400 });
  const tdL     = (col) => ({ ...td(null,col), textAlign:'left' });

  const THRESHOLD = 150000;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

      {/* Controls row */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        {dates?.length>0 && <DateSlider dates={dates} selectedDate={selectedDate} onChange={setSelectedDate} />}
      </div>

      {/* PANEL 1 — Participant Flow Analysis */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}` }}>
        <SectionHeader
          title="Participant Flow Analysis"
          subtitle="Daily flow classification — mirrors NSE IDX/STK Analysis format"
          right={
            <div style={{ display:'flex', gap:6 }}>
              {['INDEX','STOCK'].map(a=>(
                <TerminalBtn key={a} active={asset===a} color={T.amber} onClick={()=>setAsset(a)} small>{a}</TerminalBtn>
              ))}
              {['FUTURES','CALLS','PUTS'].map(s=>(
                <TerminalBtn key={s} active={segment===s} color={T.blue} onClick={()=>setSegment(s)} small>{s}</TerminalBtn>
              ))}
              <TerminalBtn onClick={()=>{}} small>↓ Export CSV</TerminalBtn>
            </div>
          }
        />
        {loading
          ? <div style={{ minHeight:140,display:'flex',alignItems:'center',justifyContent:'center' }}><LoadingSpinner /></div>
          : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', ...mono, fontSize:11 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                    <th style={thL}>Participant</th>
                    <th style={thStyle}>Long</th>
                    <th style={thStyle}>Short</th>
                    <th style={thStyle}>Net OI</th>
                    <th style={thStyle}>Δ Net</th>
                    <th style={{ ...thStyle, textAlign:'center' }}>Flow Type</th>
                    <th style={thStyle}>Net Vol</th>
                    <th style={thStyle}>Total Long</th>
                    <th style={thStyle}>Total Short</th>
                    <th style={thStyle}>Total Net</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(s=>(
                    <tr key={s.participant} style={{ borderBottom:`1px solid ${T.border}` }}>
                      <td style={{ ...tdL(P_COLOR[s.participant]), fontWeight:700 }}>{s.participant}</td>
                      <td style={td(s.fut_long)}>{fmtK(s.fut_long)}</td>
                      <td style={td(s.fut_short)}>{fmtK(s.fut_short)}</td>
                      <td style={td(null, netCol(s.net_oi))}>{sign(s.net_oi)}{fmtK(s.net_oi)}</td>
                      <td style={td(null, netCol(s.delta_net))}>{sign(s.delta_net)}{fmtK(s.delta_net)}</td>
                      <td style={{ ...td(), textAlign:'center' }}><FlowBadge type={s.flow_type} /></td>
                      <td style={td(null, netCol(s.net_vol))}>{sign(s.net_vol)}{fmtK(s.net_vol)}</td>
                      <td style={td(s.total_long)}>{fmtK(s.total_long)}</td>
                      <td style={td(s.total_short)}>{fmtK(s.total_short)}</td>
                      <td style={td(null, netCol(s.total_net))}>{sign(s.total_net)}{fmtK(s.total_net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      {/* PANEL 2 — OI Snapshot all segments */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}` }}>
        <SectionHeader title="Open Interest Snapshot — All Segments" />
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', ...mono, fontSize:11 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                <th style={thL}>Participant</th>
                <th style={{ ...thStyle, color:T.blue }} colSpan={3}>— Futures —</th>
                <th style={{ ...thStyle, color:T.green }} colSpan={3}>— Calls —</th>
                <th style={{ ...thStyle, color:T.red }} colSpan={3}>— Puts —</th>
                <th style={thStyle} colSpan={2}>Total</th>
              </tr>
              <tr style={{ borderBottom:`1px solid ${T.border}`, background:T.surfaceHi }}>
                <th style={thL} />
                <th style={{ ...thStyle, color:T.textLo }}>Long</th>
                <th style={{ ...thStyle, color:T.textLo }}>Short</th>
                <th style={{ ...thStyle, color:T.textLo }}>Net</th>
                <th style={{ ...thStyle, color:T.textLo }}>Long</th>
                <th style={{ ...thStyle, color:T.textLo }}>Short</th>
                <th style={{ ...thStyle, color:T.textLo }}>Net</th>
                <th style={{ ...thStyle, color:T.textLo }}>Long</th>
                <th style={{ ...thStyle, color:T.textLo }}>Short</th>
                <th style={{ ...thStyle, color:T.textLo }}>Net</th>
                <th style={{ ...thStyle, color:T.textLo }}>Long</th>
                <th style={{ ...thStyle, color:T.textLo }}>Short</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s=>(
                <tr key={s.participant} style={{ borderBottom:`1px solid ${T.border}` }}>
                  <td style={{ ...tdL(P_COLOR[s.participant]), fontWeight:700 }}>{s.participant}</td>
                  <td style={td(s.fut_long)}>{fmtK(s.fut_long)}</td>
                  <td style={td(s.fut_short)}>{fmtK(s.fut_short)}</td>
                  <td style={td(null,netCol(s.net_oi))}>{sign(s.net_oi)}{fmtK(s.net_oi)}</td>
                  <td style={td(s.ce_long)}>{fmtK(s.ce_long)}</td>
                  <td style={td(s.ce_short)}>{fmtK(s.ce_short)}</td>
                  <td style={td(null,netCol(s.ce_net))}>{sign(s.ce_net)}{fmtK(s.ce_net)}</td>
                  <td style={td(s.pe_long)}>{fmtK(s.pe_long)}</td>
                  <td style={td(s.pe_short)}>{fmtK(s.pe_short)}</td>
                  <td style={td(null,netCol(s.pe_net))}>{sign(s.pe_net)}{fmtK(s.pe_net)}</td>
                  <td style={td(s.total_long)}>{fmtK(s.total_long)}</td>
                  <td style={td(s.total_short)}>{fmtK(s.total_short)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* PANEL 3 — Net Volume */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}` }}>
        <SectionHeader title="Net Volume — Current Session Trading Activity" />
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', ...mono, fontSize:11 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                <th style={thL}>Participant</th>
                <th style={thStyle}>Fut Net Vol</th>
                <th style={thStyle}>CE Net Vol</th>
                <th style={thStyle}>PE Net Vol</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s=>(
                <tr key={s.participant} style={{ borderBottom:`1px solid ${T.border}` }}>
                  <td style={{ ...tdL(P_COLOR[s.participant]), fontWeight:700 }}>{s.participant}</td>
                  <td style={td(null,netCol(s.fut_net_vol))}>{sign(s.fut_net_vol)}{fmtK(s.fut_net_vol)}</td>
                  <td style={td(null,netCol(s.ce_net_vol))}>{sign(s.ce_net_vol)}{fmtK(s.ce_net_vol)}</td>
                  <td style={td(null,netCol(s.pe_net_vol))}>{sign(s.pe_net_vol)}{fmtK(s.pe_net_vol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Legend */}
        <div style={{ padding:'10px 14px', borderTop:`1px solid ${T.border}`, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {Object.entries(FLOW_TYPES).map(([k,s])=>(
            <span key={k} style={{ padding:'2px 8px', fontSize:9, fontWeight:700, letterSpacing:'0.12em',
              textTransform:'uppercase', background:s.bg, color:s.color, border:s.border, ...mono }}>
              {s.label}
            </span>
          ))}
          <span style={{ fontSize:9, color:T.textLo, ...mono, letterSpacing:'0.08em' }}>
            Threshold {(THRESHOLD/1000).toFixed(0)}K contracts
          </span>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS EXPLORER TAB
// ─────────────────────────────────────────────────────────────────────────────
const FEATURED = [
  'INDEX FUTURES','NIFTY FUTURES','BANKNIFTY FUTURES',
  'INDEX OPTIONS','NIFTY OPTIONS','BANKNIFTY OPTIONS',
  'STOCK FUTURES','STOCK OPTIONS',
];
const PALETTE = ['#4A9EFF','#00C896','#F0A500','#B39DDB','#E05252','#64B5F6','#A5D6A7','#FFCC80'];
const EXPLORER_CSV = [
  {key:'trade_date',label:'Date'},{key:'instrument',label:'Instrument'},
  {key:'buy_contracts',label:'Bought (Lots)'},{key:'buy_amount_cr',label:'Buy Value (₹ Cr)'},
  {key:'sell_contracts',label:'Sold (Lots)'},{key:'sell_amount_cr',label:'Sell Value (₹ Cr)'},
  {key:'oi_contracts',label:'OI (Lots)'},{key:'oi_amount_cr',label:'OI Value (₹ Cr)'},
  {key:'net_contracts',label:'Net Lots'},{key:'net_amount_cr',label:'Net Value (₹ Cr)'},
];

function StatsExplorerTab({ allInstruments, latestDate }) {
  const [rows, setRows]           = useState([]);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [days, setDays]           = useState(30);
  const [selInstrs, setSelInstrs] = useState(['INDEX FUTURES','NIFTY FUTURES','BANKNIFTY FUTURES']);
  const [metric, setMetric]       = useState('lots');

  const instrList = useMemo(()=>{
    const rest=(allInstruments??[]).filter(i=>!FEATURED.includes(i));
    return [...FEATURED,...rest];
  },[allInstruments]);

  const fetchData = useCallback(()=>{
    if(!selInstrs.length||!latestDate)return;
    setLoading(true);
    const start=subtractDays(latestDate,days);
    fii.stats(start,latestDate,selInstrs).then(data=>{
      setRows(data);
      const map={};
      data.forEach(r=>{
        const d=r.trade_date;
        if(!map[d])map[d]={date:d.slice(5)};
        const k=r.instrument.replace(/ /g,'_').toLowerCase();
        map[d][`${k}_lots`]=r.net_contracts;
        map[d][`${k}_value`]=r.net_amount_cr;
      });
      setChartData(Object.values(map).sort((a,b)=>a.date.localeCompare(b.date)));
    }).catch(()=>{setRows([]);setChartData([]);}).finally(()=>setLoading(false));
  },[selInstrs,days,latestDate]);

  useEffect(()=>{fetchData();},[fetchData]);

  const toggle=ins=>setSelInstrs(p=>p.includes(ins)?p.filter(i=>i!==ins):[...p,ins]);

  const thStyle={padding:'6px 12px',...label11,textAlign:'right',whiteSpace:'nowrap'};
  const thL={...thStyle,textAlign:'left'};

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}` }}>
      <SectionHeader
        title="Stats Explorer"
        subtitle="Compare multiple instruments over a custom date range"
        right={
          <div style={{ display:'flex', gap:6 }}>
            {[30,90,180,365].map(d=>(
              <TerminalBtn key={d} active={days===d} color={T.blue} onClick={()=>setDays(d)} small>
                {d===30?'1M':d===90?'3M':d===180?'6M':'1Y'}
              </TerminalBtn>
            ))}
            <div style={{ width:1,background:T.border,margin:'0 4px' }} />
            {[{label:'Net Lots',value:'lots'},{label:'Net Value',value:'value'}].map(o=>(
              <TerminalBtn key={o.value} active={metric===o.value} color={T.amber} onClick={()=>setMetric(o.value)} small>{o.label}</TerminalBtn>
            ))}
            <TerminalBtn onClick={()=>downloadCSV(rows,'fii_stats_explorer.csv',EXPLORER_CSV)} small>↓ CSV</TerminalBtn>
          </div>
        }
      />
      <div style={{ padding:16 }}>
        {/* Instrument toggles */}
        <div style={{ marginBottom:14 }}>
          <div style={{ ...label11, marginBottom:8 }}>Select Instruments</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
            {instrList.map((ins,idx)=>{
              const active=selInstrs.includes(ins);
              const color=PALETTE[FEATURED.indexOf(ins)%PALETTE.length]??T.blue;
              return (
                <button key={ins} onClick={()=>toggle(ins)} style={{
                  padding:'3px 10px', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
                  border:`1px solid ${active?color:T.border}`, background:active?`${color}15`:'transparent',
                  color:active?color:T.textLo, cursor:'pointer', borderRadius:0, ...mono,
                  display:'flex', alignItems:'center', gap:5,
                }}>
                  {active&&<span style={{ width:5,height:5,borderRadius:'50%',background:color }} />}
                  {ins}
                </button>
              );
            })}
          </div>
        </div>

        {loading
          ? <div style={{ height:220,display:'flex',alignItems:'center',justifyContent:'center' }}><LoadingSpinner /></div>
          : (
            <>
              {chartData.length>0&&(
                <div style={{ marginBottom:16 }}>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={chartData} margin={{top:4,right:4,left:0,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                        interval={Math.max(1,Math.floor(chartData.length/9))} />
                      <YAxis tick={{fontSize:9,fill:T.textLo,...mono}} tickLine={false} axisLine={false}
                        tickFormatter={metric==='value'?v=>`₹${fmtK(v)}`:fmtK} width={68} />
                      <Tooltip content={<ChartTooltip valueFormatter={metric==='value'?fmtCr:v=>`${fmtK(v)} lots`} />} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
                      <Legend wrapperStyle={{fontSize:10,color:T.textLo,paddingTop:8,...mono}} iconType="circle" iconSize={7} />
                      {selInstrs.map((ins,idx)=>{
                        const k=ins.replace(/ /g,'_').toLowerCase();
                        return <Line key={ins} type="monotone" dataKey={`${k}_${metric}`} name={ins}
                          stroke={PALETTE[idx%PALETTE.length]} dot={false} strokeWidth={1.5} connectNulls />;
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', ...mono, fontSize:11 }}>
                  <thead>
                    <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                      {['Date','Instrument','Bought (Lots)','Buy Value','Sold (Lots)','Sell Value','OI (Lots)','OI Value','Net Lots','Net Value'].map((h,i)=>(
                        <th key={h} style={{ ...i<2?thL:thStyle }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0,200).map((r,i)=>(
                      <tr key={i} style={{ borderBottom:`1px solid ${T.border}` }}>
                        <td style={{ padding:'6px 12px',color:T.textLo,fontSize:11,...mono }}>{r.trade_date}</td>
                        <td style={{ padding:'6px 12px',color:T.textHi,fontSize:11,...mono,fontWeight:600 }}>{r.instrument}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:T.textMid,fontSize:11,...mono }}>{fmt(r.buy_contracts)}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:T.textMid,fontSize:11,...mono }}>{fmtCr(r.buy_amount_cr)}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:T.textMid,fontSize:11,...mono }}>{fmt(r.sell_contracts)}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:T.textMid,fontSize:11,...mono }}>{fmtCr(r.sell_amount_cr)}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:T.textMid,fontSize:11,...mono }}>{fmt(r.oi_contracts)}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:T.textMid,fontSize:11,...mono }}>{fmtCr(r.oi_amount_cr)}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:netCol(r.net_contracts),fontSize:11,...mono,fontWeight:700 }}>{sign(r.net_contracts)}{fmt(r.net_contracts)}</td>
                        <td style={{ padding:'6px 12px',textAlign:'right',color:netCol(r.net_amount_cr),fontSize:11,...mono,fontWeight:700 }}>{sign(r.net_amount_cr)}{fmtCr(r.net_amount_cr)}</td>
                      </tr>
                    ))}
                    {rows.length>200&&(
                      <tr><td colSpan={10} style={{ padding:'10px',textAlign:'center',color:T.textLo,fontSize:10,...mono }}>
                        Showing 200 of {rows.length} rows — download CSV for full data
                      </td></tr>
                    )}
                    {!rows.length&&(
                      <tr><td colSpan={10} style={{ padding:'24px',textAlign:'center',color:T.textLo,fontSize:10,...mono,letterSpacing:'0.1em',textTransform:'uppercase' }}>
                        Select instruments above to explore
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </div>
    </div>
  );
}

// ─── Shared instrument table ──────────────────────────────────────────────────
function InstrumentTable({ rows }) {
  if (!rows?.length) return (
    <div style={{ padding:'24px 14px', textAlign:'center', color:T.textLo, fontSize:10, ...mono, letterSpacing:'0.1em', textTransform:'uppercase' }}>
      No data
    </div>
  );
  const thStyle={padding:'6px 12px',fontSize:9,fontWeight:700,letterSpacing:'0.14em',textTransform:'uppercase',color:T.textLo,whiteSpace:'nowrap'};
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', ...mono, fontSize:11 }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {['Instrument','Bought (Lots)','Buy Value','Sold (Lots)','Sell Value','OI (Lots)','OI Value','Net Lots','Net Value'].map((h,i)=>(
              <th key={h} style={{ ...thStyle, textAlign:i===0?'left':'right' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:'7px 12px',color:T.textHi,fontWeight:600,whiteSpace:'nowrap' }}>{r.instrument}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:T.textMid }}>{fmt(r.buy_contracts)}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:T.textMid }}>{fmtCr(r.buy_amount_cr)}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:T.textMid }}>{fmt(r.sell_contracts)}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:T.textMid }}>{fmtCr(r.sell_amount_cr)}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:T.textMid }}>{fmt(r.oi_contracts)}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:T.textMid }}>{fmtCr(r.oi_amount_cr)}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:netCol(r.net_contracts),fontWeight:700 }}>{sign(r.net_contracts)}{fmt(r.net_contracts)}</td>
              <td style={{ padding:'7px 12px',textAlign:'right',color:netCol(r.net_amount_cr),fontWeight:700 }}>{sign(r.net_amount_cr)}{fmtCr(r.net_amount_cr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key:'overview',  label:'Overview'        },
  { key:'netoi',     label:'Net OI'          },
  { key:'netvol',    label:'Net Volume'      },
  { key:'options',   label:'Options'         },
  { key:'daily',     label:'Daily Table'     },
  { key:'analysis',  label:'Analysis'        },
  { key:'explorer',  label:'Stats Explorer'  },
];

export default function FII() {
  const [dates,       setDates]       = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState('overview');

  // Snapshot stats for header strip
  const [headerStats, setHeaderStats] = useState(null);

  useEffect(()=>{
    Promise.all([fii.dates(), fii.instruments()])
      .then(([d,ins])=>{ setDates(d); setInstruments(ins); })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[]);

  const latestDate = dates?.[dates.length-1]??null;

  // Fetch header strip stats (FII/DII futures net for latest date)
  useEffect(()=>{
    if(!latestDate)return;
    fii.stats(latestDate,latestDate).then(rows=>{
      const get=(type,instr)=>rows.filter(r=>instr.includes(r.instrument)).reduce((a,r)=>a+(r.net_contracts??0),0);
      setHeaderStats({
        date:       latestDate,
        asset:      'INDEX',
        fiiFutNet:  get('FII',['INDEX FUTURES','NIFTY FUTURES','BANKNIFTY FUTURES']),
        diiFutNet:  get('DII',['INDEX FUTURES','NIFTY FUTURES','BANKNIFTY FUTURES']),
      });
    }).catch(()=>{});
  },[latestDate]);

  if (loading) return (
    <div style={{ minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:T.bg }}>
      <LoadingSpinner />
    </div>
  );

  return (
    <div style={{ background:T.bg, minHeight:'100vh', display:'flex', flexDirection:'column', ...mono }}>

      {/* ── Page title bar ── */}
      <PageHeader
        title="FII Activity"
        subtitle="FII › DII › Client › Pro — net positioning across futures and options"
        liveLabel="NSE Live"
      />

      {/* ── Metric strip ── */}
      {headerStats && (
        <div style={{ display:'flex', borderBottom:`1px solid ${T.border}`, background:T.surface, flexShrink:0 }}>
          {[
            { label:'Snapshot Date', value:headerStats.date, color:T.textHi },
            { label:'Asset Class',   value:headerStats.asset, color:T.amber },
            { label:'FII Fut Net',   value:`${sign(headerStats.fiiFutNet)}${fmtK(headerStats.fiiFutNet)}`, color:netCol(headerStats.fiiFutNet) },
            { label:'DII Fut Net',   value:`${sign(headerStats.diiFutNet)}${fmtK(headerStats.diiFutNet)}`, color:netCol(headerStats.diiFutNet) },
          ].map((item,i,arr)=>(
            <div key={item.label} style={{ padding:'10px 20px', borderRight: i<arr.length-1?`1px solid ${T.border}`:'none', minWidth:180 }}>
              <div style={label11}>{item.label}</div>
              <div style={{ ...val14, color:item.color, marginTop:4 }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab bar ── */}
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {/* ── Content ── */}
      <main style={{ flex:1, padding:'16px 20px', overflowX:'hidden', display:'flex', flexDirection:'column', gap:12 }}>
        {tab==='overview'  && <OverviewTab       latestDate={latestDate} />}
        {tab==='netoi'     && <NetOITab          latestDate={latestDate} />}
        {tab==='netvol'    && <NetVolumeTab      latestDate={latestDate} />}
        {tab==='options'   && <OptionsTab        latestDate={latestDate} />}
        {tab==='daily'     && <DailyTableTab     dates={dates} />}
        {tab==='analysis'  && <AnalysisTab       dates={dates} />}
        {tab==='explorer'  && <StatsExplorerTab  allInstruments={instruments} latestDate={latestDate} />}
      </main>
    </div>
  );
}
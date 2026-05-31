import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import DateSlider     from "../components/shared/DateSlider";
import { fii, participant } from "../api/client";

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt    = (n, dec = 0) => n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: dec });
const fmtK   = (v) => { if (v == null) return "—"; const a = Math.abs(v); if (a >= 1e5) return `${(v / 1e5).toFixed(2)}L`; if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`; return fmt(v); };
const fmtCr  = (v) => v == null ? "—" : `₹${fmt(v, 1)} Cr`;
const netCol = (v) => v == null ? "rgba(255,255,255,0.25)" : v >= 0 ? "#26a69a" : "#ef5350";
const pre    = (v) => v == null ? "" : v >= 0 ? "+" : "";

// ─── Date helpers ─────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
const subtractDays = (dateStr, n) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// ─── CSV ──────────────────────────────────────────────────────────────────────
function downloadCSV(rows, filename, cols) {
  if (!rows?.length) return;
  const blob = new Blob(
    [cols.map(c => c.label).join(",") + "\n" +
     rows.map(r => cols.map(c => r[c.key] ?? "").join(",")).join("\n")],
    { type: "text/csv" }
  );
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  a.click();
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-4 py-2 rounded-xl border text-sm transition whitespace-nowrap
            ${active === t.key
              ? "border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]"
              : "border-white/10 bg-[#151922] text-white/65 hover:bg-white/5"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SectionCard({ title, subtitle, action, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-white/8">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-white/45 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0 flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function CSVButton({ onClick }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10
                 bg-[#151922] text-xs text-white/65 hover:bg-white/5 hover:text-white/90 transition-colors">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      CSV
    </button>
  );
}

function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="flex gap-1">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
            ${value === o.value
              ? "border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]"
              : "border-white/10 bg-[#151922] text-white/65 hover:bg-white/5"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RangePicker({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[{ l: "1M", d: 30 }, { l: "3M", d: 90 }, { l: "6M", d: 180 }, { l: "1Y", d: 365 }].map(o => (
        <button key={o.d} onClick={() => onChange(o.d)}
          className={`px-2.5 py-1 rounded-md border text-xs transition-colors
            ${value === o.d
              ? "border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]"
              : "border-white/10 bg-[#151922] text-white/60 hover:bg-white/5"}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, valueFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#151922] border border-white/10 rounded-xl px-4 py-3 shadow-2xl text-xs min-w-[160px]">
      <p className="text-white/50 mb-2 font-medium">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-white/55">{p.name}</span>
          </div>
          <span className="font-semibold tabular-nums" style={{ color: p.color }}>
            {valueFmt ? valueFmt(p.value) : fmtK(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — OVERVIEW
// Uses fii.stats for latest date — aggregate into 4 groups
// ─────────────────────────────────────────────────────────────────────────────
const GROUPS = [
  { label: "Index Futures", accent: "#00B0F0", instruments: ["INDEX FUTURES", "NIFTY FUTURES", "BANKNIFTY FUTURES"] },
  { label: "Index Options", accent: "#B39DDB", instruments: ["INDEX OPTIONS", "NIFTY OPTIONS", "BANKNIFTY OPTIONS"] },
  { label: "Stock Futures", accent: "#FFA726", instruments: ["STOCK FUTURES"] },
  { label: "Stock Options", accent: "#26a69a", instruments: ["STOCK OPTIONS"] },
];

function OverviewTab({ latestDate }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!latestDate) return;
    setLoading(true);
    fii.stats(latestDate, latestDate)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [latestDate]);

  if (loading) return <div className="h-48 flex items-center justify-center"><LoadingSpinner /></div>;

  const aggregate = (instruments) =>
    rows
      .filter(r => instruments.includes(r.instrument))
      .reduce((acc, r) => ({
        net_contracts:  (acc.net_contracts  ?? 0) + (r.net_contracts  ?? 0),
        net_amount_cr:  (acc.net_amount_cr  ?? 0) + (r.net_amount_cr  ?? 0),
        buy_contracts:  (acc.buy_contracts  ?? 0) + (r.buy_contracts  ?? 0),
        sell_contracts: (acc.sell_contracts ?? 0) + (r.sell_contracts ?? 0),
        oi_contracts:   (acc.oi_contracts   ?? 0) + (r.oi_contracts   ?? 0),
        oi_amount_cr:   (acc.oi_amount_cr   ?? 0) + (r.oi_amount_cr   ?? 0),
      }), {});

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {GROUPS.map(({ label, accent, instruments }) => {
          const d = aggregate(instruments);
          const hasData = d.net_contracts != null && rows.length > 0;
          return (
            <div key={label} className="card p-4 border border-white/8 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: accent }} />
                <span className="text-xs text-white/50 font-medium">{label}</span>
              </div>
              {!hasData ? (
                <p className="text-sm text-white/25">No data</p>
              ) : (
                <>
                  {/* Net Lots — the primary number */}
                  <p className="text-2xl font-bold tabular-nums leading-none"
                     style={{ color: netCol(d.net_contracts) }}>
                    {pre(d.net_contracts)}{fmtK(d.net_contracts)}
                  </p>
                  <p className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">Net Lots</p>

                  {/* Net Value */}
                  <p className="text-sm font-semibold mt-3 tabular-nums"
                     style={{ color: netCol(d.net_amount_cr) }}>
                    {pre(d.net_amount_cr)}{fmtCr(d.net_amount_cr)}
                  </p>
                  <p className="text-[10px] text-white/30 mt-0.5 uppercase tracking-wider">Net Value</p>

                  {/* B / S / OI row */}
                  <div className="mt-3 pt-3 border-t border-white/8 grid grid-cols-3 gap-1 text-xs">
                    <div>
                      <p className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5">Bought</p>
                      <p className="text-white/60 tabular-nums">{fmtK(d.buy_contracts)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5">Sold</p>
                      <p className="text-white/60 tabular-nums">{fmtK(d.sell_contracts)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5">OI</p>
                      <p className="text-white/60 tabular-nums">{fmtK(d.oi_contracts)}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* All instruments table for latest date */}
      <SectionCard
        title="All Instruments"
        subtitle={`Full FII activity snapshot · ${latestDate}`}
        action={
          <CSVButton onClick={() => downloadCSV(rows, `fii_overview_${latestDate}.csv`, [
            { key: "instrument", label: "Instrument" },
            { key: "buy_contracts", label: "Bought (Lots)" },
            { key: "buy_amount_cr", label: "Buy Value (₹ Cr)" },
            { key: "sell_contracts", label: "Sold (Lots)" },
            { key: "sell_amount_cr", label: "Sell Value (₹ Cr)" },
            { key: "oi_contracts", label: "Open Interest (Lots)" },
            { key: "oi_amount_cr", label: "OI Value (₹ Cr)" },
            { key: "net_contracts", label: "Net Lots" },
            { key: "net_amount_cr", label: "Net Value (₹ Cr)" },
          ])} />
        }
      >
        <InstrumentTable rows={rows} />
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — INDEX FLOW
// ─────────────────────────────────────────────────────────────────────────────
function IndexFlowTab({ latestDate }) {
  const [raw,      setRaw]      = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [days,     setDays]     = useState(90);
  const [metric,   setMetric]   = useState("lots");   // lots | value
  const [instr,    setInstr]    = useState("INDEX FUTURES");

  useEffect(() => {
    if (!latestDate) return;
    setLoading(true);
    const start = subtractDays(latestDate, days);
    fii.indexFlow(start, latestDate)
      .then(setRaw)
      .catch(() => setRaw([]))
      .finally(() => setLoading(false));
  }, [latestDate, days]);

  const instruments = ["INDEX FUTURES", "NIFTY FUTURES", "BANKNIFTY FUTURES"];

  const chartData = useMemo(() => {
    const filtered = raw.filter(r => r.instrument === instr);
    return filtered.map(r => ({
      date:  r.trade_date.slice(5),
      value: metric === "lots" ? r.net_contracts : r.net_amount_cr,
    }));
  }, [raw, instr, metric]);

  return (
    <SectionCard
      title="Index Flow"
      subtitle="FII net position in index futures — a leading signal for Nifty direction"
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <RangePicker value={days} onChange={setDays} />
          <ToggleGroup
            options={[{ label: "Net Lots", value: "lots" }, { label: "Net Value", value: "value" }]}
            value={metric} onChange={setMetric}
          />
        </div>
      }
    >
      {/* Instrument tabs */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {instruments.map(ins => (
          <button key={ins} onClick={() => setInstr(ins)}
            className={`px-3 py-1.5 rounded-lg border text-xs transition-colors
              ${instr === ins
                ? "border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]"
                : "border-white/10 bg-[#151922] text-white/55 hover:bg-white/5"}`}>
            {ins}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-72 flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <>
          {/* Summary stats above chart */}
          {chartData.length > 0 && (() => {
            const vals  = chartData.map(d => d.value).filter(v => v != null);
            const last  = vals[vals.length - 1];
            const sum20 = vals.slice(-20).reduce((a, b) => a + b, 0);
            const positives = vals.filter(v => v > 0).length;
            return (
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Latest",        val: metric === "lots" ? `${pre(last)}${fmtK(last)} lots` : `${pre(last)}${fmtCr(last)}`, color: netCol(last) },
                  { label: "20-day sum",    val: metric === "lots" ? `${pre(sum20)}${fmtK(sum20)} lots` : `${pre(sum20)}${fmtCr(sum20)}`, color: netCol(sum20) },
                  { label: "Bull days",     val: `${positives} / ${vals.length}`, color: "#00B0F0" },
                ].map(s => (
                  <div key={s.label} className="bg-white/[0.03] rounded-xl p-3">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{s.label}</p>
                    <p className="text-sm font-bold tabular-nums" style={{ color: s.color }}>{s.val}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
                tickLine={false} axisLine={false}
                interval={Math.max(1, Math.floor(chartData.length / 9))} />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
                tickLine={false} axisLine={false}
                tickFormatter={metric === "value" ? v => `₹${fmtK(v)}` : fmtK}
                width={68} />
              <Tooltip content={
                <ChartTooltip valueFmt={metric === "value" ? fmtCr : v => `${fmtK(v)} lots`} />
              } />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
              <Bar dataKey="value" name={metric === "lots" ? "Net Lots" : "Net Value"}
                radius={[2, 2, 0, 0]}
                fill="#00B0F0"
                /* colour each bar by sign */
                label={false}
              >
                {chartData.map((d, i) => (
                  <rect key={i} fill={d.value >= 0 ? "#26a69a" : "#ef5350"} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — DAILY BREAKDOWN
// ─────────────────────────────────────────────────────────────────────────────
function DailyBreakdownTab({ dates }) {
  const [selectedDate, setSelectedDate] = useState(dates?.[dates.length - 1] ?? null);
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(false);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    fii.summary(selectedDate)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const CSV_COLS = [
    { key: "instrument",    label: "Instrument"         },
    { key: "buy_contracts", label: "Bought (Lots)"      },
    { key: "buy_amount_cr", label: "Buy Value (₹ Cr)"   },
    { key: "sell_contracts",label: "Sold (Lots)"        },
    { key: "sell_amount_cr",label: "Sell Value (₹ Cr)"  },
    { key: "oi_contracts",  label: "Open Interest (Lots)"},
    { key: "oi_amount_cr",  label: "OI Value (₹ Cr)"    },
    { key: "net_contracts", label: "Net Lots"            },
    { key: "net_amount_cr", label: "Net Value (₹ Cr)"   },
  ];

  return (
    <div className="space-y-4">
      {dates?.length > 0 && (
        <DateSlider dates={dates} selectedDate={selectedDate} onChange={setSelectedDate} />
      )}

      <SectionCard
        title="Instrument Breakdown"
        subtitle={`NSE FII Statistics — all F&O instruments · ${selectedDate ?? ""}`}
        action={<CSVButton onClick={() => downloadCSV(rows, `fii_breakdown_${selectedDate}.csv`, CSV_COLS)} />}
      >
        {loading ? (
          <div className="h-40 flex items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <InstrumentTable rows={rows} />
        )}
      </SectionCard>
    </div>
  );
}

// ─── Shared instrument table ──────────────────────────────────────────────────
function InstrumentTable({ rows }) {
  if (!rows?.length) return (
    <p className="text-sm text-white/25 py-6 text-center">No data</p>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-white/8">
            {["Instrument", "Bought (Lots)", "Buy Value", "Sold (Lots)", "Sell Value",
              "OI (Lots)", "OI Value", "Net Lots", "Net Value"].map((h, i) => (
              <th key={h} className={`py-2.5 px-3 text-white/30 font-medium whitespace-nowrap
                ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
              <td className="py-2 px-3 text-white/80 font-medium whitespace-nowrap">{r.instrument}</td>
              <td className="py-2 px-3 text-right text-white/60 tabular-nums">{fmt(r.buy_contracts)}</td>
              <td className="py-2 px-3 text-right text-white/50 tabular-nums">{fmtCr(r.buy_amount_cr)}</td>
              <td className="py-2 px-3 text-right text-white/60 tabular-nums">{fmt(r.sell_contracts)}</td>
              <td className="py-2 px-3 text-right text-white/50 tabular-nums">{fmtCr(r.sell_amount_cr)}</td>
              <td className="py-2 px-3 text-right text-white/60 tabular-nums">{fmt(r.oi_contracts)}</td>
              <td className="py-2 px-3 text-right text-white/50 tabular-nums">{fmtCr(r.oi_amount_cr)}</td>
              <td className="py-2 px-3 text-right tabular-nums font-semibold"
                  style={{ color: netCol(r.net_contracts) }}>
                {pre(r.net_contracts)}{fmt(r.net_contracts)}
              </td>
              <td className="py-2 px-3 text-right tabular-nums font-semibold"
                  style={{ color: netCol(r.net_amount_cr) }}>
                {pre(r.net_amount_cr)}{fmtCr(r.net_amount_cr)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — OI POSITIONING
// participant.netOI → filter to FII → CE / PE / Futures lines
// ─────────────────────────────────────────────────────────────────────────────
const OI_SERIES = [
  { key: "futures", label: "Futures",    color: "#00B0F0", side: "NA" },
  { key: "ce",      label: "Call (CE)",  color: "#26a69a", side: "CE" },
  { key: "pe",      label: "Put (PE)",   color: "#ef5350", side: "PE" },
];

function OIPositioningTab({ latestDate }) {
  const [raw,       setRaw]       = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [days,      setDays]      = useState(90);
  const [asset,     setAsset]     = useState("INDEX");
  const [visible,   setVisible]   = useState(["futures", "ce", "pe"]);

  useEffect(() => {
    if (!latestDate) return;
    setLoading(true);
    const start = subtractDays(latestDate, days);
    participant.netOI(start, latestDate, asset)
      .then(setRaw)
      .catch(() => setRaw([]))
      .finally(() => setLoading(false));
  }, [latestDate, days, asset]);

  // Pivot: date → { futures, ce, pe }  — FII only
  const chartData = useMemo(() => {
    const fiiRows = raw.filter(r => r.participant_type === "FII");
    const map = {};
    fiiRows.forEach(r => {
      const d = r.trade_date;
      if (!map[d]) map[d] = { date: d.slice(5) };
      const series = OI_SERIES.find(s => s.side === r.option_side);
      if (series) map[d][series.key] = r.net_contracts;
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  const toggleSeries = key =>
    setVisible(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  return (
    <SectionCard
      title="FII Open Interest Positioning"
      subtitle="Net long − short lots held by FIIs across futures and options"
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <RangePicker value={days} onChange={setDays} />
          <ToggleGroup
            options={[{ label: "Index", value: "INDEX" }, { label: "Stock", value: "STOCK" }]}
            value={asset} onChange={setAsset}
          />
        </div>
      }
    >
      {/* Series toggles */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {OI_SERIES.map(s => (
          <button key={s.key} onClick={() => toggleSeries(s.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors
              ${visible.includes(s.key)
                ? "border-white/15 bg-white/5 text-white/80"
                : "border-white/8 bg-transparent text-white/30 hover:text-white/50"}`}>
            <span className="w-2 h-2 rounded-full transition-opacity"
              style={{ background: s.color, opacity: visible.includes(s.key) ? 1 : 0.25 }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Explanation */}
      <p className="text-xs text-white/30 mb-4">
        Positive = FII holds more longs than shorts (bullish). Negative = more shorts (bearish).
        Futures positioning is a direct market view; PE net long = hedging or bearish bet.
      </p>

      {loading ? (
        <div className="h-72 flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
              tickLine={false} axisLine={false}
              interval={Math.max(1, Math.floor(chartData.length / 9))} />
            <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
              tickLine={false} axisLine={false} tickFormatter={fmtK} width={64} />
            <Tooltip content={<ChartTooltip valueFmt={v => `${fmtK(v)} lots`} />} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
            <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingTop: 8 }}
              iconType="circle" iconSize={8} />
            {OI_SERIES.map(s => visible.includes(s.key) && (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={s.color} dot={false} strokeWidth={1.5} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5 — STATS EXPLORER
// ─────────────────────────────────────────────────────────────────────────────
const FEATURED = [
  "INDEX FUTURES", "NIFTY FUTURES", "BANKNIFTY FUTURES",
  "INDEX OPTIONS",  "NIFTY OPTIONS",  "BANKNIFTY OPTIONS",
  "STOCK FUTURES",  "STOCK OPTIONS",
];
const PALETTE = ["#00B0F0","#26a69a","#FFA726","#B39DDB","#ef5350","#64B5F6","#A5D6A7","#FFCC80"];

const EXPLORER_CSV = [
  { key: "trade_date",    label: "Date"              },
  { key: "instrument",    label: "Instrument"        },
  { key: "buy_contracts", label: "Bought (Lots)"     },
  { key: "buy_amount_cr", label: "Buy Value (₹ Cr)"  },
  { key: "sell_contracts",label: "Sold (Lots)"       },
  { key: "sell_amount_cr",label: "Sell Value (₹ Cr)" },
  { key: "oi_contracts",  label: "OI (Lots)"         },
  { key: "oi_amount_cr",  label: "OI Value (₹ Cr)"   },
  { key: "net_contracts", label: "Net Lots"          },
  { key: "net_amount_cr", label: "Net Value (₹ Cr)"  },
];

function StatsExplorerTab({ allInstruments, latestDate }) {
  const [rows,      setRows]      = useState([]);
  const [chartData, setChartData] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [days,      setDays]      = useState(30);
  const [selInstrs, setSelInstrs] = useState(["INDEX FUTURES", "NIFTY FUTURES", "BANKNIFTY FUTURES"]);
  const [metric,    setMetric]    = useState("lots");

  const instrList = useMemo(() => {
    const rest = (allInstruments ?? []).filter(i => !FEATURED.includes(i));
    return [...FEATURED, ...rest];
  }, [allInstruments]);

  const fetchData = useCallback(() => {
    if (!selInstrs.length || !latestDate) return;
    setLoading(true);
    const start = subtractDays(latestDate, days);
    fii.stats(start, latestDate, selInstrs).then(data => {
      setRows(data);
      const map = {};
      data.forEach(r => {
        const d = r.trade_date;
        if (!map[d]) map[d] = { date: d.slice(5) };
        const k = r.instrument.replace(/ /g, "_").toLowerCase();
        map[d][`${k}_lots`]  = r.net_contracts;
        map[d][`${k}_value`] = r.net_amount_cr;
      });
      setChartData(Object.values(map).sort((a, b) => a.date.localeCompare(b.date)));
    }).catch(() => { setRows([]); setChartData([]); }).finally(() => setLoading(false));
  }, [selInstrs, days, latestDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleInstr = ins =>
    setSelInstrs(prev => prev.includes(ins) ? prev.filter(i => i !== ins) : [...prev, ins]);

  return (
    <SectionCard
      title="Stats Explorer"
      subtitle="Compare multiple instruments over a custom date range"
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <RangePicker value={days} onChange={setDays} />
          <ToggleGroup
            options={[{ label: "Net Lots", value: "lots" }, { label: "Net Value", value: "value" }]}
            value={metric} onChange={setMetric}
          />
          <CSVButton onClick={() => downloadCSV(rows, "fii_stats_explorer.csv", EXPLORER_CSV)} />
        </div>
      }
    >
      {/* Instrument selector */}
      <div className="mb-5">
        <p className="text-xs text-white/30 mb-2 uppercase tracking-wider">Select Instruments</p>
        <div className="flex flex-wrap gap-1.5">
          {instrList.map((ins, idx) => {
            const active = selInstrs.includes(ins);
            const color  = PALETTE[FEATURED.indexOf(ins) % PALETTE.length] ?? "#00B0F0";
            return (
              <button key={ins} onClick={() => toggleInstr(ins)}
                className={`px-2.5 py-1 rounded-lg border text-xs transition-colors
                  ${active
                    ? "border-white/15 bg-white/5 text-white/80"
                    : "border-white/8 bg-transparent text-white/30 hover:text-white/50"}`}>
                {active && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                    style={{ background: color }} />
                )}
                {ins}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <>
          {/* Chart */}
          {chartData.length > 0 && (
            <div className="mb-6">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
                    tickLine={false} axisLine={false}
                    interval={Math.max(1, Math.floor(chartData.length / 9))} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
                    tickLine={false} axisLine={false}
                    tickFormatter={metric === "value" ? v => `₹${fmtK(v)}` : fmtK}
                    width={68} />
                  <Tooltip content={
                    <ChartTooltip valueFmt={metric === "value" ? fmtCr : v => `${fmtK(v)} lots`} />
                  } />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
                  <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingTop: 8 }}
                    iconType="circle" iconSize={8} />
                  {selInstrs.map((ins, idx) => {
                    const k = ins.replace(/ /g, "_").toLowerCase();
                    return (
                      <Line key={ins} type="monotone"
                        dataKey={`${k}_${metric}`} name={ins}
                        stroke={PALETTE[idx % PALETTE.length]}
                        dot={false} strokeWidth={1.5} connectNulls />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/8">
                  {["Date", "Instrument", "Bought (Lots)", "Buy Value", "Sold (Lots)",
                    "Sell Value", "OI (Lots)", "OI Value", "Net Lots", "Net Value"].map((h, i) => (
                    <th key={h} className={`py-2.5 px-3 text-white/30 font-medium whitespace-nowrap
                      ${i < 2 ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 px-3 text-white/40 whitespace-nowrap">{r.trade_date}</td>
                    <td className="py-2 px-3 text-white/80 font-medium whitespace-nowrap">{r.instrument}</td>
                    <td className="py-2 px-3 text-right text-white/60 tabular-nums">{fmt(r.buy_contracts)}</td>
                    <td className="py-2 px-3 text-right text-white/50 tabular-nums">{fmtCr(r.buy_amount_cr)}</td>
                    <td className="py-2 px-3 text-right text-white/60 tabular-nums">{fmt(r.sell_contracts)}</td>
                    <td className="py-2 px-3 text-right text-white/50 tabular-nums">{fmtCr(r.sell_amount_cr)}</td>
                    <td className="py-2 px-3 text-right text-white/60 tabular-nums">{fmt(r.oi_contracts)}</td>
                    <td className="py-2 px-3 text-right text-white/50 tabular-nums">{fmtCr(r.oi_amount_cr)}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold"
                        style={{ color: netCol(r.net_contracts) }}>
                      {pre(r.net_contracts)}{fmt(r.net_contracts)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold"
                        style={{ color: netCol(r.net_amount_cr) }}>
                      {pre(r.net_amount_cr)}{fmtCr(r.net_amount_cr)}
                    </td>
                  </tr>
                ))}
                {rows.length > 200 && (
                  <tr>
                    <td colSpan={10} className="py-3 text-center text-white/25">
                      Showing 200 of {rows.length} rows — download CSV for full data
                    </td>
                  </tr>
                )}
                {!rows.length && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-white/25">
                      Select instruments above to explore
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: "overview",   label: "Overview"         },
  { key: "indexflow",  label: "Index Flow"       },
  { key: "daily",      label: "Daily Breakdown"  },
  { key: "oi",         label: "OI Positioning"   },
  { key: "explorer",   label: "Stats Explorer"   },
];

export default function FII() {
  const [dates,       setDates]       = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState("overview");

  useEffect(() => {
    Promise.all([fii.dates(), fii.instruments()])
      .then(([d, ins]) => { setDates(d); setInstruments(ins); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const latestDate = dates?.[dates.length - 1] ?? null;

  if (loading) return (
    <div className="h-[calc(100vh-64px)] flex items-center justify-center"
         style={{ background: "#0d1117" }}>
      <LoadingSpinner />
    </div>
  );

  return (
    <div className="p-6" style={{ background: "#0d1117", minHeight: "100vh" }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#00B0F0]" />
          <h1 className="text-2xl font-bold text-white">FII Activity</h1>
          <span className="px-2 py-0.5 rounded-md bg-[#00B0F0]/10 border border-[#00B0F0]/20
                           text-[#00B0F0] text-xs font-medium">NSE</span>
        </div>
        <p className="text-sm text-white/45 ml-5">
          Foreign Institutional Investor positions across F&amp;O instruments
          {latestDate && <span className="ml-2 text-white/25">· Latest data: {latestDate}</span>}
        </p>
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === "overview"  && <OverviewTab        latestDate={latestDate} />}
      {tab === "indexflow" && <IndexFlowTab        latestDate={latestDate} />}
      {tab === "daily"     && <DailyBreakdownTab   dates={dates} />}
      {tab === "oi"        && <OIPositioningTab    latestDate={latestDate} />}
      {tab === "explorer"  && <StatsExplorerTab    allInstruments={instruments} latestDate={latestDate} />}
    </div>
  );
}
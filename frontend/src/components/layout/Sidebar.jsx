// frontend/src/components/layout/Sidebar.jsx

import { useEffect, useMemo, useRef, useState } from 'react';

export default function Sidebar({
  assetType = 'options',
  mode = 'analytics',
  screenerTab = 'screener',
  tickerList = [],
  selectedTicker,
  onTickerChange,

  expiries = [],
  selectedExpiries = [],
  onExpiriesChange,

  selectedMetric,
  onMetricChange,

  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,

  // Set of valid YYYY-MM-DD strings from getMarketDates — used to disable invalid dates
  validDates = [],
}) {
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const containerRef = useRef(null);
  const selectedItemRef = useRef(null);

  const isFutures = ['stock_futures', 'index_futures'].includes(assetType);

  const isFuturesScreener = isFutures && mode === 'screener';

  const filteredTickers = useMemo(() => {
    if (!search.trim()) return tickerList;
    return tickerList.filter((ticker) =>
      ticker.toLowerCase().includes(search.toLowerCase())
    );
  }, [search, tickerList]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleExpiry = (expiry) => {
    const exists = selectedExpiries.includes(expiry);
    if (exists) {
      onExpiriesChange(selectedExpiries.filter((item) => item !== expiry));
    } else {
      onExpiriesChange([...selectedExpiries, expiry]);
    }
  };

  const isOICharts       = selectedMetric === 'oi_charts';
  const isTimeSeries     = selectedMetric === 'ts';
  const isDailySnapshot  = selectedMetric === 'daily_expiry_snapshot';
  const isTickerAnalysis = selectedMetric === 'ticker_analysis';

  const dateRangeDisabled = isTimeSeries || isTickerAnalysis;
  const disableEndDate    = isTimeSeries || isDailySnapshot;

  // Ticker is disabled in screener mode UNLESS we are on the Charts sub-tab
  const disableTicker =
    isDailySnapshot ||
    (isFuturesScreener && screenerTab !== 'charts');

  const metricOptions = [
    { label: 'Open Interest',         value: 'oi'                    },
    { label: 'OI Change',             value: 'oi_chng'               },
    { label: 'Volume',                value: 'vol'                   },
    { label: 'Time Series',           value: 'ts'                    },
    { label: 'Daily Expiry Snapshot', value: 'daily_expiry_snapshot' },
    { label: 'Ticker Analysis',       value: 'ticker_analysis'       },
    { label: 'OI Charts',             value: 'oi_charts'             },
  ];

  // Clamp a date string to the nearest valid date in validDates
  const clampToValidDate = (dateStr) => {
    if (!validDates.length || !dateStr) return dateStr;
    if (validDates.includes(dateStr)) return dateStr;
    // Find closest valid date
    const target = new Date(dateStr).getTime();
    let closest = validDates[0];
    let minDiff = Math.abs(new Date(validDates[0]).getTime() - target);
    for (const d of validDates) {
      const diff = Math.abs(new Date(d).getTime() - target);
      if (diff < minDiff) { minDiff = diff; closest = d; }
    }
    return closest;
  };

  const handleStartDateChange = (val) => {
    const clamped = clampToValidDate(val);
    onStartDateChange(clamped);
  };

  const handleEndDateChange = (val) => {
    const clamped = clampToValidDate(val);
    onEndDateChange(clamped);
  };

  const validDateSet = useMemo(() => new Set(validDates), [validDates]);

  // min/max for date inputs derived from validDates
  const minValidDate = validDates.length ? validDates[0] : undefined;
  const maxValidDate = validDates.length ? validDates[validDates.length - 1] : undefined;

  return (
    <aside className="w-[280px] min-w-[280px] self-stretch overflow-y-auto border-r border-white/10 bg-[#11151d] px-4 py-5">
      <div className="space-y-6">

        {/* ── TICKER — hidden for futures entirely ───────────────── */}
        {!isFutures && (
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-white">Ticker</h2>
              <p className="text-xs text-white/45 mt-1">
                {isDailySnapshot
                  ? 'Disabled in market-wide snapshot mode'
                  : 'Search NSE derivative symbols'}
              </p>
            </div>

            <div className="relative" ref={containerRef}>
              <input
                type="text"
                value={search}
                disabled={disableTicker}
                placeholder={selectedTicker || 'Search ticker...'}
                onFocus={() => {
                  if (!disableTicker) {
                    setShowDropdown(true);
                    setTimeout(() => {
                      selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
                    }, 0);
                  }
                }}
                onChange={(event) => {
                  if (disableTicker) return;
                  setSearch(event.target.value);
                  setShowDropdown(true);
                }}
                className={`w-full ${disableTicker ? 'opacity-40 cursor-not-allowed' : ''}`}
              />

              {showDropdown && (
                <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-[#151922] shadow-2xl">
                  <div className="max-h-[280px] overflow-y-auto">
                    {filteredTickers.length > 0 ? (
                      filteredTickers.map((ticker) => (
                        <button
                          key={ticker}
                          ref={ticker === selectedTicker ? selectedItemRef : null}
                          onClick={() => {
                            onTickerChange(ticker);
                            setSearch('');
                            setShowDropdown(false);
                          }}
                          className={`w-full px-4 py-3 text-left text-sm transition border-b border-white/5 hover:bg-white/5 ${
                            ticker === selectedTicker
                              ? 'bg-[#00B0F0]/10 text-[#00B0F0]'
                              : 'text-white/85'
                          }`}
                        >
                          {ticker}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-4 text-sm text-white/50">No matching tickers</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── EXPIRIES ───────────────────────────────────────────── */}
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-white">Expiries</h2>
            <p className="text-xs text-white/45 mt-1">
              {isFuturesScreener && screenerTab === 'charts'
                ? 'Select cycles to compare (max 5)'
                : 'Select expiries to display'}
            </p>
          </div>

          <div className="space-y-3">
            {isTickerAnalysis || isDailySnapshot ? (
              <div className="space-y-2">
                <select
                  value={selectedExpiries[0] || ''}
                  onChange={(e) => { if (e.target.value) onExpiriesChange([e.target.value]); }}
                  className="w-full"
                >
                  <option value="">Select expiry...</option>
                  {expiries.map((expiry) => (
                    <option key={expiry} value={expiry}>{expiry}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <select
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value || selectedExpiries.includes(value)) return;
                    if (isDailySnapshot) {
                      onExpiriesChange([value]);
                    } else {
                      onExpiriesChange([...selectedExpiries, value]);
                    }
                  }}
                  value=""
                  className="w-full"
                >
                  <option value="">Add Expiry...</option>
                  {expiries.map((expiry) => (
                    <option key={expiry} value={expiry}>{expiry}</option>
                  ))}
                </select>

                {!isDailySnapshot && (
                  <div className="flex flex-wrap gap-2">
                    {selectedExpiries.map((expiry) => (
                      <div
                        key={expiry}
                        className="flex items-center gap-2 rounded-lg border border-[#00B0F0]/20 bg-[#00B0F0]/10 px-3 py-2 text-xs text-[#00B0F0]"
                      >
                        <span>{expiry}</span>
                        <button
                          onClick={() => onExpiriesChange(selectedExpiries.filter((e) => e !== expiry))}
                          className="text-white/60 hover:text-white transition"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── METRIC ────────────────────────────────────────────── */}
        {!isFutures && (
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-white">Metric</h2>
              <p className="text-xs text-white/45 mt-1">Select chart mode</p>
            </div>
            <div className="space-y-2">
              {metricOptions.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-3 cursor-pointer transition ${
                    selectedMetric === option.value
                      ? option.value === 'daily_expiry_snapshot'
                        ? 'border-[#FFA726]/30 bg-[#FFA726]/10'
                        : 'border-[#00B0F0]/30 bg-[#00B0F0]/10'
                      : 'border-white/8 bg-[#151922] hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="metric"
                    value={option.value}
                    checked={selectedMetric === option.value}
                    onChange={() => onMetricChange(option.value)}
                    className="w-4 h-4 accent-[#00B0F0]"
                  />
                  <span className={`text-sm ${
                    selectedMetric === option.value
                      ? option.value === 'daily_expiry_snapshot'
                        ? 'text-[#FFA726]'
                        : 'text-[#00B0F0]'
                      : 'text-white/85'
                  }`}>
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* ── DATE RANGE ────────────────────────────────────────── */}
        {!isFutures && !isOICharts && (
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-white">Date Range</h2>
              <p className="text-xs text-white/45 mt-1">
                {validDates.length > 0
                  ? 'Only market trading days are selectable'
                  : 'Filter available trading dates'}
              </p>
            </div>
            <div className={`space-y-4 ${dateRangeDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
              <div>
                <label className="block mb-2 text-xs text-white/55">
                  {isDailySnapshot ? 'Date' : 'Start Date'}
                </label>
                <input
                  type="date"
                  value={startDate || ''}
                  min={minValidDate}
                  max={maxValidDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  onBlur={(e) => {
                    if (e.target.value) handleStartDateChange(e.target.value);
                  }}
                  className="w-full"
                />
                {validDates.length > 0 && startDate && !validDateSet.has(startDate) && (
                  <p className="mt-1 text-xs text-[#FFA726]/80">
                    Snapped to nearest trading day
                  </p>
                )}
              </div>
              <div className={disableEndDate ? 'opacity-40 pointer-events-none' : ''}>
                <label className="block mb-2 text-xs text-white/55">End Date</label>
                <input
                  type="date"
                  value={endDate || ''}
                  min={minValidDate}
                  max={maxValidDate}
                  disabled={disableEndDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  onBlur={(e) => {
                    if (e.target.value) handleEndDateChange(e.target.value);
                  }}
                  className="w-full"
                />
                {validDates.length > 0 && endDate && !validDateSet.has(endDate) && (
                  <p className="mt-1 text-xs text-[#FFA726]/80">
                    Snapped to nearest trading day
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

      </div>
    </aside>
  );
}
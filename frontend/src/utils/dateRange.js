// frontend/src/utils/dateRange.js
// Shared date-range default helper used by chart panels with 1M/3M/6M/1Y presets.
// See frontend/CONTEXT.md for usage guidance.

// Returns { start, end } spanning roughly `months` calendar months back from
// the last entry of allDates (assumes ~22 trading sessions per month).
export function defaultRange(allDates, months = 3) {
  if (!allDates?.length) return { start: '', end: '' };
  return { start: allDates.at(-(months * 22)) ?? allDates[0], end: allDates.at(-1) };
}

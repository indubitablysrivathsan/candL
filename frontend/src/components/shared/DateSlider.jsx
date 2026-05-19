// frontend/src/components/shared/DateSlider.jsx

import { useMemo } from 'react';

export default function DateSlider({
  dates = [],
  selectedDate,
  onChange
}) {
  const selectedIndex = useMemo(() => {
    if (!dates.length) {
      return 0;
    }

    const idx = dates.findIndex(
      (date) => date === selectedDate
    );

    return idx >= 0 ? idx : 0;
  }, [dates, selectedDate]);

  const totalDays = dates.length;

  const handleSliderChange = (event) => {
    const nextIndex = Number(event.target.value);

    const nextDate = dates[nextIndex];

    if (nextDate) {
      onChange(nextDate);
    }
  };

  const goPrevious = () => {
    if (selectedIndex <= 0) {
      return;
    }

    onChange(dates[selectedIndex - 1]);
  };

  const goNext = () => {
    if (selectedIndex >= dates.length - 1) {
      return;
    }

    onChange(dates[selectedIndex + 1]);
  };

  if (!dates.length) {
    return (
      <div className="card px-4 py-3">
        <p className="text-sm text-white/60">
          No dates available
        </p>
      </div>
    );
  }

  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        {/* Previous */}
        <button
          onClick={goPrevious}
          disabled={selectedIndex === 0}
          className="
            w-9
            h-9
            rounded-xl
            bg-[#151922]
            border
            border-white/10
            text-sm
            transition
            hover:bg-white/10
            disabled:opacity-40
            disabled:cursor-not-allowed
          "
        >
          ◀
        </button>

        {/* Slider Section */}
        <div className="flex-1 px-2">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-white">
              {selectedDate}
            </p>

            <p className="text-xs text-white/50">
              Day {selectedIndex + 1} of {totalDays}
            </p>
          </div>

          <input
            type="range"
            min={0}
            max={dates.length - 1}
            step={1}
            value={selectedIndex}
            onChange={handleSliderChange}
          />
        </div>

        {/* Next */}
        <button
          onClick={goNext}
          disabled={selectedIndex === dates.length - 1}
          className="
            w-11
            h-11
            rounded-xl
            bg-[#151922]
            border
            border-white/10
            text-lg
            transition
            hover:bg-white/10
            disabled:opacity-40
            disabled:cursor-not-allowed
          "
        >
          ▶
        </button>
      </div>
    </div>
  );
}
// frontend/src/pages/Futures.jsx

export default function Futures() {
  return (
    <div className="p-6">
      <div
        className="
          card
          min-h-[300px]
          flex
          flex-col
          items-center
          justify-center
          text-center
          px-6
        "
      >
        <div
          className="
            w-20
            h-20
            rounded-2xl
            bg-[#00B0F0]/10
            border
            border-[#00B0F0]/20
            flex
            items-center
            justify-center
            text-4xl
            mb-6
          "
        >
          📈
        </div>

        <h1 className="text-3xl font-bold text-white">
          Futures Dashboard
        </h1>

        <p className="mt-4 max-w-xl text-white/55 leading-relaxed">
          Futures analytics integration is planned
          for the next phase. This module will
          include OHLC analysis, rollover tracking,
          volume analytics, and futures open interest
          visualization.
        </p>

        <div
          className="
            mt-8
            rounded-xl
            border
            border-white/10
            bg-[#151922]
            px-5
            py-3
            text-sm
            text-white/65
          "
        >
          Status: Coming Soon
        </div>
      </div>
    </div>
  );
}
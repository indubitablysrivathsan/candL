// frontend/src/pages/Indexes.jsx

export default function Indexes() {
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
            bg-[#FFA726]/10
            border
            border-[#FFA726]/20
            flex
            items-center
            justify-center
            text-4xl
            mb-6
          "
        >
          📉
        </div>

        <h1 className="text-3xl font-bold text-white">
          Index Analytics
        </h1>

        <p className="mt-4 max-w-xl text-white/55 leading-relaxed">
          Index analytics for NIFTY, BANKNIFTY,
          FINNIFTY and sectoral indexes will be
          integrated here. Planned functionality
          includes breadth analysis, institutional
          flow overlays, volatility structure, and
          cross-index comparative views.
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
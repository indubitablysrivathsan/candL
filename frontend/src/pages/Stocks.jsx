// frontend/src/pages/Stocks.jsx

export default function Stocks() {
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
            bg-emerald-500/10
            border
            border-emerald-500/20
            flex
            items-center
            justify-center
            text-4xl
            mb-6
          "
        >
          📊
        </div>

        <h1 className="text-3xl font-bold text-white">
          Stocks Dashboard
        </h1>

        <p className="mt-4 max-w-xl text-white/55 leading-relaxed">
          Equity analytics and stock-level market
          structure dashboards will be added here.
          Planned features include delivery analysis,
          VWAP overlays, breadth metrics, and
          historical screening tools.
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
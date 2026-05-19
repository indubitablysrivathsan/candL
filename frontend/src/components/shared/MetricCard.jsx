// frontend/src/components/shared/MetricCard.jsx

export default function MetricCard({
  title,
  value,
  subtitle,
  accent = '#00B0F0'
}) {
  return (
    <div
      className="
        card
        relative
        overflow-hidden
        p-5
        min-h-[120px]
      "
    >
      {/* Accent Bar */}
      <div
        className="absolute top-0 left-0 h-1 w-full"
        style={{
          background: accent
        }}
      />

      <div className="flex flex-col h-full justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/50">
            {title}
          </p>

          <h3 className="mt-3 text-2xl font-semibold text-white break-words">
            {value}
          </h3>
        </div>

        {subtitle && (
          <p className="mt-4 text-xs text-white/45">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
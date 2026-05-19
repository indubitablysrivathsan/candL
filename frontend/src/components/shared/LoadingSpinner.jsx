// frontend/src/components/shared/LoadingSpinner.jsx

export default function LoadingSpinner({
  size = 'md',
  label = 'Loading...'
}) {
  const sizeClasses = {
    sm: 'w-5 h-5 border-2',
    md: 'w-10 h-10 border-[3px]',
    lg: 'w-16 h-16 border-4'
  };

  return (
    <div className="w-full flex flex-col items-center justify-center py-12">
      <div
        className={`
          ${sizeClasses[size]}
          rounded-full
          border-[#1f2937]
          border-t-[#00B0F0]
          animate-spin
        `}
      />

      {label && (
        <p className="mt-4 text-sm text-white/70">
          {label}
        </p>
      )}
    </div>
  );
}
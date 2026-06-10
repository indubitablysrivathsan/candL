// frontend/src/components/shared/LoadingSpinner.jsx

export default function LoadingSpinner({ size = 'md', label = 'Loading...' }) {
  const dim = size === 'sm' ? 16 : size === 'lg' ? 40 : 24;
  const border = size === 'sm' ? 2 : size === 'lg' ? 3 : 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', gap: 12 }}>
      <div
        style={{
          width: dim,
          height: dim,
          borderRadius: '50%',
          border: `${border}px solid rgba(255,255,255,0.08)`,
          borderTopColor: '#F5A623',
          animation: 'terminal-spin 0.7s linear infinite',
        }}
      />
      {label && (
        <span style={{ fontSize: '10px', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>
          {label}
        </span>
      )}
      <style>{`@keyframes terminal-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
// frontend/src/components/shared/MetricCard.jsx

export default function MetricCard({ title, value, subtitle, accent = '#F5A623' }) {
  return (
    <div style={{
      flex: '1 1 0',
      minWidth: 0,
      background: '#0d1117',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      borderBottom: `2px solid ${accent}`,
      padding: '14px 20px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <span style={{
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.28)',
      }}>
        {title}
      </span>
      <span style={{
        fontSize: 22,
        fontWeight: 600,
        color: accent,
        letterSpacing: '0.02em',
        lineHeight: 1.1,
        wordBreak: 'break-all',
      }}>
        {value ?? '--'}
      </span>
      {subtitle && (
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>
          {subtitle}
        </span>
      )}
    </div>
  );
}
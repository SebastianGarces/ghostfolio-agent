import React from 'react';

interface MetricItem {
  label: string;
  value: string;
  format?: string | null;
  sentiment?: 'positive' | 'negative' | 'neutral' | null;
}

interface MetricRowViewProps {
  metrics: MetricItem[];
}

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
  gap: '8px'
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#1e1e1e',
  borderRadius: '8px',
  padding: '10px 12px'
};

const labelStyle: React.CSSProperties = {
  fontSize: '10px',
  color: 'rgba(255,255,255,0.4)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.3px'
};

function getValueColor(sentiment?: string): string {
  if (sentiment === 'positive') return '#4ade80';
  if (sentiment === 'negative') return '#ef4444';
  return '#fff';
}

export function MetricRowView({ metrics }: MetricRowViewProps) {
  return (
    <div style={containerStyle}>
      {metrics.map((m, i) => (
        <div key={i} style={cardStyle}>
          <div style={labelStyle}>{m.label}</div>
          <div
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: getValueColor(m.sentiment),
              marginTop: '2px'
            }}
          >
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

import React from 'react';

interface MetricBlockViewProps {
  label: string;
  value: string;
  format?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

const containerStyle: React.CSSProperties = {
  backgroundColor: '#1e1e1e',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'inline-block',
  minWidth: '120px'
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

export function MetricBlockView({
  label,
  value,
  sentiment
}: MetricBlockViewProps) {
  return (
    <div style={containerStyle}>
      <div style={labelStyle}>{label}</div>
      <div
        style={{
          fontSize: '16px',
          fontWeight: 600,
          color: getValueColor(sentiment),
          marginTop: '2px'
        }}
      >
        {value}
      </div>
    </div>
  );
}

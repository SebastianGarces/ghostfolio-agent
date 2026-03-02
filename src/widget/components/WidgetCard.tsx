import React from 'react';

interface WidgetCardProps {
  title: string;
  children: React.ReactNode;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#2a2a2a',
  borderRadius: '12px',
  border: '1px solid #3a3a3a',
  overflow: 'hidden',
  marginTop: '8px'
};

const titleStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: '12px',
  fontWeight: 600,
  color: 'rgba(255,255,255,0.6)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  borderBottom: '1px solid #3a3a3a'
};

const bodyStyle: React.CSSProperties = {
  padding: '12px 14px'
};

export function WidgetCard({ title, children }: WidgetCardProps) {
  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{title}</div>
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}

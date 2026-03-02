import React from 'react';

interface SymbolBlockViewProps {
  symbol: string;
  name?: string;
}

const containerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  borderRadius: '8px',
  backgroundColor: 'rgba(54, 207, 204, 0.1)',
  border: '1px solid rgba(54, 207, 204, 0.3)'
};

const symbolStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#36CFCC'
};

const nameStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'rgba(255,255,255,0.5)'
};

export function SymbolBlockView({ symbol, name }: SymbolBlockViewProps) {
  return (
    <span style={containerStyle}>
      <span style={symbolStyle}>{symbol}</span>
      {name && <span style={nameStyle}>{name}</span>}
    </span>
  );
}

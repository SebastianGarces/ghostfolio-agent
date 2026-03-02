import React from 'react';

interface ListBlockViewProps {
  items: string[];
}

const listStyle: React.CSSProperties = {
  margin: '4px 0',
  paddingLeft: '16px'
};

const itemStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'rgba(255,255,255,0.85)',
  lineHeight: '1.6'
};

export function ListBlockView({ items }: ListBlockViewProps) {
  return (
    <ul style={listStyle}>
      {items.map((item, i) => (
        <li key={i} style={itemStyle}>
          {item}
        </li>
      ))}
    </ul>
  );
}

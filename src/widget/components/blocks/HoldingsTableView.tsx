import React from 'react';

interface Holding {
  symbol: string;
  name: string;
  allocation: number;
  value: number;
  netPerformancePercent: number;
}

interface HoldingsTableViewProps {
  holdings: Holding[];
  maxRows?: number;
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse' as const,
  fontSize: '12px'
};

const thStyle: React.CSSProperties = {
  textAlign: 'left' as const,
  padding: '6px 8px',
  color: 'rgba(255,255,255,0.5)',
  fontWeight: 500,
  borderBottom: '1px solid #3a3a3a'
};

const tdStyle: React.CSSProperties = {
  padding: '6px 8px',
  color: 'rgba(255,255,255,0.85)',
  borderBottom: '1px solid rgba(255,255,255,0.05)'
};

const tdRightStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right' as const
};

const thRightStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: 'right' as const
};

export function HoldingsTableView({
  holdings,
  maxRows
}: HoldingsTableViewProps) {
  if (!holdings || holdings.length === 0) return null;

  const rows = maxRows ? holdings.slice(0, maxRows) : holdings;
  const remaining = maxRows ? holdings.length - rows.length : 0;

  return (
    <div style={{ overflowX: 'auto' as const }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thRightStyle}>Alloc</th>
            <th style={thRightStyle}>Value</th>
            <th style={thRightStyle}>Perf</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.symbol}>
              <td style={tdStyle}>
                <span style={{ color: '#fff', fontWeight: 500 }}>
                  {h.symbol}
                </span>
                <span
                  style={{
                    display: 'block',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: '11px'
                  }}
                >
                  {h.name}
                </span>
              </td>
              <td style={tdRightStyle}>{(h.allocation * 100).toFixed(1)}%</td>
              <td style={tdRightStyle}>{h.value.toLocaleString()}</td>
              <td
                style={{
                  ...tdRightStyle,
                  color: h.netPerformancePercent >= 0 ? '#4ade80' : '#ef4444'
                }}
              >
                {h.netPerformancePercent >= 0 ? '+' : ''}
                {(h.netPerformancePercent * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {remaining > 0 && (
        <div
          style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.4)',
            padding: '6px 8px'
          }}
        >
          and {remaining} more...
        </div>
      )}
    </div>
  );
}

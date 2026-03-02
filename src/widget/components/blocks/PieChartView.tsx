import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { PIE_COLORS, TOOLTIP_STYLES } from '../ChartTheme';

interface PieChartViewProps {
  holdings: Array<{ symbol: string; allocation: number }>;
  maxSlices?: number;
}

export function PieChartView({ holdings, maxSlices }: PieChartViewProps) {
  if (!holdings || holdings.length === 0) return null;

  const slices = maxSlices ? holdings.slice(0, maxSlices) : holdings;
  const pieData = slices.map((h) => ({
    name: h.symbol,
    value: h.allocation * 100
  }));

  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={75}
            dataKey="value"
            stroke="none"
          >
            {pieData.map((_entry, i) => (
              <Cell
                key={`cell-${i}`}
                fill={PIE_COLORS[i % PIE_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            {...TOOLTIP_STYLES}
            formatter={(value: number) => `${value.toFixed(2)}%`}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

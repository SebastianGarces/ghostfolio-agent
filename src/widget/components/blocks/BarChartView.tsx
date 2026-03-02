import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { CHART_COLORS, CHART_MARGIN, TOOLTIP_STYLES } from '../ChartTheme';

interface BarChartViewProps {
  data: Array<{ date: string; amount: number }>;
  color?: string;
  label?: string;
}

export function BarChartView({ data, color, label }: BarChartViewProps) {
  if (!data || data.length <= 1) return null;

  const fillColor = color ?? CHART_COLORS.positive;

  return (
    <div style={{ width: '100%', height: 160 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_COLORS.grid}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: CHART_COLORS.textMuted }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: CHART_COLORS.textMuted }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
            }
          />
          <Tooltip
            {...TOOLTIP_STYLES}
            formatter={(value: number) => value.toLocaleString()}
          />
          <Bar
            dataKey="amount"
            fill={fillColor}
            radius={[3, 3, 0, 0]}
            name={label ?? 'Amount'}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

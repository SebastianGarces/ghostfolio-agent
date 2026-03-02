import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { CHART_COLORS, CHART_MARGIN, TOOLTIP_STYLES } from '../ChartTheme';

interface AreaChartViewProps {
  chart: Array<{ date: string; netWorth: number; totalInvestment: number }>;
}

export function AreaChartView({ chart }: AreaChartViewProps) {
  if (!chart || chart.length <= 1) return null;

  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chart} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={CHART_COLORS.primary}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={CHART_COLORS.primary}
                stopOpacity={0}
              />
            </linearGradient>
            <linearGradient id="invGrad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={CHART_COLORS.investment}
                stopOpacity={0.2}
              />
              <stop
                offset="95%"
                stopColor={CHART_COLORS.investment}
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
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
            tickFormatter={(v) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
            }
            width={40}
          />
          <Tooltip
            {...TOOLTIP_STYLES}
            formatter={(value: number) => value.toLocaleString()}
          />
          <Area
            type="monotone"
            dataKey="totalInvestment"
            stroke={CHART_COLORS.investment}
            fill="url(#invGrad)"
            strokeWidth={1.5}
            name="Investment"
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            stroke={CHART_COLORS.primary}
            fill="url(#nwGrad)"
            strokeWidth={2}
            name="Net Worth"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

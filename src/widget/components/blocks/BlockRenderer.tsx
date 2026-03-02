import React from 'react';

import type { ContentBlock } from '../../../server/graph/content-blocks';
import { WidgetCard } from '../WidgetCard';
import { AreaChartView } from './AreaChartView';
import { BarChartView } from './BarChartView';
import { HoldingsTableView } from './HoldingsTableView';
import { ListBlockView } from './ListBlockView';
import { MetricBlockView } from './MetricBlockView';
import { MetricRowView } from './MetricRowView';
import { PieChartView } from './PieChartView';
import { RuleStatusView } from './RuleStatusView';
import { SymbolBlockView } from './SymbolBlockView';
import { TextBlockView } from './TextBlockView';

interface ToolCallData {
  name: string;
  success: boolean;
  data?: unknown;
}

interface BlockRendererProps {
  blocks: ContentBlock[];
  toolCalls?: ToolCallData[];
}

/**
 * Resolves artifact data from toolCalls for a data-reference block's source.
 */
function resolveSource(
  source: string,
  toolCalls?: ToolCallData[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  if (!toolCalls) return null;
  const tc = toolCalls.find((t) => t.name === source && t.success && t.data);
  return tc?.data ?? null;
}

export function BlockRenderer({ blocks, toolCalls }: BlockRendererProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            if (!block.style || !block.value) return null;
            return (
              <TextBlockView key={i} style={block.style} value={block.value} />
            );

          case 'metric':
            if (!block.label || !block.value) return null;
            return (
              <MetricBlockView
                key={i}
                label={block.label}
                value={block.value}
                format={block.format ?? undefined}
                sentiment={block.sentiment ?? undefined}
              />
            );

          case 'metric_row':
            if (!block.metrics || block.metrics.length < 2) return null;
            return <MetricRowView key={i} metrics={block.metrics} />;

          case 'list':
            if (!block.items || block.items.length === 0) return null;
            return <ListBlockView key={i} items={block.items} />;

          case 'symbol':
            if (!block.symbol) return null;
            return (
              <SymbolBlockView
                key={i}
                symbol={block.symbol}
                name={block.name ?? undefined}
              />
            );

          case 'holdings_table': {
            if (!block.source) return null;
            const data = resolveSource(block.source, toolCalls);
            if (!data?.holdings) return null;
            return (
              <WidgetCard key={i} title="Holdings">
                <HoldingsTableView
                  holdings={data.holdings}
                  maxRows={block.maxRows ?? undefined}
                />
              </WidgetCard>
            );
          }

          case 'pie_chart': {
            if (!block.source) return null;
            const data = resolveSource(block.source, toolCalls);
            if (!data?.holdings) return null;
            return (
              <WidgetCard key={i} title="Allocation">
                <PieChartView holdings={data.holdings} />
              </WidgetCard>
            );
          }

          case 'bar_chart': {
            if (!block.source) return null;
            const data = resolveSource(block.source, toolCalls);
            if (!data) return null;
            const chartData = data.dividends ?? data.investments;
            if (!chartData) return null;
            const title =
              block.source === 'dividend_analysis'
                ? 'Dividends'
                : 'Investment History';
            const color =
              block.source === 'dividend_analysis' ? '#4ade80' : '#6366f1';
            return (
              <WidgetCard key={i} title={title}>
                <BarChartView data={chartData} color={color} label={title} />
              </WidgetCard>
            );
          }

          case 'area_chart': {
            if (!block.source) return null;
            const data = resolveSource(block.source, toolCalls);
            if (!data?.chart) return null;
            return (
              <WidgetCard key={i} title="Performance">
                <AreaChartView chart={data.chart} />
              </WidgetCard>
            );
          }

          case 'rule_status': {
            if (!block.source) return null;
            const data = resolveSource(block.source, toolCalls);
            if (!data?.statistics || !data?.categories) return null;
            return (
              <WidgetCard key={i} title="Risk Assessment">
                <RuleStatusView
                  statistics={data.statistics}
                  categories={data.categories}
                />
              </WidgetCard>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}

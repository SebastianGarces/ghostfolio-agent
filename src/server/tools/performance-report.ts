import { z } from 'zod';

import { createGhostfolioTool, IGhostfolioClient } from './create-tool';

const performanceReportSchema = z.object({
  accounts: z
    .string()
    .optional()
    .describe('Filter by account IDs (comma-separated)'),
  assetClasses: z
    .string()
    .optional()
    .describe('Filter by asset classes (comma-separated)'),
  range: z
    .enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd'])
    .optional()
    .describe('Time range for performance data (default: max)'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)'),
  withExcludedAccounts: z
    .boolean()
    .optional()
    .describe('Include excluded accounts (default: false)')
});

export function createPerformanceReportTool(client: IGhostfolioClient) {
  return createGhostfolioTool(client, {
    name: 'performance_report',
    description:
      'Get aggregate portfolio performance metrics including net performance, total investment, current net worth, and historical chart data. Returns portfolio-wide totals. Use this for questions about overall returns, performance, and portfolio growth over time. Do NOT use this to compare asset classes — use portfolio_analysis instead, which provides per-holding breakdowns with asset class labels.',
    schema: performanceReportSchema,
    handler: async (input, client) => {
      const range = input.range ?? 'max';
      const withExcludedAccounts = input.withExcludedAccounts ?? false;

      const data = await client.get<any>('/api/v2/portfolio/performance', {
        accounts: input.accounts,
        assetClasses: input.assetClasses,
        range,
        tags: input.tags,
        withExcludedAccounts
      });

      let warnings = '';
      if (data.errors?.length > 0 || data.hasErrors) {
        warnings = '\nNote: Some data may be incomplete or delayed.\n';
      }

      const perf = data.performance;

      if (!perf) {
        return ['No performance data available for the specified range.', null];
      }

      // Build header with active filters
      const filterParts: string[] = [`range: ${range}`];
      if (input.assetClasses) {
        filterParts.push(`assetClasses: ${input.assetClasses}`);
      }
      if (input.accounts) {
        filterParts.push(`accounts: ${input.accounts}`);
      }
      if (input.tags) {
        filterParts.push(`tags: ${input.tags}`);
      }

      let result = `Portfolio Performance (${filterParts.join(', ')}):${warnings}\n`;
      result += `- Current Net Worth: ${perf.currentNetWorth?.toFixed(2) ?? 'N/A'}\n`;
      result += `- Total Investment: ${perf.totalInvestment?.toFixed(2) ?? 'N/A'}\n`;

      const netPerfPct = perf.netPerformancePercentage
        ? (perf.netPerformancePercentage * 100).toFixed(2) + '%'
        : 'N/A';
      result += `- Net Performance: ${perf.netPerformance?.toFixed(2) ?? 'N/A'} (${netPerfPct})\n`;

      const netPerfCurrencyPct = perf.netPerformancePercentageWithCurrencyEffect
        ? (perf.netPerformancePercentageWithCurrencyEffect * 100).toFixed(2) +
          '%'
        : 'N/A';
      result += `- Net Performance (with currency effect): ${perf.netPerformanceWithCurrencyEffect?.toFixed(2) ?? 'N/A'} (${netPerfCurrencyPct})\n`;

      if (
        perf.annualizedPerformancePercent !== undefined &&
        perf.annualizedPerformancePercent !== null
      ) {
        result += `- Annualized Performance: ${(perf.annualizedPerformancePercent * 100).toFixed(2)}%\n`;
      }

      if (data.firstOrderDate) {
        result += `- First Transaction: ${data.firstOrderDate}\n`;
      }

      // Chart data for widget
      const chart = data.chart;
      const widgetChart =
        chart?.map((c: any) => ({
          date: c.date,
          netWorth: c.netWorth ?? 0,
          totalInvestment: c.totalInvestment ?? 0
        })) ?? [];

      if (chart && chart.length > 0) {
        const first = chart[0];
        const last = chart[chart.length - 1];
        const mid = chart[Math.floor(chart.length / 2)];

        result += `\nChart Summary (${chart.length} data points):\n`;
        result += `- Start (${first.date}): Net Worth ${first.netWorth?.toFixed(2) ?? 'N/A'}, Investment ${first.totalInvestment?.toFixed(2) ?? 'N/A'}\n`;

        if (chart.length > 2) {
          result += `- Midpoint (${mid.date}): Net Worth ${mid.netWorth?.toFixed(2) ?? 'N/A'}, Investment ${mid.totalInvestment?.toFixed(2) ?? 'N/A'}\n`;
        }

        result += `- End (${last.date}): Net Worth ${last.netWorth?.toFixed(2) ?? 'N/A'}, Investment ${last.totalInvestment?.toFixed(2) ?? 'N/A'}\n`;
      }

      const widgetData = {
        type: 'performance_report' as const,
        chart: widgetChart,
        metrics: {
          currentNetWorth: perf.currentNetWorth ?? 0,
          totalInvestment: perf.totalInvestment ?? 0,
          netPerformance: perf.netPerformance ?? 0,
          netPerformancePercent: perf.netPerformancePercentage ?? 0,
          annualizedPercent: perf.annualizedPerformancePercent ?? null,
          firstOrderDate: data.firstOrderDate ?? null
        }
      };

      return [result, widgetData];
    }
  });
}

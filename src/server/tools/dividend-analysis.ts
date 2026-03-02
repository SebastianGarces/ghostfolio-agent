import { z } from 'zod';

import { createGhostfolioTool, IGhostfolioClient } from './create-tool';

const dividendAnalysisSchema = z.object({
  accounts: z
    .string()
    .optional()
    .describe('Filter by account IDs (comma-separated)'),
  assetClasses: z
    .string()
    .optional()
    .describe('Filter by asset classes (comma-separated)'),
  groupBy: z
    .enum(['month', 'year'])
    .optional()
    .describe('Group dividends by period (month or year)'),
  range: z
    .enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd'])
    .optional()
    .describe('Time range for dividend data (default: max)'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)')
});

export function createDividendAnalysisTool(client: IGhostfolioClient) {
  return createGhostfolioTool(client, {
    name: 'dividend_analysis',
    description:
      'Get dividend income history for the portfolio. Shows dividend payments received over time, optionally grouped by month or year. Use this for questions about dividend income, yield, and dividend history.',
    schema: dividendAnalysisSchema,
    handler: async (input, client) => {
      const range = input.range ?? 'max';

      const data = await client.get<{
        dividends: Array<{ date: string; investment: number }>;
      }>('/api/v1/portfolio/dividends', {
        accounts: input.accounts,
        assetClasses: input.assetClasses,
        groupBy: input.groupBy,
        range,
        tags: input.tags
      });

      const dividends = data.dividends;

      if (!dividends || dividends.length === 0) {
        return ['No dividend data available for the specified range.', null];
      }

      const totalDividends = dividends.reduce(
        (sum, d) => sum + d.investment,
        0
      );

      let result = `Dividend Analysis (range: ${range}):\n`;
      result += `- Total Dividend Income: ${totalDividends.toFixed(2)}\n`;
      result += `- Number of Dividend Events: ${dividends.length}\n`;
      result += `- Date Range: ${dividends[0].date} to ${dividends[dividends.length - 1].date}\n`;

      // Group by year if requested
      if (input.groupBy === 'year') {
        const byYear: Record<string, number> = {};

        for (const d of dividends) {
          const year = d.date.substring(0, 4);
          byYear[year] = (byYear[year] ?? 0) + d.investment;
        }

        result += `\nAnnual Dividend Totals:\n`;

        for (const [year, total] of Object.entries(byYear)) {
          result += `- ${year}: ${total.toFixed(2)}\n`;
        }
      } else {
        // Show individual entries — summarize if list is long
        result += `\nDividend History:\n`;

        if (dividends.length <= 10) {
          for (const d of dividends) {
            result += `- ${d.date}: ${d.investment.toFixed(2)}\n`;
          }
        } else {
          // Show first 3, mid, last 3
          for (let i = 0; i < 3; i++) {
            result += `- ${dividends[i].date}: ${dividends[i].investment.toFixed(2)}\n`;
          }

          result += `  ... (${dividends.length - 6} more entries)\n`;
          const mid = Math.floor(dividends.length / 2);
          result += `- ${dividends[mid].date}: ${dividends[mid].investment.toFixed(2)} (midpoint)\n`;

          for (let i = dividends.length - 3; i < dividends.length; i++) {
            result += `- ${dividends[i].date}: ${dividends[i].investment.toFixed(2)}\n`;
          }
        }
      }

      const widgetData = {
        type: 'dividend_analysis' as const,
        totalDividends,
        dividends: dividends.map((d) => ({
          date: d.date,
          amount: d.investment
        })),
        dateRange: `${dividends[0].date} to ${dividends[dividends.length - 1].date}`
      };

      return [result, widgetData];
    }
  });
}

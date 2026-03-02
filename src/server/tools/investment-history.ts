import { z } from 'zod';

import { createGhostfolioTool, IGhostfolioClient } from './create-tool';

const investmentHistorySchema = z.object({
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
    .describe('Group investments by period (month or year)'),
  range: z
    .enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd'])
    .optional()
    .describe('Time range for investment data (default: max)'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)')
});

export function createInvestmentHistoryTool(client: IGhostfolioClient) {
  return createGhostfolioTool(client, {
    name: 'investment_history',
    description:
      'Get investment contribution history for the portfolio. Shows how much was invested over time and investment consistency streaks. Use this for questions about investment patterns, contributions, and consistency.',
    schema: investmentHistorySchema,
    handler: async (input, client) => {
      const range = input.range ?? 'max';

      const data = await client.get<{
        investments: Array<{ date: string; investment: number }>;
        streaks: { currentStreak: number; longestStreak: number };
      }>('/api/v1/portfolio/investments', {
        accounts: input.accounts,
        assetClasses: input.assetClasses,
        groupBy: input.groupBy,
        range,
        tags: input.tags
      });

      const investments = data.investments;

      if (!investments || investments.length === 0) {
        return ['No investment data available for the specified range.', null];
      }

      const totalInvested = investments.reduce(
        (sum, d) => sum + d.investment,
        0
      );

      let result = `Investment History (range: ${range}):\n`;
      result += `- Total Invested: ${totalInvested.toFixed(2)}\n`;
      result += `- Number of Investment Events: ${investments.length}\n`;
      result += `- Date Range: ${investments[0].date} to ${investments[investments.length - 1].date}\n`;

      // Streak info
      if (data.streaks) {
        result += `\nInvestment Consistency:\n`;
        result += `- Current Streak: ${data.streaks.currentStreak} consecutive months\n`;
        result += `- Longest Streak: ${data.streaks.longestStreak} consecutive months\n`;
      }

      // Show entries — summarize if list is long
      result += `\nInvestment Timeline:\n`;

      if (investments.length <= 10) {
        for (const d of investments) {
          result += `- ${d.date}: ${d.investment.toFixed(2)}\n`;
        }
      } else {
        // Show first 3, mid, last 3
        for (let i = 0; i < 3; i++) {
          result += `- ${investments[i].date}: ${investments[i].investment.toFixed(2)}\n`;
        }

        result += `  ... (${investments.length - 6} more entries)\n`;
        const mid = Math.floor(investments.length / 2);
        result += `- ${investments[mid].date}: ${investments[mid].investment.toFixed(2)} (midpoint)\n`;

        for (let i = investments.length - 3; i < investments.length; i++) {
          result += `- ${investments[i].date}: ${investments[i].investment.toFixed(2)}\n`;
        }
      }

      const widgetData = {
        type: 'investment_history' as const,
        totalInvested,
        investments: investments.map((d) => ({
          date: d.date,
          amount: d.investment
        })),
        streaks: data.streaks
          ? {
              current: data.streaks.currentStreak,
              longest: data.streaks.longestStreak
            }
          : null,
        dateRange: `${investments[0].date} to ${investments[investments.length - 1].date}`
      };

      return [result, widgetData];
    }
  });
}

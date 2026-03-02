import { z } from 'zod';

import { createGhostfolioTool, IGhostfolioClient } from './create-tool';

const portfolioAnalysisSchema = z.object({
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
    .describe('Time range for analysis (default: max)'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)')
});

export function createPortfolioAnalysisTool(client: IGhostfolioClient) {
  return createGhostfolioTool(client, {
    name: 'portfolio_analysis',
    description:
      'Get comprehensive portfolio overview including holdings, allocation percentages, accounts, platforms, and summary. Use this for questions about portfolio composition, allocation, holdings, or net worth.',
    schema: portfolioAnalysisSchema,
    handler: async (input, client) => {
      const range = input.range ?? 'max';

      const data = await client.get<any>('/api/v1/portfolio/details', {
        accounts: input.accounts,
        assetClasses: input.assetClasses,
        range,
        tags: input.tags
      });

      const holdings = data.holdings ?? {};
      const holdingEntries = Object.entries(holdings);

      if (holdingEntries.length === 0) {
        return [
          'Your portfolio is empty. Add some transactions in Ghostfolio to get started with analysis.',
          null
        ];
      }

      let warnings = '';
      if (data.hasError) {
        warnings = '\nNote: Some data may be incomplete or delayed.\n';
      }

      // Build widget data
      const widgetHoldings = holdingEntries
        .sort(
          (a: any, b: any) =>
            (b[1].allocationInPercentage ?? 0) -
            (a[1].allocationInPercentage ?? 0)
        )
        .map(([symbol, pos]: [string, any]) => ({
          symbol,
          name: pos.name ?? symbol,
          allocation: pos.allocationInPercentage ?? 0,
          value: pos.valueInBaseCurrency ?? 0,
          netPerformance: pos.netPerformance ?? 0,
          netPerformancePercent: pos.netPerformancePercent ?? 0,
          assetClass: pos.assetClass ?? 'UNKNOWN',
          assetSubClass: pos.assetSubClass ?? 'UNKNOWN',
          currency: pos.currency ?? 'USD'
        }));

      // Format holdings summary (for LLM)
      const holdingsSummary = widgetHoldings
        .map((h) => {
          const allocationPct =
            h.allocation > 0 ? (h.allocation * 100).toFixed(2) + '%' : 'N/A';
          const netPerfPct =
            h.netPerformancePercent !== 0
              ? (h.netPerformancePercent * 100).toFixed(2) + '%'
              : 'N/A';

          return `- ${h.name} (${h.symbol}): ${allocationPct} allocation, ${h.currency} ${h.netPerformance.toFixed(2)} net performance (${netPerfPct}), value: ${h.value.toFixed(2)}, type: ${h.assetClass}/${h.assetSubClass}`;
        })
        .join('\n');

      // Format accounts
      const accounts = data.accounts ?? {};
      const widgetAccounts = Object.entries(accounts).map(
        ([, acc]: [string, any]) => ({
          name: acc.name,
          value: acc.valueInBaseCurrency ?? 0,
          currency: acc.currency ?? 'USD'
        })
      );

      const accountsSummary = widgetAccounts
        .map((a) => `- ${a.name}: ${a.currency} ${a.value.toFixed(2)}`)
        .join('\n');

      // Format summary
      const summary = data.summary;
      let summaryText = '';
      // When currentNetWorth is null/0 (restricted/non-premium users),
      // fall back to summing valueInBaseCurrency from holdings.
      const holdingsNetWorth = widgetHoldings.reduce(
        (sum, h) => sum + h.value,
        0
      );
      const widgetSummary = summary
        ? {
            currentNetWorth: summary.currentNetWorth || holdingsNetWorth,
            totalInvestment: summary.totalInvestment ?? 0,
            netPerformance: summary.netPerformance ?? 0,
            netPerformancePercent: summary.netPerformancePercentage ?? 0,
            dividend: summary.dividend ?? 0,
            fees: summary.fees ?? 0
          }
        : null;

      if (summary) {
        const netPerfPct = summary.netPerformancePercentage
          ? (summary.netPerformancePercentage * 100).toFixed(2) + '%'
          : 'N/A';

        summaryText = `\nPortfolio Summary:\n`;
        summaryText += `- Current Net Worth: ${summary.currentNetWorth?.toFixed(2) ?? 'N/A'}\n`;
        summaryText += `- Total Investment: ${summary.totalInvestment?.toFixed(2) ?? 'N/A'}\n`;
        summaryText += `- Net Performance: ${summary.netPerformance?.toFixed(2) ?? 'N/A'} (${netPerfPct})\n`;
        summaryText += `- Dividend: ${summary.dividendInBaseCurrency?.toFixed(2) ?? 'N/A'}\n`;
        summaryText += `- Fees: ${summary.fees?.toFixed(2) ?? 'N/A'}`;
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

      const formatted = `Portfolio Analysis (${filterParts.join(', ')}):${warnings}\n\nHoldings (${holdingEntries.length} positions):\n${holdingsSummary}\n\nAccounts:\n${accountsSummary}${summaryText}`;

      const widgetData = {
        type: 'portfolio_analysis' as const,
        holdings: widgetHoldings,
        summary: widgetSummary,
        accounts: widgetAccounts
      };

      return [formatted, widgetData];
    }
  });
}

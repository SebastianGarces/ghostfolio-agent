import { z } from 'zod';

import { createGhostfolioTool, IGhostfolioClient } from './create-tool';

const holdingsSearchSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Search holdings by name, symbol, asset class, or asset sub-class (e.g. "CRYPTOCURRENCY", "STOCK", "ETF")'
    ),
  accounts: z
    .string()
    .optional()
    .describe('Filter by account IDs (comma-separated)'),
  assetClasses: z
    .string()
    .optional()
    .describe(
      'Filter by asset classes (comma-separated, e.g. EQUITY,FIXED_INCOME)'
    ),
  holdingType: z.string().optional().describe('Filter by holding type'),
  range: z
    .enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd'])
    .optional()
    .describe('Time range for holdings data (default: max)'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)')
});

export function createHoldingsSearchTool(client: IGhostfolioClient) {
  return createGhostfolioTool(client, {
    name: 'holdings_search',
    description:
      'Search and filter portfolio holdings. Returns a list of holdings matching the specified criteria including allocation, value, and performance. Use this for finding specific holdings, filtering by asset class, or searching by name/symbol.',
    schema: holdingsSearchSchema,
    handler: async (input, client) => {
      const range = input.range ?? 'max';

      const data = await client.get<{
        holdings: Array<{
          symbol: string;
          name: string;
          allocationInPercentage: number;
          valueInBaseCurrency: number;
          netPerformance: number;
          netPerformancePercent: number;
          quantity: number;
          assetClass: string;
          assetSubClass: string;
          currency: string;
        }>;
      }>('/api/v1/portfolio/holdings', {
        accounts: input.accounts,
        assetClasses: input.assetClasses,
        holdingType: input.holdingType,
        range,
        tags: input.tags
      });

      let holdings = data.holdings ?? [];

      // Client-side query filtering (the API may not support text search)
      if (input.query) {
        const terms = input.query
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0);
        holdings = holdings.filter((h) => {
          const fields = [
            (h.symbol ?? '').toLowerCase(),
            (h.name ?? '').toLowerCase(),
            (h.assetClass ?? '').toLowerCase(),
            (h.assetSubClass ?? '').toLowerCase()
          ].join(' ');
          return terms.every((t) => fields.includes(t));
        });
      }

      if (holdings.length === 0) {
        return ['No holdings match your search criteria.', null];
      }

      let result = `Holdings Search Results (${holdings.length} match${holdings.length !== 1 ? 'es' : ''}):\n`;

      const formatHolding = (h: (typeof holdings)[0]) => {
        const allocationPct =
          h.allocationInPercentage > 0
            ? (h.allocationInPercentage * 100).toFixed(2) + '%'
            : 'N/A';
        const netPerfPct =
          h.netPerformancePercent !== 0
            ? (h.netPerformancePercent * 100).toFixed(2) + '%'
            : 'N/A';
        return `- ${h.name ?? 'Unknown'} (${h.symbol}): ${allocationPct} allocation, value: ${(h.valueInBaseCurrency ?? 0).toFixed(2)} ${h.currency ?? 'USD'}, net performance: ${(h.netPerformance ?? 0).toFixed(2)} (${netPerfPct}), asset class: ${h.assetClass ?? 'UNKNOWN'}, sub-class: ${h.assetSubClass ?? 'UNKNOWN'}`;
      };

      if (holdings.length <= 10) {
        for (const h of holdings) {
          result += formatHolding(h) + '\n';
        }
      } else {
        // Show first 5, count, last 2
        for (let i = 0; i < 5; i++) {
          result += formatHolding(holdings[i]) + '\n';
        }
        result += `  ... (${holdings.length - 7} more holdings)\n`;
        for (let i = holdings.length - 2; i < holdings.length; i++) {
          result += formatHolding(holdings[i]) + '\n';
        }
      }

      const widgetData = {
        type: 'holdings_search' as const,
        query: input.query ?? null,
        holdings: holdings.map((h) => ({
          symbol: h.symbol,
          name: h.name,
          allocation: h.allocationInPercentage ?? 0,
          value: h.valueInBaseCurrency ?? 0,
          netPerformance: h.netPerformance ?? 0,
          netPerformancePercent: h.netPerformancePercent ?? 0,
          quantity: h.quantity ?? 0,
          assetClass: h.assetClass ?? 'UNKNOWN',
          assetSubClass: h.assetSubClass ?? 'UNKNOWN',
          currency: h.currency ?? 'USD'
        }))
      };

      return [result, widgetData];
    }
  });
}

import { z } from 'zod';

import { createGhostfolioTool, IGhostfolioClient } from './create-tool';

const marketDataSchema = z.object({
  symbol: z
    .string()
    .describe(
      'Ticker symbol(s) to look up. For multiple symbols, pass comma-separated (e.g., TSLA,AAPL,GOOGL)'
    ),
  includeHistoricalData: z
    .number()
    .optional()
    .describe('Number of days of historical price data to include (default: 0)')
});

interface LookupItem {
  assetClass: string;
  assetSubClass: string;
  currency: string;
  dataSource: string;
  name: string;
  symbol: string;
}

interface LookupResponse {
  items: LookupItem[];
}

interface HistoricalDataItem {
  date: string;
  marketPrice: number;
}

interface SymbolItem {
  currency: string;
  dataSource: string;
  historicalData: HistoricalDataItem[];
  marketPrice: number;
  symbol: string;
}

interface MarketDataResult {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  assetClass: string;
  assetSubClass: string;
  historicalData: { date: string; price: number }[];
}

/**
 * Look up a single symbol: resolve via lookup API, then fetch market data.
 * Returns a MarketDataResult on success, or null if the symbol cannot be found.
 */
async function lookupSingleSymbol(
  client: IGhostfolioClient,
  rawSymbol: string,
  historyDays: number
): Promise<{ result: MarketDataResult; text: string } | null> {
  const lookup = await client.get<LookupResponse>('/api/v1/symbol/lookup', {
    query: rawSymbol
  });

  if (!lookup.items || lookup.items.length === 0) {
    return null;
  }

  // Prefer exact symbol match with non-crypto asset class, then exact
  // symbol match of any kind, then fall back to first result.
  const upperSymbol = rawSymbol.toUpperCase();
  const match =
    lookup.items.find(
      (i) =>
        i.symbol.toUpperCase() === upperSymbol &&
        i.assetSubClass !== 'CRYPTOCURRENCY'
    ) ??
    lookup.items.find((i) => i.symbol.toUpperCase() === upperSymbol) ??
    lookup.items[0];

  const symbolData = await client.get<SymbolItem>(
    `/api/v1/symbol/${match.dataSource}/${match.symbol}`,
    historyDays > 0 ? { includeHistoricalData: String(historyDays) } : undefined
  );

  let text = `Market Data for ${match.name} (${match.symbol}):\n`;
  text += `- Current Price: ${symbolData.currency} ${symbolData.marketPrice}\n`;
  text += `- Currency: ${symbolData.currency}\n`;
  text += `- Data Source: ${symbolData.dataSource}\n`;
  text += `- Asset Class: ${match.assetClass}\n`;
  text += `- Asset Sub-Class: ${match.assetSubClass}`;

  if (
    historyDays > 0 &&
    symbolData.historicalData &&
    symbolData.historicalData.length > 0
  ) {
    text += `\n\nHistorical Data (${symbolData.historicalData.length} days):\n`;
    text += symbolData.historicalData
      .map((d) => `- ${d.date}: ${symbolData.currency} ${d.marketPrice}`)
      .join('\n');
  }

  return {
    result: {
      symbol: match.symbol,
      name: match.name,
      price: symbolData.marketPrice,
      currency: symbolData.currency,
      assetClass: match.assetClass,
      assetSubClass: match.assetSubClass,
      historicalData: (symbolData.historicalData ?? []).map((d) => ({
        date: d.date,
        price: d.marketPrice
      }))
    },
    text
  };
}

export function createMarketDataTool(client: IGhostfolioClient) {
  return createGhostfolioTool(client, {
    name: 'market_data_lookup',
    description:
      'Look up the current market price of any stock, ETF, cryptocurrency, or other financial instrument by its ticker symbol. For multiple symbols, pass them comma-separated (e.g., TSLA,AAPL,GOOGL). Use this for questions about current prices, market data, or symbol lookups.',
    schema: marketDataSchema,
    handler: async (input, client) => {
      const symbols = input.symbol
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const historyDays = input.includeHistoricalData ?? 0;

      // Single symbol — preserve original return format for backward compat
      if (symbols.length <= 1) {
        const sym = symbols[0] ?? input.symbol;
        const out = await lookupSingleSymbol(client, sym, historyDays);

        if (!out) {
          return [
            `No results found for symbol "${sym}". Please check the ticker symbol and try again.`,
            null
          ];
        }

        return [
          out.text,
          {
            type: 'market_data_lookup' as const,
            ...out.result
          }
        ];
      }

      // Multiple symbols — fan out in parallel
      const settled = await Promise.all(
        symbols.map(async (sym) => {
          try {
            return await lookupSingleSymbol(client, sym, historyDays);
          } catch {
            return null;
          }
        })
      );

      const results: MarketDataResult[] = [];
      const textParts: string[] = [];
      const notFound: string[] = [];

      for (let i = 0; i < symbols.length; i++) {
        const out = settled[i];
        if (out) {
          results.push(out.result);
          textParts.push(out.text);
        } else {
          notFound.push(symbols[i]);
        }
      }

      if (results.length === 0) {
        return [
          `No results found for symbols: ${symbols.join(', ')}. Please check the ticker symbols and try again.`,
          null
        ];
      }

      let combinedText = textParts.join('\n\n');
      if (notFound.length > 0) {
        combinedText += `\n\nNot found: ${notFound.join(', ')}`;
      }

      const widgetData = {
        type: 'market_data_lookup' as const,
        results
      };

      return [combinedText, widgetData];
    }
  });
}

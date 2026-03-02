import { describe, test, expect } from 'bun:test';

import type { IGhostfolioClient } from '../../server/tools/create-tool';
import { createMarketDataTool } from '../../server/tools/market-data';

function createMockClient(responses: Record<string, any>): IGhostfolioClient {
  return {
    get: async (path: string) => {
      for (const [key, value] of Object.entries(responses)) {
        if (path.includes(key)) {
          if (value instanceof Error) {
            throw value;
          }
          return value;
        }
      }
      throw new Error(`Unexpected path: ${path}`);
    }
  };
}

describe('market_data_lookup tool', () => {
  test('returns formatted market data for a valid symbol', async () => {
    const tool = createMarketDataTool(
      createMockClient({
        '/api/v1/symbol/lookup': {
          items: [
            {
              dataSource: 'YAHOO',
              symbol: 'TSLA',
              name: 'Tesla, Inc.',
              currency: 'USD',
              assetClass: 'EQUITY',
              assetSubClass: 'STOCK'
            }
          ]
        },
        '/api/v1/symbol/YAHOO/TSLA': {
          marketPrice: 248.42,
          currency: 'USD',
          dataSource: 'YAHOO',
          symbol: 'TSLA',
          historicalData: []
        }
      })
    );

    const result = await tool.invoke({ symbol: 'TSLA' });

    expect(result).toContain('Tesla, Inc.');
    expect(result).toContain('TSLA');
    expect(result).toContain('248.42');
    expect(result).toContain('USD');
    expect(result).toContain('YAHOO');
    expect(result).toContain('EQUITY');
    expect(result).toContain('STOCK');
  });

  test('includes historical data when requested', async () => {
    const tool = createMarketDataTool(
      createMockClient({
        '/api/v1/symbol/lookup': {
          items: [
            {
              dataSource: 'YAHOO',
              symbol: 'AAPL',
              name: 'Apple Inc.',
              currency: 'USD',
              assetClass: 'EQUITY',
              assetSubClass: 'STOCK'
            }
          ]
        },
        '/api/v1/symbol/YAHOO/AAPL': {
          marketPrice: 178.72,
          currency: 'USD',
          dataSource: 'YAHOO',
          symbol: 'AAPL',
          historicalData: [
            { date: '2024-01-19', marketPrice: 176.5 },
            { date: '2024-01-20', marketPrice: 177.3 },
            { date: '2024-01-21', marketPrice: 178.72 }
          ]
        }
      })
    );

    const result = await tool.invoke({
      symbol: 'AAPL',
      includeHistoricalData: 3
    });

    expect(result).toContain('Apple Inc.');
    expect(result).toContain('178.72');
    expect(result).toContain('Historical Data (3 days)');
    expect(result).toContain('2024-01-19');
    expect(result).toContain('176.5');
    expect(result).toContain('2024-01-21');
  });

  test('returns clear message when symbol is not found', async () => {
    const tool = createMarketDataTool(
      createMockClient({
        '/api/v1/symbol/lookup': {
          items: []
        }
      })
    );

    const result = await tool.invoke({ symbol: 'XYZNOTREAL' });

    expect(result).toContain('No results found');
    expect(result).toContain('XYZNOTREAL');
  });

  test('handles API error gracefully', async () => {
    const tool = createMarketDataTool(
      createMockClient({
        '/api/v1/symbol/lookup': new Error('API request failed: 500')
      })
    );

    const result = await tool.invoke({ symbol: 'TSLA' });

    expect(result).toContain('Error');
    expect(result).toContain('market_data_lookup');
  });
});

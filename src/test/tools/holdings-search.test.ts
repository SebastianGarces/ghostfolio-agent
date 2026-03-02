import { describe, test, expect } from 'bun:test';

import type { IGhostfolioClient } from '../../server/tools/create-tool';
import { createHoldingsSearchTool } from '../../server/tools/holdings-search';

function createMockClient(response: any): IGhostfolioClient {
  return {
    get: async () => response
  };
}

const holdingsFixture = {
  holdings: [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      allocationInPercentage: 0.35,
      valueInBaseCurrency: 12428.5,
      netPerformance: 2450,
      netPerformancePercent: 0.245,
      quantity: 67,
      assetClass: 'EQUITY',
      assetSubClass: 'STOCK',
      currency: 'USD'
    },
    {
      symbol: 'VTI',
      name: 'Vanguard Total Stock Market ETF',
      allocationInPercentage: 0.45,
      valueInBaseCurrency: 19200,
      netPerformance: 3150,
      netPerformancePercent: 0.197,
      quantity: 80,
      assetClass: 'EQUITY',
      assetSubClass: 'ETF',
      currency: 'USD'
    },
    {
      symbol: 'BND',
      name: 'Vanguard Total Bond Market ETF',
      allocationInPercentage: 0.2,
      valueInBaseCurrency: 7322.5,
      netPerformance: -180,
      netPerformancePercent: -0.024,
      quantity: 101,
      assetClass: 'FIXED_INCOME',
      assetSubClass: 'BOND',
      currency: 'USD'
    },
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      allocationInPercentage: 0.05,
      valueInBaseCurrency: 5000,
      netPerformance: 1200,
      netPerformancePercent: 0.316,
      quantity: 0.05,
      assetClass: 'EQUITY',
      assetSubClass: 'CRYPTOCURRENCY',
      currency: 'USD'
    }
  ]
};

describe('holdings_search tool', () => {
  test('returns formatted holdings with all key data', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({});

    expect(result).toContain('Holdings Search Results');
    expect(result).toContain('4 matches');
    expect(result).toContain('Apple Inc.');
    expect(result).toContain('AAPL');
    expect(result).toContain('35.00%');
    expect(result).toContain('12428.50');
  });

  test('filters by query string matching symbol', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({ query: 'AAPL' });

    expect(result).toContain('1 match');
    expect(result).toContain('Apple Inc.');
    expect(result).not.toContain('VTI');
    expect(result).not.toContain('BND');
  });

  test('filters by query string matching name', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({ query: 'vanguard' });

    expect(result).toContain('2 matches');
    expect(result).toContain('VTI');
    expect(result).toContain('BND');
    expect(result).not.toContain('Apple');
  });

  test('returns empty message when no holdings match', async () => {
    const emptyResponse = { holdings: [] };
    const tool = createHoldingsSearchTool(createMockClient(emptyResponse));
    const result = await tool.invoke({});

    expect(result).toContain('No holdings match your search criteria');
  });

  test('includes performance data in results', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({});

    expect(result).toContain('2450.00');
    expect(result).toContain('24.50%');
    expect(result).toContain('-180.00');
    expect(result).toContain('-2.40%');
  });

  test('includes asset class and sub-class in results', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({});

    expect(result).toContain('EQUITY');
    expect(result).toContain('FIXED_INCOME');
    expect(result).toContain('sub-class: STOCK');
    expect(result).toContain('sub-class: CRYPTOCURRENCY');
  });

  test('filters by query matching assetSubClass', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({ query: 'cryptocurrency' });

    expect(result).toContain('1 match');
    expect(result).toContain('Bitcoin');
    expect(result).toContain('BTC');
    expect(result).not.toContain('AAPL');
    expect(result).not.toContain('VTI');
  });

  test('filters by query matching assetClass', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({ query: 'fixed_income' });

    expect(result).toContain('1 match');
    expect(result).toContain('BND');
    expect(result).not.toContain('AAPL');
    expect(result).not.toContain('BTC');
  });

  test('filters by partial assetSubClass match', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({ query: 'crypto' });

    expect(result).toContain('1 match');
    expect(result).toContain('Bitcoin');
  });

  test('splits multi-word queries and matches all terms', async () => {
    const tool = createHoldingsSearchTool(createMockClient(holdingsFixture));
    const result = await tool.invoke({ query: 'bond etf' });

    expect(result).toContain('1 match');
    expect(result).toContain('BND');
    expect(result).not.toContain('AAPL');
    expect(result).not.toContain('BTC');
  });

  test('summarizes when more than 10 holdings', async () => {
    const manyHoldings = {
      holdings: Array.from({ length: 15 }, (_, i) => ({
        symbol: `SYM${i}`,
        name: `Stock ${i}`,
        allocationInPercentage: 1 / 15,
        valueInBaseCurrency: 1000,
        netPerformance: 100,
        netPerformancePercent: 0.1,
        quantity: 10,
        assetClass: 'EQUITY',
        currency: 'USD'
      }))
    };
    const tool = createHoldingsSearchTool(createMockClient(manyHoldings));
    const result = await tool.invoke({});

    expect(result).toContain('15 matches');
    expect(result).toContain('more holdings');
    // Should show first 5
    expect(result).toContain('SYM0');
    expect(result).toContain('SYM4');
    // Should show last 2
    expect(result).toContain('SYM13');
    expect(result).toContain('SYM14');
  });
});

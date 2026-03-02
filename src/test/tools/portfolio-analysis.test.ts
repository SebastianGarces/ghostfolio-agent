import { describe, test, expect } from 'bun:test';

import type { IGhostfolioClient } from '../../server/tools/create-tool';
import { createPortfolioAnalysisTool } from '../../server/tools/portfolio-analysis';
import portfolioDetailsFixture from '../fixtures/balanced-growth/portfolio-details.json';

function createMockClient(response: any): IGhostfolioClient {
  return {
    get: async () => response
  };
}

describe('portfolio_analysis tool', () => {
  test('returns formatted holdings for a normal portfolio', async () => {
    const tool = createPortfolioAnalysisTool(
      createMockClient(portfolioDetailsFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('Apple Inc.');
    expect(result).toContain('AAPL');
    expect(result).toContain('VTI');
    expect(result).toContain('BND');
    expect(result).toContain('3 positions');
  });

  test('includes portfolio summary with net worth', async () => {
    const tool = createPortfolioAnalysisTool(
      createMockClient(portfolioDetailsFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('38951');
    expect(result).toContain('33500');
  });

  test('includes allocation percentages', async () => {
    const tool = createPortfolioAnalysisTool(
      createMockClient(portfolioDetailsFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('45.00%');
    expect(result).toContain('35.00%');
    expect(result).toContain('20.00%');
  });

  test('handles empty portfolio', async () => {
    const emptyResponse = { holdings: {}, accounts: {}, hasError: false };
    const tool = createPortfolioAnalysisTool(createMockClient(emptyResponse));
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('empty');
  });

  test('handles error response with holdings as warning', async () => {
    const errorResponse = {
      hasError: true,
      holdings: {
        AAPL: {
          name: 'Apple',
          allocationInPercentage: 1,
          currency: 'USD',
          netPerformance: 100,
          netPerformancePercent: 0.1,
          valueInBaseCurrency: 1000
        }
      },
      accounts: {}
    };
    const tool = createPortfolioAnalysisTool(createMockClient(errorResponse));
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('incomplete or delayed');
    expect(result).toContain('Apple');
  });

  test('includes account information', async () => {
    const tool = createPortfolioAnalysisTool(
      createMockClient(portfolioDetailsFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('Main Brokerage');
  });
});

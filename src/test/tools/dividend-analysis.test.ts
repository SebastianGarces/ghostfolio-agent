import { describe, test, expect } from 'bun:test';

import type { IGhostfolioClient } from '../../server/tools/create-tool';
import { createDividendAnalysisTool } from '../../server/tools/dividend-analysis';
import dividendFixture from '../fixtures/balanced-growth/portfolio-dividends.json';

function createMockClient(response: any): IGhostfolioClient {
  return {
    get: async () => response
  };
}

describe('dividend_analysis tool', () => {
  test('returns formatted dividend data with dates and amounts', async () => {
    const tool = createDividendAnalysisTool(createMockClient(dividendFixture));
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('Dividend Analysis');
    expect(result).toContain('2024-01-15');
    expect(result).toContain('45.50');
    expect(result).toContain('70.50');
  });

  test('shows total dividend income and event count', async () => {
    const tool = createDividendAnalysisTool(createMockClient(dividendFixture));
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('Total Dividend Income: 683.50');
    expect(result).toContain('Number of Dividend Events: 12');
  });

  test('grouped by year shows annual totals', async () => {
    const tool = createDividendAnalysisTool(createMockClient(dividendFixture));
    const result = await tool.invoke({ range: 'max', groupBy: 'year' });

    expect(result).toContain('Annual Dividend Totals');
    expect(result).toContain('2024');
    expect(result).toContain('683.50');
  });

  test('handles empty dividends gracefully', async () => {
    const emptyResponse = { dividends: [] };
    const tool = createDividendAnalysisTool(createMockClient(emptyResponse));
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('No dividend data available');
  });

  test('summarizes long dividend lists', async () => {
    const tool = createDividendAnalysisTool(createMockClient(dividendFixture));
    const result = await tool.invoke({ range: 'max' });

    // 12 entries > 10, so it should summarize
    expect(result).toContain('more entries');
    expect(result).toContain('midpoint');
  });
});

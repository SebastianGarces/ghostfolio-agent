import { describe, test, expect } from 'bun:test';

import type { IGhostfolioClient } from '../../server/tools/create-tool';
import { createInvestmentHistoryTool } from '../../server/tools/investment-history';
import investmentFixture from '../fixtures/balanced-growth/portfolio-investments.json';

function createMockClient(response: any): IGhostfolioClient {
  return {
    get: async () => response
  };
}

describe('investment_history tool', () => {
  test('returns formatted investment data with dates and amounts', async () => {
    const tool = createInvestmentHistoryTool(
      createMockClient(investmentFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('Investment History');
    expect(result).toContain('2024-01-01');
    expect(result).toContain('2500.00');
  });

  test('shows total invested and event count', async () => {
    const tool = createInvestmentHistoryTool(
      createMockClient(investmentFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('Total Invested: 32500.00');
    expect(result).toContain('Number of Investment Events: 12');
  });

  test('displays streak information', async () => {
    const tool = createInvestmentHistoryTool(
      createMockClient(investmentFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('Current Streak: 12 consecutive months');
    expect(result).toContain('Longest Streak: 12 consecutive months');
    expect(result).toContain('Investment Consistency');
  });

  test('handles empty investments gracefully', async () => {
    const emptyResponse = { investments: [], streaks: null };
    const tool = createInvestmentHistoryTool(createMockClient(emptyResponse));
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('No investment data available');
  });

  test('summarizes long investment lists', async () => {
    const tool = createInvestmentHistoryTool(
      createMockClient(investmentFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    // 12 entries > 10, so it should summarize
    expect(result).toContain('more entries');
    expect(result).toContain('midpoint');
  });
});

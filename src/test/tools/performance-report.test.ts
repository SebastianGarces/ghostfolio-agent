import { describe, test, expect } from 'bun:test';

import type { IGhostfolioClient } from '../../server/tools/create-tool';
import { createPerformanceReportTool } from '../../server/tools/performance-report';
import performanceFixture from '../fixtures/balanced-growth/portfolio-performance.json';

function createMockClient(response: any): IGhostfolioClient {
  return {
    get: async () => response
  };
}

describe('performance_report tool', () => {
  test('returns performance metrics', async () => {
    const tool = createPerformanceReportTool(
      createMockClient(performanceFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('38951');
    expect(result).toContain('33500');
    expect(result).toContain('5420');
  });

  test('includes percentage performance', async () => {
    const tool = createPerformanceReportTool(
      createMockClient(performanceFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('16.20%');
  });

  test('includes chart summary', async () => {
    const tool = createPerformanceReportTool(
      createMockClient(performanceFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('2023-01-01');
    expect(result).toContain('2024-12-31');
    expect(result).toContain('data points');
  });

  test('handles no performance data', async () => {
    const emptyResponse = { performance: null, chart: [] };
    const tool = createPerformanceReportTool(createMockClient(emptyResponse));
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('No performance data');
  });

  test('includes first order date', async () => {
    const tool = createPerformanceReportTool(
      createMockClient(performanceFixture)
    );
    const result = await tool.invoke({ range: 'max' });

    expect(result).toContain('2022-06-01');
  });
});

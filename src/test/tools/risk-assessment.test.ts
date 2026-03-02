import { describe, test, expect } from 'bun:test';

import type { IGhostfolioClient } from '../../server/tools/create-tool';
import { createRiskAssessmentTool } from '../../server/tools/risk-assessment';
import reportFixture from '../fixtures/balanced-growth/portfolio-report.json';

function createMockClient(response: any): IGhostfolioClient {
  return {
    get: async () => response
  };
}

describe('risk_assessment tool', () => {
  test('returns X-Ray report with pass/fail', async () => {
    const tool = createRiskAssessmentTool(createMockClient(reportFixture));
    const result = await tool.invoke({});

    expect(result).toContain('PASS');
    expect(result).toContain('FAIL');
  });

  test('includes statistics summary', async () => {
    const tool = createRiskAssessmentTool(createMockClient(reportFixture));
    const result = await tool.invoke({});

    expect(result).toContain('3/4');
  });

  test('includes category names', async () => {
    const tool = createRiskAssessmentTool(createMockClient(reportFixture));
    const result = await tool.invoke({});

    expect(result).toContain('Currencies');
    expect(result).toContain('Asset Classes');
    expect(result).toContain('Accounts');
    expect(result).toContain('Fees');
  });

  test('includes rule evaluations', async () => {
    const tool = createRiskAssessmentTool(createMockClient(reportFixture));
    const result = await tool.invoke({});

    expect(result).toContain('well-diversified');
    expect(result).toContain('concentrated in a single account');
  });

  test('handles missing X-Ray data', async () => {
    const emptyResponse = {};
    const tool = createRiskAssessmentTool(createMockClient(emptyResponse));
    const result = await tool.invoke({});

    expect(result).toContain('Unable to generate');
  });
});

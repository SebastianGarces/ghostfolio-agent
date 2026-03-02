import { z } from 'zod';

import { createGhostfolioTool, IGhostfolioClient } from './create-tool';

const riskAssessmentSchema = z.object({});

export function createRiskAssessmentTool(client: IGhostfolioClient) {
  return createGhostfolioTool(client, {
    name: 'risk_assessment',
    description:
      'Run X-Ray analysis on the portfolio to identify risks. Returns risk categories with pass/fail rules covering currency concentration, asset class balance, account diversification, regional allocation, and fee analysis. Use this when users ask about portfolio risk, diversification, or X-Ray.',
    schema: riskAssessmentSchema,
    handler: async (_input, client) => {
      const data = await client.get<any>('/api/v1/portfolio/report');

      const xRay = data.xRay;

      if (!xRay) {
        return [
          'Unable to generate X-Ray report. Make sure you have holdings in your portfolio.',
          null
        ];
      }

      const stats = xRay.statistics;
      let result = `Portfolio X-Ray Risk Assessment:\n`;
      result += `Overall: ${stats.rulesFulfilledCount}/${stats.rulesActiveCount} rules passed\n\n`;

      const widgetCategories: Array<{
        name: string;
        rules: Array<{ name: string; passed: boolean; evaluation: string }>;
      }> = [];

      for (const category of xRay.categories ?? []) {
        result += `${category.name}:\n`;
        const widgetRules: Array<{
          name: string;
          passed: boolean;
          evaluation: string;
        }> = [];

        for (const rule of category.rules ?? []) {
          if (!rule.isActive) {
            continue;
          }

          const status = rule.value ? 'PASS' : 'FAIL';
          result += `  [${status}] ${rule.name}`;

          if (rule.evaluation) {
            result += ` — ${rule.evaluation}`;
          }

          result += '\n';

          widgetRules.push({
            name: rule.name,
            passed: !!rule.value,
            evaluation: rule.evaluation ?? ''
          });
        }

        result += '\n';

        widgetCategories.push({
          name: category.name,
          rules: widgetRules
        });
      }

      const widgetData = {
        type: 'risk_assessment' as const,
        statistics: {
          rulesPassed: stats.rulesFulfilledCount,
          rulesTotal: stats.rulesActiveCount
        },
        categories: widgetCategories
      };

      return [result, widgetData];
    }
  });
}

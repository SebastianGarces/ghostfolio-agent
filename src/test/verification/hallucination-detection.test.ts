import { describe, test, expect } from 'bun:test';

import {
  COMMON_WORDS,
  type HallucinationIssue,
  type HallucinationResult
} from '../../server/verification/hallucination-detection';

describe('hallucination-detection interfaces', () => {
  test('COMMON_WORDS set contains expected entries', () => {
    expect(COMMON_WORDS.has('THE')).toBe(true);
    expect(COMMON_WORDS.has('ETF')).toBe(true);
    expect(COMMON_WORDS.has('USD')).toBe(true);
    expect(COMMON_WORDS.has('REIT')).toBe(true);
    // Should not contain actual stock symbols
    expect(COMMON_WORDS.has('AAPL')).toBe(false);
    expect(COMMON_WORDS.has('MSFT')).toBe(false);
  });

  test('HallucinationResult interface shape is valid', () => {
    const result: HallucinationResult = {
      passed: true,
      issues: []
    };
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('HallucinationIssue supports all issue types', () => {
    const issues: HallucinationIssue[] = [
      {
        type: 'symbol_not_in_data',
        severity: 'warning',
        claimed: 'TSLA',
        description: 'Not in data'
      },
      {
        type: 'percentage_mismatch',
        severity: 'warning',
        claimed: '50%',
        actual: '35%',
        description: 'Wrong pct'
      },
      {
        type: 'amount_mismatch',
        severity: 'warning',
        claimed: '$20000',
        actual: '$12000',
        description: 'Wrong amount'
      },
      {
        type: 'unsupported_claim',
        severity: 'warning',
        claimed: 'Beat S&P',
        description: 'No benchmark data'
      }
    ];

    expect(issues).toHaveLength(4);
    for (const issue of issues) {
      expect(issue.severity).toBe('warning');
    }
  });
});

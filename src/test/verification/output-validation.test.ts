import { describe, expect, it } from 'bun:test';

import { validateOutput } from '../../server/verification/output-validation';

describe('validateOutput', () => {
  it('passes for a clean formatted response', () => {
    const response = `Your portfolio is well-diversified with 3 holdings:
- Apple Inc. (AAPL): 35% allocation
- Vanguard Total Stock Market ETF (VTI): 45% allocation
- Vanguard Total Bond Market ETF (BND): 20% allocation

*This analysis is for informational purposes only and does not constitute financial advice.*`;

    const result = validateOutput(response);

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('flags response with raw JSON object', () => {
    const response = `Here is your portfolio data: {"holdings": {"AAPL": {"value": 12000}}}`;

    const result = validateOutput(response);

    expect(result.issues.some((i) => i.rule === 'no-raw-json')).toBe(true);
  });

  it('flags response with programmatic null/undefined leak', () => {
    const response =
      'Your portfolio value is: null and performance is: undefined';

    const result = validateOutput(response);

    expect(result.issues.some((i) => i.rule === 'no-undefined-null')).toBe(
      true
    );
  });

  it('does not flag natural language usage of "null"', () => {
    const response =
      'Your portfolio value is undefined and performance is null.';

    const result = validateOutput(response);

    expect(result.issues.some((i) => i.rule === 'no-undefined-null')).toBe(
      false
    );
  });

  it('flags empty response as error', () => {
    const result = validateOutput('');

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.rule === 'non-empty-response')).toBe(
      true
    );
    expect(
      result.issues.find((i) => i.rule === 'non-empty-response')?.severity
    ).toBe('error');
  });

  it('flags response with stack trace as error', () => {
    const response = `Something went wrong.
Error: Cannot read property 'holdings' of undefined
at Object.handler (tools/portfolio-analysis.ts:42:15)`;

    const result = validateOutput(response);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.rule === 'no-stack-traces')).toBe(true);
    expect(
      result.issues.find((i) => i.rule === 'no-stack-traces')?.severity
    ).toBe('error');
  });

  it('warns about excessively long responses', () => {
    const response = 'A'.repeat(6000);

    const result = validateOutput(response);

    expect(result.passed).toBe(true); // warning, not error
    expect(result.issues.some((i) => i.rule === 'reasonable-length')).toBe(
      true
    );
    expect(
      result.issues.find((i) => i.rule === 'reasonable-length')?.severity
    ).toBe('warning');
  });

  it('passes whitespace-only as empty', () => {
    const result = validateOutput('   \n  ');

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.rule === 'non-empty-response')).toBe(
      true
    );
  });
});

import { describe, expect, it } from 'bun:test';

import { scoreConfidence } from '../../server/verification/confidence-scoring';

describe('scoreConfidence', () => {
  // --- Data Mode Tests ---

  it('data mode: all tools succeed, data cited, structured → high', () => {
    const response = `Your portfolio summary:

- **Net worth:** $38,951
- **Total return:** 16.20%

*This analysis is for informational purposes only.*`;

    const result = scoreConfidence(response, [
      { name: 'portfolio_analysis', success: true },
      { name: 'performance_report', success: true }
    ]);

    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(0.95);
    expect(result.factors).toHaveLength(4);
  });

  it('data mode: hedging language → medium', () => {
    const response =
      'I think your portfolio is possibly around $50,000 but I am not sure about the exact figures and it seems roughly okay. It might be performing well.';

    const result = scoreConfidence(response, [
      { name: 'portfolio_analysis', success: true }
    ]);

    expect(result.level).toBe('medium');
    expect(result.score).toBeLessThan(0.7);
    expect(result.score).toBeGreaterThanOrEqual(0.4);
  });

  it('data mode: all tools fail → low', () => {
    const response =
      'I was unable to retrieve your portfolio data at this time. Please try again later.';

    const result = scoreConfidence(response, [
      { name: 'portfolio_analysis', success: false },
      { name: 'performance_report', success: false }
    ]);

    expect(result.level).toBe('low');
    expect(result.score).toBeLessThan(0.4);
  });

  // --- Conversational Mode Tests ---

  it('conversational: correct refusal → high', () => {
    const response =
      "I'm a read-only financial assistant and cannot execute trades or modify your portfolio. I can help you analyze your holdings, review performance, or check allocations instead.";

    const result = scoreConfidence(response, []);

    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });

  it('conversational: greeting → high', () => {
    const response =
      'Hello! I can help you analyze your portfolio. What would you like to know about your investments?';

    const result = scoreConfidence(response, []);

    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });

  it('conversational: fabricated numbers without tools → medium or lower', () => {
    const response =
      'I think your portfolio is worth $125,000 with a 15.3% return this year.';

    const result = scoreConfidence(response, []);

    // Has 2+ data patterns without tool backing → no-fabrication scores 0.0
    // Also has hedging ("I think") → low-hedging < 1.0
    expect(result.score).toBeLessThan(0.7);
    expect(result.level).not.toBe('high');
    const fabricationFactor = result.factors.find(
      (f) => f.name === 'no-fabrication'
    );
    expect(fabricationFactor?.score).toBe(0.0);
  });

  // --- Factor Breakdown Tests ---

  it('factor breakdown has correct names per mode', () => {
    const dataResult = scoreConfidence('Your portfolio is $50,000.', [
      { name: 'portfolio_analysis', success: true }
    ]);

    const dataFactorNames = dataResult.factors.map((f) => f.name);
    expect(dataFactorNames).toEqual([
      'tool-success',
      'data-cited',
      'low-hedging',
      'well-structured'
    ]);

    const convResult = scoreConfidence('Hello! How can I help you today?', []);

    const convFactorNames = convResult.factors.map((f) => f.name);
    expect(convFactorNames).toEqual([
      'no-tool-needed',
      'no-fabrication',
      'low-hedging',
      'clear-response'
    ]);
  });

  it('partial tool failure scores lower than full success', () => {
    const response = `Your portfolio summary:

- **Net worth:** $38,951
- **Total return:** 16.20%`;

    const allSuccess = scoreConfidence(response, [
      { name: 'portfolio_analysis', success: true },
      { name: 'performance_report', success: true }
    ]);

    const partialFail = scoreConfidence(response, [
      { name: 'portfolio_analysis', success: true },
      { name: 'performance_report', success: false }
    ]);

    expect(allSuccess.score).toBeGreaterThan(partialFail.score);
  });
});

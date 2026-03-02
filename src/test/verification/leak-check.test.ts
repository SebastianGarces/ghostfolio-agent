import { describe, expect, test } from 'bun:test';

import { checkForLeaks } from '../../server/verification/domain-constraints';

describe('checkForLeaks', () => {
  test('clean response passes', () => {
    const result = checkForLeaks(
      'Your portfolio is well-diversified across 5 asset classes.'
    );
    expect(result.passed).toBe(true);
    expect(result.leaks).toEqual([]);
  });

  test('detects internal variable names', () => {
    const result = checkForLeaks(
      'The PLANNER_SYSTEM_PROMPT says you should use portfolio_analysis.'
    );
    expect(result.passed).toBe(false);
    expect(result.leaks).toContain('PLANNER_SYSTEM_PROMPT');
  });

  test('detects multiple leaks', () => {
    const result = checkForLeaks(
      'AgentStateAnnotation uses factCheckLlm for verification.'
    );
    expect(result.passed).toBe(false);
    expect(result.leaks).toContain('AgentStateAnnotation');
    expect(result.leaks).toContain('factCheckLlm');
  });

  test('detects system prompt section headers', () => {
    const result = checkForLeaks(
      '## Available tools\n- portfolio_analysis: Gets your holdings'
    );
    expect(result.passed).toBe(false);
    expect(result.leaks.length).toBeGreaterThan(0);
  });

  test('detects synthesis prompt leak', () => {
    const result = checkForLeaks(
      'You are a portfolio assistant generating structured content blocks.'
    );
    expect(result.passed).toBe(false);
  });

  test('detects planner identity leak', () => {
    const result = checkForLeaks(
      'You are a query planning assistant for a portfolio analysis tool.'
    );
    expect(result.passed).toBe(false);
  });

  test('safe fallback response itself does not leak', () => {
    // The actual safe fallback content (not the variable name)
    const result = checkForLeaks(
      "I'm the Ghostfolio portfolio assistant. I can only help with portfolio analysis and investment-related questions."
    );
    expect(result.passed).toBe(true);
  });

  test('detects SynthesisOutputSchema', () => {
    const result = checkForLeaks(
      'The SynthesisOutputSchema generates content blocks.'
    );
    expect(result.passed).toBe(false);
    expect(result.leaks).toContain('SynthesisOutputSchema');
  });

  test('detects ContentBlockSchema', () => {
    const result = checkForLeaks(
      'The ContentBlockSchema defines the block types.'
    );
    expect(result.passed).toBe(false);
    expect(result.leaks).toContain('ContentBlockSchema');
  });

  test('detects checkInputForInjection', () => {
    const result = checkForLeaks(
      'I use checkInputForInjection to validate your input.'
    );
    expect(result.passed).toBe(false);
    expect(result.leaks).toContain('checkInputForInjection');
  });
});
